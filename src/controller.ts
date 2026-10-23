import { candidates, evaluate, observe } from "./policy";
import {
  inSchedule,
  merge,
  policyFor,
  resolveConfig,
  SettingsError,
  type Config,
  type Options,
} from "./config";
import type { Decision, Entry, Persisted, Runtime, Tab } from "./model";
import { keyFor } from "./model";
import { prune, validateState } from "./state";
import type { Host } from "./host";
import { withDeadline } from "./deadline";

export interface Dependencies {
  host: Host;
  options: Options;
  state: Persisted;
  runtime: Runtime;
  update(mutation: (draft: Persisted) => void): Promise<void>;
  now(): number;
  monotonic?(): number;
  sleep(ms: number): Promise<void>;
  notify(message: string): void;
  changed(): void;
}

export class Controller {
  private disposed = false;
  private working = false;
  private revision = 0;
  private activity = new Map<string, symbol>();
  private layout: string[] = [];
  private lifetime = new AbortController();
  private storageFault = false;
  private lastFinished: number | undefined;
  private lastPreview = -Infinity;
  private lastHousekeeping = -Infinity;
  private resumed = false;
  private observedScope = "";
  private lastTabs = new Map<string, Tab>();
  private selected = new Set<string>();
  private lastBatch = -Infinity;
  private lastEnabled: boolean | undefined;
  private configKey = "";
  private cachedConfig?: Config;
  health = "Starting; session state has not been verified";

  constructor(readonly dep: Dependencies) {
    validateState(dep.state);
    this.config();
  }
  config(): Config {
    const key = JSON.stringify([this.dep.state.preferences, this.dep.options]);
    if (!this.cachedConfig || key !== this.configKey) {
      this.cachedConfig = resolveConfig(
        this.dep.state.preferences,
        this.dep.options,
      );
      this.configKey = key;
    }
    return this.cachedConfig;
  }
  scope(): string {
    return this.config().connectionKey;
  }
  lockKey(id: string): string {
    return keyFor(this.scope(), id);
  }
  paused(): boolean {
    const until = this.dep.runtime.pauseUntil;
    return until === null || until > this.dep.now();
  }
  changed() {
    this.revision++;
    if (!this.disposed) this.dep.changed();
  }
  private markActivity(id: string) {
    this.activity.set(id, Symbol());
    if (!this.disposed) this.dep.changed();
  }
  private async write(mutation: (draft: Persisted) => void) {
    if (this.disposed || this.storageFault)
      throw new SettingsError(
        "Storage is unavailable or uncertain; reload Wrangler and inspect the corral before retrying.",
      );
    let invalidMutation = false;
    try {
      await withDeadline(
        async (signal) => {
          await this.dep.update((draft) => {
            if (signal.aborted || this.disposed || this.storageFault) return;
            try {
              mutation(draft);
            } catch (error) {
              invalidMutation = true;
              throw error;
            }
          });
        },
        this.config().storageTimeoutSeconds * 1000,
        this.lifetime.signal,
      );
    } catch (error) {
      if (!invalidMutation && !this.disposed) {
        this.storageFault = true;
        this.health =
          "Storage failed or timed out; cleanup disabled until reload; inspect the corral";
      }
      throw error;
    }
  }
  resetGrace() {
    if (this.disposed) return;
    const now = this.dep.now();
    for (const value of Object.values(this.dep.runtime.observations)) {
      value.grace = now;
      value.touched = now;
    }
    this.changed();
  }
  touch(id: string) {
    if (this.disposed) return;
    const tab = this.lastTabs.get(id);
    if (!tab) return;
    const config = this.config();
    if (!policyFor(config, tab).policy.activity.backgroundEvents) return;
    const value =
      this.dep.runtime.observations[keyFor(config.connectionKey, id)];
    if (value) value.touched = this.dep.now();
    this.markActivity(id);
  }
  observe(fromHost = false) {
    if (this.disposed) return;
    const enabled = this.dep.host.enabled(),
      config = this.config(),
      now = this.dep.now(),
      scope = config.connectionKey;
    if (this.lastEnabled !== enabled) {
      this.lastEnabled = enabled;
      this.resetGrace();
    }
    if (this.observedScope !== scope) {
      this.lastTabs.clear();
      this.selected.clear();
      this.activity.clear();
      this.layout = [];
      this.observedScope = scope;
      this.dep.runtime.observations = {};
      this.changed();
    }
    const tabs = this.dep.host.list();
    const layout = tabs.map((t) => t.id);
    if (JSON.stringify(layout) !== JSON.stringify(this.layout)) {
      for (const id of new Set([...layout, ...this.layout]))
        if (layout.includes(id) !== this.layout.includes(id)) {
          const value = this.dep.runtime.observations[keyFor(scope, id)];
          if (value) {
            value.touched = now;
            value.grace = now;
          }
          this.markActivity(id);
        }
      this.revision++;
      this.layout = layout;
    }
    // User selection is never suppressed by an in-flight refresh. Only hydration/policy observation is.
    const selected = new Set(tabs.filter((t) => t.active).map((t) => t.id));
    for (const tab of tabs) {
      const value = this.dep.runtime.observations[keyFor(scope, tab.id)];
      if (!value) continue;
      if (tab.active && policyFor(config, tab).policy.activity.selection)
        value.touched = now;
      if (this.selected.has(tab.id) && !tab.active) {
        value.touched = now;
        value.grace = now;
      }
      if (this.selected.has(tab.id) !== tab.active) this.markActivity(tab.id);
    }
    this.selected = selected;
    if (fromHost && this.working) return;
    const liveKeys = new Set<string>();
    for (const tab of tabs) {
      const key = keyFor(scope, tab.id);
      liveKeys.add(key);
      const previous = this.dep.runtime.observations[key];
      if (
        previous &&
        tab.updated > previous.updated &&
        policyFor(config, tab).policy.activity.sessionUpdates
      )
        this.markActivity(tab.id);
      this.dep.runtime.observations[key] = observe(
        tab,
        config,
        this.lastTabs.has(tab.id)
          ? this.dep.runtime.observations[key]
          : undefined,
        this.dep.state.locks[key],
        now,
      );
    }
    for (const key of Object.keys(this.dep.runtime.observations))
      if (!liveKeys.has(key)) delete this.dep.runtime.observations[key];
    for (const id of this.activity.keys())
      if (!layout.includes(id)) this.activity.delete(id);
    this.lastTabs = new Map(tabs.map((t) => [t.id, t]));
    this.dep.changed();
  }
  decisions(ignoreIntentID?: string): Decision[] {
    const config = this.config(),
      now = this.dep.now(),
      scope = config.connectionKey;
    const blocked = new Set(
      prune(this.dep.state.corral, config, now)
        .filter(
          (e) =>
            e.scope === scope &&
            e.id !== ignoreIntentID &&
            e.state !== "closed",
        )
        .map((e) => e.sessionID),
    );
    return this.dep.host.list().map((tab) => {
      const key = keyFor(scope, tab.id);
      const decision = evaluate(
        tab,
        config,
        this.dep.runtime.observations[key],
        this.dep.state.locks[key],
        now,
      );
      if (blocked.has(tab.id)) {
        decision.reasons.push("closure-uncertain");
        decision.eligible = false;
      }
      return decision;
    });
  }
  preview(): Decision[] {
    return candidates(this.decisions(), this.config());
  }
  status(): string {
    const c = this.config();
    if (this.storageFault)
      return "Storage outcome uncertain; cleanup disabled until reload";
    if (!this.dep.host.enabled()) return "Native tabs are disabled";
    if (c.mode === "off") return "Off";
    if (this.paused()) return "Paused; no tabs will close";
    if (c.connectionKey === "unconfigured" || !c.acknowledgeSharedTabs)
      return "Setup incomplete; closure blocked";
    if (!inSchedule(c, this.dep.now())) return "Outside cleanup schedule";
    return c.mode === "preview"
      ? "Preview; automatic closure disabled"
      : "Automatic cleanup enabled";
  }
  private async savePreferences(value: Options, patch: boolean) {
    if (this.disposed) throw new Error("Plugin unloaded");
    resolveConfig(
      patch ? merge(this.dep.state.preferences, value) : value,
      this.dep.options,
    );
    await this.write((draft) => {
      if (this.disposed) return;
      const preferences = patch ? merge(draft.preferences, value) : value;
      const config = resolveConfig(preferences, this.dep.options);
      draft.preferences = structuredClone(preferences);
      draft.corral = prune(draft.corral, config, this.dep.now());
    });
    this.resetGrace();
  }
  preferences(value: Options) {
    return this.savePreferences(value, false);
  }
  patchPreferences(value: Options) {
    return this.savePreferences(value, true);
  }
  async lock(id: string, minutes: number | null) {
    if (this.disposed) throw new Error("Plugin unloaded");
    this.validateDuration(minutes);
    const key = this.lockKey(id),
      now = this.dep.now();
    await this.write((draft) => {
      if (!this.disposed)
        draft.locks[key] = {
          until: minutes === null ? null : now + minutes * 60000,
        };
    });
    this.changed();
  }
  async unlock(id: string) {
    if (this.disposed) throw new Error("Plugin unloaded");
    const key = this.lockKey(id);
    await this.write((draft) => {
      if (!this.disposed) delete draft.locks[key];
    });
    this.resetGrace();
  }
  private validateDuration(minutes: number | null) {
    if (
      minutes !== null &&
      (!Number.isFinite(minutes) || minutes <= 0 || minutes > 525600)
    )
      throw new SettingsError(
        "Lock/pause duration must be positive and at most 525600 minutes",
      );
  }
  pause(minutes: number | null) {
    if (this.disposed) return;
    this.validateDuration(minutes);
    this.dep.runtime.pauseUntil =
      minutes === null ? null : this.dep.now() + minutes * 60000;
    this.resumed = false;
    this.changed();
  }
  resume() {
    if (!this.disposed) {
      this.dep.runtime.pauseUntil = 0;
      this.resumed = true;
      this.resetGrace();
    }
  }
  private allowed(auto: boolean): boolean {
    const c = this.config();
    return (
      !this.disposed &&
      !this.storageFault &&
      this.dep.host.enabled() &&
      !this.paused() &&
      c.mode !== "off" &&
      (!auto || c.mode === "auto") &&
      c.connectionKey !== "unconfigured" &&
      c.acknowledgeSharedTabs &&
      inSchedule(c, this.dep.now())
    );
  }
  async tick() {
    if (this.disposed || this.working || this.storageFault) return;
    const now = this.dep.now(),
      config = this.config();
    if (this.lastFinished !== undefined && now < this.lastFinished) {
      this.lastPreview = -Infinity;
      this.lastBatch = -Infinity;
      this.lastHousekeeping = -Infinity;
    }
    if (
      this.lastFinished !== undefined &&
      (now < this.lastFinished ||
        now - this.lastFinished > config.checkSeconds * 2000)
    )
      this.resetGrace();
    if (this.paused()) this.resumed = false;
    else if (!this.resumed) {
      this.resumed = true;
      this.resetGrace();
    }
    try {
      this.observe();
      if (now - this.lastHousekeeping >= 60000 || now < this.lastHousekeeping) {
        await this.reconcile();
        this.lastHousekeeping = now;
      }
      if (!this.dep.host.enabled() || this.paused()) return;
      if (config.mode === "auto") await this.run(true);
      else if (
        config.mode === "preview" &&
        now - this.lastPreview >= config.previewRefreshSeconds * 1000
      ) {
        await this.refresh();
        this.lastPreview = this.dep.now();
      }
    } finally {
      this.lastFinished = this.dep.now();
    }
  }
  private async refreshRoots(ids: string[], config: Config) {
    const started = this.dep.now();
    const options = {
      timeoutMs: config.refreshTimeoutSeconds * 1000,
      concurrency: config.refreshConcurrency,
    };
    let failed = false;
    if (this.dep.host.refreshMany) {
      try {
        await this.dep.host.refreshMany(ids, options);
      } catch {
        failed = true;
      }
    } else {
      for (const id of ids) {
        if (this.disposed) return;
        try {
          await this.dep.host.refresh(id, options);
        } catch {
          failed = true;
        }
      }
    }
    if (this.disposed) return;
    if (
      this.dep.now() < started ||
      this.dep.now() - started > config.checkSeconds * 2000
    )
      this.resetGrace();
    const unknown = this.dep.host.list().filter((t) => !t.known).length;
    if (!this.storageFault)
      this.health =
        failed || unknown
          ? "Some session state is unavailable; affected tabs are protected"
          : "Session state verified; shared-terminal limitations still apply";
    this.observe();
  }
  async run(auto = false, confirmedIDs?: readonly string[]): Promise<number> {
    if (this.working || this.disposed || !this.dep.host.enabled()) return 0;
    this.working = true;
    let closed = 0;
    try {
      const config = this.config(),
        now = this.dep.now();
      if (!this.resumed && !this.paused() && this.dep.runtime.pauseUntil !== 0)
        this.resume();
      if (auto && now - this.lastBatch < config.batchDelaySeconds * 1000)
        return 0;
      if (!this.allowed(auto)) return 0;
      await this.refreshRoots(
        this.dep.host.list().map((t) => t.id),
        config,
      );
      if (!this.allowed(auto)) return 0;
      const approved = confirmedIDs ? new Set(confirmedIDs) : undefined;
      const selected = this.preview().filter(
        (d) => !approved || approved.has(d.tab.id),
      );
      for (const decision of selected) {
        if (!this.allowed(auto)) break;
        if (closed && this.config().batchDelaySeconds)
          await this.dep.sleep(this.config().batchDelaySeconds * 1000);
        if (!this.allowed(auto)) break;
        const id = decision.tab.id;
        try {
          await this.refreshRoots([id], this.config());
        } catch {
          continue;
        }
        if (!this.preview().some((d) => d.tab.id === id)) continue;
        const current = this.dep.host.list().find((t) => t.id === id);
        if (!current) continue;
        const scope = this.scope(),
          revision = this.revision,
          activity = this.activity.get(id);
        const entry: Entry = {
          id: crypto.randomUUID(),
          scope,
          sessionID: id,
          directory: current.directory,
          project: current.project,
          title: this.config().history.rememberTitles
            ? current.title
            : undefined,
          index: current.index,
          time: this.dep.now(),
          state: "intent",
          reason: auto ? "automatic-idle" : "manual-idle",
        };
        await this.write((draft) => {
          if (!this.disposed)
            draft.corral = prune(
              [entry, ...draft.corral],
              this.config(),
              this.dep.now(),
            );
        });
        // Persistence can stall or outlive the last network read. Reverify AFTER it settles.
        if (!this.allowed(auto) || this.scope() !== scope) {
          await this.removeEntry(entry.id, scope);
          continue;
        }
        const verifiedAt = this.dep.now(),
          verifiedMono = this.dep.monotonic?.() ?? verifiedAt;
        await this.refreshRoots([id], this.config());
        // Bind manual consent to explicit IDs, and never await between the final check and the close.
        this.observe();
        if (
          !this.allowed(auto) ||
          this.scope() !== scope ||
          revision !== this.revision ||
          activity !== this.activity.get(id) ||
          !this.dep.state.corral.some(
            (e) => e.id === entry.id && e.state === "intent",
          ) ||
          !candidates(this.decisions(entry.id), this.config()).some(
            (d) => d.tab.id === id,
          ) ||
          !this.dep.host
            .list()
            .some(
              (t) =>
                t.id === id &&
                t.title === current.title &&
                t.directory === current.directory &&
                t.project === current.project,
            ) ||
          this.dep.now() < verifiedAt ||
          this.dep.now() - verifiedAt >
            this.config().verificationMaxAgeSeconds * 1000 ||
          (this.dep.monotonic?.() ?? this.dep.now()) - verifiedMono >
            this.config().verificationMaxAgeSeconds * 1000
        ) {
          await this.removeEntry(entry.id, scope);
          continue;
        }
        if (!this.dep.host.close(id)) {
          await this.removeEntry(entry.id, scope);
          continue;
        }
        const outcome = await this.waitFor(
          () => !this.dep.host.list().some((t) => t.id === id),
        );
        await this.write((draft) => {
          const stored = draft.corral.find((e) => e.id === entry.id);
          if (stored)
            stored.state = outcome && !this.disposed ? "closed" : "uncertain";
        });
        if (!outcome) {
          this.health =
            "Tab closure was not confirmed; inspect the corral; no automatic retry";
          break;
        }
        closed++;
        this.lastBatch = this.dep.now();
        this.observe();
      }
      if (closed && !this.disposed && this.config().notification === "summary")
        this.dep.notify(
          `Wrangler closed ${closed} idle tab${closed === 1 ? "" : "s"}. Reopen from /wrangler.`,
        );
      return closed;
    } catch {
      if (!this.storageFault)
        this.health =
          "Cleanup stopped after an error; inspect the corral before retrying";
      return closed;
    } finally {
      this.working = false;
      if (!this.disposed) this.dep.changed();
    }
  }
  async refresh() {
    if (this.working || this.disposed || !this.dep.host.enabled()) return;
    this.working = true;
    try {
      await this.refreshRoots(
        this.dep.host.list().map((t) => t.id),
        this.config(),
      );
    } finally {
      this.working = false;
    }
  }
  private async waitFor(test: () => boolean): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (this.disposed) return false;
      if (test()) return true;
      await this.dep.sleep(50);
    }
    return !this.disposed && test();
  }
  async removeEntry(id: string, scope = this.scope()) {
    if (this.disposed) return;
    await this.write((draft) => {
      if (!this.disposed)
        draft.corral = draft.corral.filter(
          (e) => e.id !== id || e.scope !== scope,
        );
    });
    this.changed();
  }
  async clearHistory() {
    if (this.disposed) return;
    const scope = this.scope();
    await this.write((draft) => {
      if (!this.disposed)
        draft.corral = draft.corral.filter((e) => e.scope !== scope);
    });
    this.changed();
  }
  history(): Entry[] {
    const config = this.config();
    return prune(this.dep.state.corral, config, this.dep.now()).filter(
      (e) => e.scope === config.connectionKey,
    );
  }
  async reconcile(force = false) {
    if (this.disposed) return;
    const config = this.config(),
      now = this.dep.now();
    const needsPrune =
      JSON.stringify(prune(this.dep.state.corral, config, now)) !==
      JSON.stringify(this.dep.state.corral);
    const hasExpired = Object.values(this.dep.state.locks).some(
      (lock) => lock.until !== null && lock.until <= now,
    );
    const hasIntent = this.dep.state.corral.some(
      (e) => e.scope === config.connectionKey && e.state === "intent",
    );
    if (!force && !needsPrune && !hasExpired && !hasIntent) return;
    await this.write((draft) => {
      if (this.disposed) return;
      for (const entry of draft.corral)
        if (entry.scope === config.connectionKey && entry.state === "intent")
          entry.state = "uncertain";
      draft.corral = prune(draft.corral, config, now);
      for (const [key, lock] of Object.entries(draft.locks))
        if (lock.until !== null && lock.until <= now) delete draft.locks[key];
    });
  }
  async restore(id: string, focus = true): Promise<boolean> {
    const entry = this.history().find((e) => e.id === id);
    if (!entry || this.disposed || !this.dep.host.enabled()) return false;
    const scope = this.scope();
    try {
      if (
        !(await this.dep.host.exists(entry.sessionID)) ||
        this.disposed ||
        this.scope() !== scope
      )
        return false;
      const wasOpen = this.dep.host
        .list()
        .some((t) => t.id === entry.sessionID);
      if (!this.dep.host.open(entry.sessionID, focus)) return false;
      if (
        !(await this.waitFor(() =>
          this.dep.host.list().some((t) => t.id === entry.sessionID),
        )) ||
        this.disposed ||
        this.scope() !== scope
      )
        return false;
      if (!wasOpen) this.dep.host.move(entry.sessionID, entry.index);
      this.observe();
      this.resetGrace();
      if (this.storageFault) {
        this.health =
          "Session reopened; corral entry retained because storage is unavailable";
        return true;
      }
      await this.removeEntry(id, scope);
      return true;
    } catch {
      this.health =
        "Session unavailable or restore unconfirmed; corral entry retained";
      return false;
    }
  }
  dispose() {
    this.disposed = true;
    this.lifetime.abort();
    this.dep.host.dispose?.();
    this.changed();
  }
}
