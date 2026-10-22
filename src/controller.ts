import { candidates, evaluate, observe } from "./policy";
import {
  inSchedule,
  policyFor,
  resolveConfig,
  type Config,
  type Options,
} from "./config";
import type { Decision, Entry, Persisted, Runtime, Tab } from "./model";
import { keyFor } from "./model";
import { prune, validateState } from "./state";
import type { Host } from "./host";

export interface Dependencies {
  host: Host;
  options: Options;
  state: Persisted;
  runtime: Runtime;
  update(mutation: (draft: Persisted) => void): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  notify(message: string): void;
  changed(): void;
}

export class Controller {
  private disposed = false;
  private working = false;
  private revision = 0;
  private lastTick = 0;
  private resumed = false;
  private observedScope = "";
  private lastTabs = new Map<string, Tab>();
  private lastBatch = -Infinity;
  private lastEnabled: boolean | undefined;
  health = "Starting; preview only until state is verified";
  constructor(readonly dep: Dependencies) {
    validateState(dep.state);
    this.config();
  }
  config(): Config {
    return resolveConfig(this.dep.state.preferences, this.dep.options);
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
    const tab = this.dep.host.list().find((t) => t.id === id);
    if (!tab || !policyFor(this.config(), tab).policy.activity.backgroundEvents)
      return;
    const value = this.dep.runtime.observations[this.lockKey(id)];
    if (value) value.touched = this.dep.now();
    this.changed();
  }
  observe(fromHost = false) {
    if (this.disposed) return;
    const enabled = this.dep.host.enabled();
    if (this.lastEnabled !== enabled) {
      this.lastEnabled = enabled;
      this.resetGrace();
    }
    if (fromHost && this.working) return;
    const config = this.config(),
      now = this.dep.now(),
      scope = this.scope();
    if (this.observedScope !== scope) {
      this.lastTabs.clear();
      this.observedScope = scope;
      this.resetGrace();
    }
    const tabs = this.dep.host.list();
    for (const tab of tabs) {
      const key = this.lockKey(tab.id),
        old = this.dep.runtime.observations[key];
      this.dep.runtime.observations[key] = observe(
        tab,
        config,
        this.lastTabs.has(tab.id) ? old : undefined,
        this.dep.state.locks[key],
        now,
      );
    }
    const signature = (ts: Tab[]) =>
      JSON.stringify(ts.map(({ title: _title, ...t }) => t));
    if (signature([...this.lastTabs.values()]) !== signature(tabs))
      this.revision++;
    this.lastTabs = new Map(tabs.map((t) => [t.id, t]));
    this.dep.changed();
  }
  decisions(ignoreIntentID?: string): Decision[] {
    const config = this.config(),
      now = this.dep.now();
    return this.dep.host.list().map((tab) => {
      const decision = evaluate(
        tab,
        config,
        this.dep.runtime.observations[this.lockKey(tab.id)],
        this.dep.state.locks[this.lockKey(tab.id)],
        now,
      );
      if (
        this.history().some(
          (e) =>
            e.id !== ignoreIntentID &&
            e.sessionID === tab.id &&
            e.state !== "closed",
        )
      ) {
        decision.reasons.push("closure-uncertain");
        decision.eligible = false;
      }
      return decision;
    });
  }
  preview(): Decision[] {
    return candidates(this.decisions(), this.config());
  }
  async preferences(value: Options) {
    if (this.disposed) throw new Error("Plugin unloaded");
    const config = resolveConfig(value, this.dep.options);
    await this.dep.update((draft) => {
      if (this.disposed) return;
      draft.preferences = value;
      draft.corral = prune(draft.corral, config, this.dep.now());
    });
    this.resetGrace();
  }
  async lock(id: string, minutes: number | null) {
    if (this.disposed) throw new Error("Plugin unloaded");
    if (
      minutes !== null &&
      (!Number.isFinite(minutes) || minutes <= 0 || minutes > 525600)
    )
      throw new Error(
        "Lock duration must be between 0 and 525600 minutes (exclusive of 0)",
      );
    const key = this.lockKey(id),
      now = this.dep.now();
    await this.dep.update((draft) => {
      if (this.disposed) return;
      draft.locks[key] = {
        until: minutes === null ? null : now + minutes * 60000,
      };
    });
    this.changed();
  }
  async unlock(id: string) {
    if (this.disposed) throw new Error("Plugin unloaded");
    const key = this.lockKey(id);
    await this.dep.update((draft) => {
      if (this.disposed) return;
      delete draft.locks[key];
    });
    this.resetGrace();
  }
  pause(minutes: number | null) {
    if (this.disposed) return;
    if (
      minutes !== null &&
      (!Number.isFinite(minutes) || minutes <= 0 || minutes > 525600)
    )
      throw new Error(
        "Pause duration must be between 0 and 525600 minutes (exclusive of 0)",
      );
    this.dep.runtime.pauseUntil =
      minutes === null ? null : this.dep.now() + minutes * 60000;
    this.resumed = false;
    this.changed();
  }
  resume() {
    if (this.disposed) return;
    this.dep.runtime.pauseUntil = 0;
    this.resumed = true;
    this.resetGrace();
  }
  private allowed(auto: boolean): boolean {
    const c = this.config();
    return (
      !this.disposed &&
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
    if (this.disposed || this.working) return;
    const now = this.dep.now(),
      config = this.config();
    if (
      this.lastTick &&
      (now < this.lastTick || now - this.lastTick > config.checkSeconds * 2000)
    )
      this.resetGrace();
    this.lastTick = now;
    if (this.paused()) this.resumed = false;
    else if (!this.resumed) {
      this.resumed = true;
      this.resetGrace();
    }
    this.observe();
    if (!this.dep.host.enabled()) return;
    if (config.mode === "auto") await this.run(true);
    else if (config.mode === "preview") await this.refresh();
  }
  async run(auto = false): Promise<number> {
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
      // Refresh only open tabs, sequentially, avoiding request storms.
      for (const tab of this.dep.host.list()) {
        if (this.disposed) return 0;
        try {
          await this.dep.host.refresh(tab.id);
        } catch {
          this.health =
            "Some session state could not be verified; affected tabs are protected";
        }
      }
      if (this.disposed) return 0;
      if (
        this.dep.now() - now > config.checkSeconds * 2000 ||
        this.dep.now() < now
      )
        this.resetGrace();
      this.observe();
      // Preview ticks refresh state but must never mutate tabs.
      if (auto ? !this.allowed(true) : !this.allowed(false)) return 0;
      const selected = this.preview();
      for (const decision of selected) {
        if (!this.allowed(auto)) break;
        if (closed && this.config().batchDelaySeconds)
          await this.dep.sleep(this.config().batchDelaySeconds * 1000);
        if (!this.allowed(auto)) break;
        const id = decision.tab.id;
        try {
          await this.dep.host.refresh(id);
        } catch {
          continue;
        }
        this.observe();
        if (!this.preview().some((d) => d.tab.id === id)) continue;
        const current = this.dep.host.list().find((t) => t.id === id);
        if (!current) continue;
        const scope = this.scope(),
          revision = this.revision;
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
        await this.dep.update((draft) => {
          draft.corral = prune(
            [entry, ...draft.corral],
            this.config(),
            this.dep.now(),
          );
        });
        // No await between the final local policy check and the explicit-ID close.
        this.observe();
        const finalDecisions = this.decisions(entry.id);
        if (
          !this.allowed(auto) ||
          this.scope() !== scope ||
          revision !== this.revision ||
          !this.dep.state.corral.some(
            (e) => e.id === entry.id && e.state === "intent",
          ) ||
          !candidates(finalDecisions, this.config()).some(
            (d) => d.tab.id === id,
          )
        ) {
          await this.removeEntry(entry.id);
          continue;
        }
        if (!this.dep.host.close(id)) {
          await this.removeEntry(entry.id);
          continue;
        }
        const outcome = await this.waitFor(
          () => !this.dep.host.list().some((t) => t.id === id),
        );
        await this.dep.update((draft) => {
          const stored = draft.corral.find((e) => e.id === entry.id);
          if (stored) stored.state = outcome ? "closed" : "uncertain";
        });
        if (!outcome) {
          this.health = "Tab closure was not confirmed; no automatic retry";
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
      this.health =
        "Cleanup stopped after an error; inspect the corral before retrying";
      return closed;
    } finally {
      this.working = false;
      if (!this.disposed) this.dep.changed();
    }
  }
  // Preview must not call run(false), which is the explicitly requested manual cleanup path.
  async refresh() {
    if (this.working || this.disposed || !this.dep.host.enabled()) return;
    this.working = true;
    let failed = false;
    try {
      for (const tab of this.dep.host.list()) {
        if (this.disposed) return;
        try {
          await this.dep.host.refresh(tab.id);
        } catch {
          failed = true;
        }
      }
      this.health = failed
        ? "Some state unavailable; affected tabs protected"
        : "State verified (local view; shared-terminal limitations apply)";
      this.observe();
    } finally {
      this.working = false;
    }
  }
  private async waitFor(test: () => boolean): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (test()) return true;
      if (this.disposed) return false;
      await this.dep.sleep(50);
    }
    return test();
  }
  async removeEntry(id: string) {
    await this.dep.update((draft) => {
      draft.corral = draft.corral.filter((e) => e.id !== id);
    });
    this.changed();
  }
  async clearHistory() {
    const scope = this.scope();
    await this.dep.update((draft) => {
      draft.corral = draft.corral.filter((e) => e.scope !== scope);
    });
    this.changed();
  }
  history(): Entry[] {
    return prune(this.dep.state.corral, this.config(), this.dep.now()).filter(
      (e) => e.scope === this.scope(),
    );
  }
  async reconcile() {
    const scope = this.scope();
    await this.dep.update((draft) => {
      for (const entry of draft.corral)
        if (entry.scope === scope && entry.state === "intent")
          entry.state = "uncertain";
      draft.corral = prune(draft.corral, this.config(), this.dep.now());
      for (const [key, lock] of Object.entries(draft.locks))
        if (lock.until !== null && lock.until <= this.dep.now())
          delete draft.locks[key];
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
        ))
      )
        return false;
      if (this.disposed || this.scope() !== scope) return false;
      if (!wasOpen) this.dep.host.move(entry.sessionID, entry.index);
      this.observe();
      this.resetGrace();
      await this.removeEntry(id);
      return true;
    } catch {
      this.health =
        "Session unavailable or restore unconfirmed; corral entry retained";
      return false;
    }
  }
  dispose() {
    this.disposed = true;
    this.dep.host.dispose?.();
    this.changed();
  }
}
