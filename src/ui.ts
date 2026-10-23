import type { Plugin } from "@opencode/plugin/tui";
import {
  defaults,
  fileControls,
  merge,
  SettingsError,
  type Options,
} from "./config";
import type { Controller } from "./controller";
import { rulesUI } from "./rules-ui";

const labels: Record<string, string> = {
  selected: "Selected tab",
  running: "Running work",
  "unknown-busy": "Unresolved busy state",
  locked: "Locked / snoozed",
  excluded: "Excluded by policy",
  "unknown-state": "State not verified",
  "unread-activity": "Unread response",
  "unread-error": "Unread error",
  "question-waiting": "Question waiting",
  "permission-waiting": "Permission waiting",
  "queued-work": "Queued work",
  attention: "Needs attention",
  "idle-grace": "Idle/grace timer",
  "outside-schedule": "Outside schedule",
  disabled: "Disabled",
  unobserved: "Not yet observed",
  "closure-uncertain": "Unconfirmed earlier closure (inspect corral)",
};
const pretty = (reasons: string[]) =>
  reasons.map((r) => labels[r] ?? r).join(", ");
const minutes = (ms: number) => `${Math.floor(ms / 60000)}m`;

export function createUI(context: Plugin.Context, controller: Controller) {
  const dialog = context.ui.dialog;
  async function alert(message: string) {
    await dialog.alert({ title: "Tab Wrangler", message });
  }
  async function guard(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      await alert(
        error instanceof Error && error.name === "ZodError"
          ? `Invalid settings. No changes saved.\n${error.message}`
          : error instanceof SettingsError
            ? error.message
            : error instanceof SyntaxError
              ? "Invalid JSON. No settings were saved; use double-quoted keys and valid JSON values."
              : "Action failed; no further cleanup was attempted. Check storage availability and retry.",
      );
    }
  }
  async function tabDetails(id: string) {
    const scope = controller.scope();
    const d = controller.decisions().find((d) => d.tab.id === id);
    if (!d) return;
    const action = await dialog.select({
      title: d.tab.title,
      options: [
        {
          title: d.eligible ? "Eligible for cleanup" : pretty(d.reasons),
          value: "info",
          description: `Idle ${minutes(d.idleMs)} · Rules: ${d.rules.join(" → ") || "defaults"}`,
        },
        { title: "Focus tab", value: "focus" },
        { title: "Lock open indefinitely", value: "lock" },
        { title: "Snooze / temporary lock", value: "snooze" },
        { title: "Unlock (restarts grace)", value: "unlock" },
        { title: "Exclude this project", value: "project" },
        { title: "Exclude this directory", value: "directory" },
        { title: "Exclude this session", value: "session" },
      ],
    });
    if (action === "focus") context.ui.tabs.focus(id);
    if (action === "lock") await controller.lock(id, null);
    if (action === "unlock") await controller.unlock(id);
    if (action === "snooze") {
      const input = await dialog.prompt({
        title: "Keep open for how many minutes?",
        value: "60",
      });
      if (input !== undefined) await controller.lock(id, Number(input));
    }
    if (
      action === "project" ||
      action === "directory" ||
      action === "session"
    ) {
      if (fileControls(context.options, "rules")) {
        await alert("Rules are controlled by cli.json. Edit them there.");
        return;
      }
      const value = action === "session" ? id : d.tab[action];
      // Escape wildcard characters by using a session lock if an exact match cannot be expressed.
      if (!value || /[*?]/.test(value)) {
        await alert(
          "This value cannot be represented as an exact wildcard rule. Use a session lock or edit Rules.",
        );
        return;
      }
      const rules = controller.config().rules;
      await controller.patchPreferences(
        {
          rules: [
            {
              name: `Exclude ${action}`,
              enabled: true,
              match: { [action]: value, caseSensitive: true },
              set: { excluded: true },
              stop: true,
            },
            ...rules,
          ],
        },
        { scope, rules },
      );
    }
  }
  async function tabs() {
    await controller.refresh();
    const candidateIDs = new Set(controller.preview().map((d) => d.tab.id));
    const selected = await dialog.select({
      title: "Wrangler · Open tabs",
      options: controller.decisions().map((d) => ({
        title: `${d.tab.active ? "● " : ""}${d.tab.title}`,
        value: d.tab.id,
        description: `${minutes(d.idleMs)} idle · ${candidateIDs.has(d.tab.id) ? "Policy candidate; " + controller.status() : d.eligible ? "Eligible; count/batch policy retains it" : pretty(d.reasons)}`,
        category: d.tab.directory || "Unknown location",
      })),
    });
    if (selected) await tabDetails(selected);
  }
  async function corral() {
    const scope = controller.scope();
    const history = controller.history();
    const choice = await dialog.select({
      title: "Wrangler · Corral",
      options: history.map((entry) => ({
        title: entry.title ?? entry.sessionID,
        value: entry.id,
        description: `${new Date(entry.time).toLocaleString()} · ${entry.state} · ${entry.directory}`,
      })),
      actions: [
        {
          bind: "ctrl+r",
          title: "Restore all",
          selection: "none",
          onTrigger: () => {
            void guard(async () => {
              if (
                await dialog.confirm({
                  title: "Restore corral?",
                  message: `Open ${history.length} tabs in the background?`,
                })
              ) {
                // Undo the most recent removals first: indices were recorded after earlier closes.
                for (const entry of history) {
                  if (controller.scope() !== scope)
                    throw new SettingsError(
                      "Connection changed. Reopen Corral before restoring more tabs.",
                    );
                  await controller.restore(entry.id, false, scope);
                }
              }
            });
          },
        },
        {
          bind: "ctrl+x",
          title: "Clear history",
          selection: "none",
          onTrigger: () => {
            void guard(async () => {
              if (
                await dialog.confirm({
                  title: "Clear corral?",
                  message: `Forget entries for ${scope}? Sessions are not deleted.`,
                })
              )
                await controller.clearHistory(scope);
            });
          },
        },
      ],
    });
    if (!choice) return;
    const action = await dialog.select({
      title: "Corral entry",
      options: [
        { title: "Reopen and focus", value: "focus" },
        { title: "Reopen in background", value: "background" },
        { title: "Forget entry (does not delete session)", value: "forget" },
      ],
    });
    if (controller.scope() !== scope)
      throw new SettingsError(
        "Connection changed. Reopen Corral before acting on its entries.",
      );
    if (action === "forget") await controller.forgetEntry(choice, scope);
    if (action === "focus" || action === "background") {
      if (!(await controller.restore(choice, action === "focus", scope)))
        await alert(
          "Could not confirm restoration. The entry has been kept; the session may be unavailable.",
        );
    }
  }
  async function cleanup() {
    await controller.refresh();
    const config = controller.config();
    if (
      !config.acknowledgeSharedTabs ||
      config.connectionKey === "unconfigured"
    ) {
      await alert(
        "Before closing tabs, set connectionKey and acknowledgeSharedTabs in Settings. Shared tab layout can affect other terminals.",
      );
      return;
    }
    if (controller.paused() || config.mode === "off") {
      await alert("Wrangler is paused or off. Resume it before cleanup.");
      return;
    }
    const preview = controller.preview();
    if (!preview.length) {
      await alert(
        "No tabs are eligible under the current safety, timer, schedule, count, and batch rules.",
      );
      return;
    }
    if (
      await dialog.confirm({
        title: `Close ${preview.length} idle tabs?`,
        message: `${preview.map((d) => `${d.tab.title} · ${d.tab.id} · ${d.tab.directory}`).join("\n")}\n\nEach tab will be rechecked. Sessions are not deleted. Recover from the Corral.`,
      })
    ) {
      const count = await controller.run(
        false,
        preview.map((d) => d.tab.id),
      );
      if (!count)
        await alert(
          "No tabs closed. State may have changed, a protection may apply, or persistence could not be confirmed.",
        );
    }
  }
  const settingHelp: Record<string, string> = {
    mode: '"preview", "auto", or "off"',
    connectionKey:
      'Unique server label, e.g. "local-main"; change when switching servers',
    acknowledgeSharedTabs:
      "Acknowledges shared layout: other terminals' selected tabs cannot be detected",
    protections:
      "Independent unreadActivity, unreadErrors, questions, permissions, pending, attention flags",
    activity:
      "Choose selection, sessionUpdates, and backgroundEvents as timer-reset signals",
    rules:
      "Ordered wildcard rules; later matches override earlier matches; stop ends evaluation",
    cleanup: '"all-idle" or "over-limit" (requires softMaxTabs)',
    schedule:
      "Local-time days (Sunday=0), startHour, endHour; overnight windows supported",
    history: "maxEntries, days, rememberTitles",
    order: '"oldest-idle", "oldest-opened", "left-to-right", "right-to-left"',
  };
  async function settings() {
    const config = controller.config();
    const key = await dialog.select({
      title: "Wrangler · Settings",
      options: Object.entries(config)
        .map(([key, value]) => ({
          title: `${key}${fileControls(context.options, key) ? " [file-controlled]" : ""}`,
          value: key,
          description: `${JSON.stringify(value)} · ${settingHelp[key] ?? "See README for semantics"}`,
        }))
        .concat([
          {
            title: "Edit all UI preferences as JSON",
            value: "$json",
            description:
              "File options still take precedence. Use {} to reset UI preferences.",
          },
          {
            title: "Show effective configuration",
            value: "$effective",
            description:
              "Includes defaults, saved preferences, and file options",
          },
        ]),
    });
    if (!key) return;
    if (key === "$effective") {
      await alert(JSON.stringify(config, null, 2));
      return;
    }
    const settingValue = config[key as keyof typeof config];
    if (
      key !== "$json" &&
      fileControls(context.options, key) &&
      (settingValue === null ||
        typeof settingValue !== "object" ||
        Array.isArray(settingValue))
    ) {
      await alert(
        "This setting is controlled by cli.json. Edit the file or remove that override first.",
      );
      return;
    }
    let path = key;
    if (key === "rules") {
      await rulesUI(context, controller);
      return;
    }
    let value =
      key === "$json"
        ? controller.dep.state.preferences
        : config[key as keyof typeof config];
    if (
      key !== "$json" &&
      key !== "rules" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const child = await dialog.select({
        title: `Settings · ${key}`,
        options: Object.entries(value).map(([name, current]) => ({
          title: `${name}${fileControls(context.options, `${key}.${name}`) ? " [file-controlled]" : ""}`,
          value: name,
          description: JSON.stringify(current),
        })),
      });
      if (!child) return;
      path = `${key}.${child}`;
      if (fileControls(context.options, path)) {
        await alert("This setting is controlled by cli.json.");
        return;
      }
      value = (value as Options)[child] as typeof value;
    }
    if (typeof value === "boolean") {
      const result = await dialog.select({
        title: `Set ${path}`,
        current: String(value),
        options: [
          { title: "Enabled", value: "true" },
          { title: "Disabled", value: "false" },
        ],
      });
      if (result === undefined) return;
      if (
        ((path.startsWith("protections.") && result === "false") ||
          (path === "acknowledgeSharedTabs" && result === "true")) &&
        !(await dialog.confirm({
          title: "Confirm protection change",
          message:
            "Waiting/unread protections are optional, but disabling them may close tabs that need attention. Shared tab layout also affects other terminals, whose selected tabs cannot be detected. Continue?",
        }))
      )
        return;
      const [parent, child] = path.split(".");
      await controller.patchPreferences(
        child
          ? { [parent]: { [child]: result === "true" } }
          : { [parent]: result === "true" },
      );
      return;
    }
    const choices: Record<string, string[]> = {
      mode: ["preview", "auto", "off"],
      cleanup: ["all-idle", "over-limit"],
      order: ["oldest-idle", "oldest-opened", "left-to-right", "right-to-left"],
      notification: ["summary", "silent"],
    };
    if (choices[key]) {
      const selected = await dialog.select({
        title: `Set ${key}`,
        current: String(value),
        options: choices[key].map((choice) => ({
          title: choice,
          value: choice,
        })),
      });
      if (selected === undefined) return;
      if (
        key === "mode" &&
        selected === "auto" &&
        !(await dialog.confirm({
          title: "Enable automatic cleanup?",
          message:
            "Idle tabs will be closed under your current rules. Other terminals may share this layout; their selected tabs cannot be detected. Continue?",
        }))
      )
        return;
      await controller.patchPreferences({ [key]: selected });
      return;
    }
    if (key === "connectionKey") {
      const selected = await dialog.prompt({
        title: "Connection namespace",
        value: String(value),
        description:
          "Unique label for this server. Change when connecting to another server.",
      });
      if (selected !== undefined)
        await controller.patchPreferences({ connectionKey: selected });
      return;
    }
    const input = await dialog.prompt({
      title:
        key === "$json" ? "UI preferences (JSON object)" : `Set ${path} (JSON)`,
      value: JSON.stringify(value),
      description:
        settingHelp[key] ??
        "Changes restart the grace period. Invalid input is not saved.",
    });
    if (input === undefined) return;
    const parsed: unknown = JSON.parse(input);
    const [parent, child] = path.split(".");
    const next =
      key === "$json"
        ? parsed
        : merge(
            controller.dep.state.preferences,
            child ? { [parent]: { [child]: parsed } } : { [parent]: parsed },
          );
    if (typeof next !== "object" || next === null || Array.isArray(next))
      throw new Error("Expected preferences object");
    const resolved = merge(defaults, next as Options);
    const p = resolved.protections as Record<string, unknown>;
    if (
      (Object.values(p).some((v) => v === false) || resolved.mode === "auto") &&
      !(await dialog.confirm({
        title: "Confirm cleanup settings",
        message:
          "Automatic cleanup can remove idle tabs from shared layouts. Disabled protections may close unread or waiting tabs. Locally selected tabs, running work, and unknown state remain protected. Continue?",
      }))
    )
      return;
    if (key === "$json") await controller.preferences(next as Options);
    else
      await controller.patchPreferences(
        child ? { [parent]: { [child]: parsed } } : { [parent]: parsed },
      );
  }
  async function pause() {
    const choice = await dialog.select({
      title: "Pause Wrangler",
      options: [
        { title: "Until I resume", value: "forever" },
        { title: "15 minutes", value: "15" },
        { title: "1 hour", value: "60" },
        { title: "Custom minutes", value: "custom" },
        { title: "Resume now", value: "resume" },
      ],
    });
    if (choice === "resume") controller.resume();
    else if (choice === "forever") controller.pause(null);
    else if (choice === "custom") {
      const input = await dialog.prompt({
        title: "Pause minutes",
        value: "30",
      });
      if (input !== undefined) controller.pause(Number(input));
    } else if (choice) controller.pause(Number(choice));
  }
  async function manager() {
    const c = controller.config();
    const action = await dialog.select({
      title: `Tab Wrangler · ${controller.status()}`,
      options: [
        {
          title: "Open tabs / protection inspector",
          value: "tabs",
          description: `${context.ui.tabs.list().length} tabs · ${controller.health}`,
        },
        {
          title: "Preview and clean eligible tabs",
          value: "cleanup",
          description:
            "Confirm one batch; protections and idle timers still apply",
        },
        {
          title: "Corral / recently auto-closed",
          value: "corral",
          description: `${controller.history().length} entries for ${c.connectionKey}`,
        },
        {
          title: "Settings / ordered rules",
          value: "settings",
          description:
            "Every setting can be configured in cli.json; UI preferences are optional",
        },
        {
          title: "Pause / resume",
          value: "pause",
          description: "Resume grants fresh grace",
        },
      ],
    });
    if (action === "tabs") await tabs();
    if (action === "cleanup") await cleanup();
    if (action === "corral") await corral();
    if (action === "settings") await settings();
    if (action === "pause") await pause();
  }
  return {
    manager: () => guard(manager),
    tabs: () => guard(tabs),
    cleanup: () => guard(cleanup),
    corral: () => guard(corral),
    settings: () => guard(settings),
    pause: () => guard(pause),
  };
}
