// Isolated native lifecycle acceptance. No generation, approvals, or real user sessions.
import type { Plugin } from "@opencode/plugin/tui";

interface Report {
  phase: string;
  ids: string[];
  setupCount: number;
  earlyProtected?: boolean;
  failure?: string;
}
export default {
  id: "test.tab-wrangler-probe",
  async setup(context) {
    const [report, save] = context.storage.store<Report>("results", {
      initial: { phase: "starting", ids: [], setupCount: 0 },
    });
    const scenario = context.options.scenario;
    let stopped = false,
      checking = false;
    const began = Date.now();
    await save((draft) => {
      draft.setupCount++;
    });
    if (report.phase === "passed" || report.phase === "failed") return;
    if (!report.ids.length) {
      const location = context.location ?? context.data.location.default();
      const selected = await context.client.session.create({
        title: "lifecycle-selected",
        location,
      });
      const idle = await context.client.session.create({
        title: "lifecycle-idle",
        location,
      });
      for (const s of [selected, idle]) await context.data.session.sync(s.id);
      if (scenario === "disabled") {
        if (context.ui.tabs.enabled() || context.ui.tabs.open(idle.id))
          throw new Error("Disabled native tabs accepted an open");
      } else {
        context.ui.tabs.open(selected.id);
        context.ui.tabs.focus(selected.id);
        context.ui.tabs.open(idle.id);
      }
      context.ui.router.navigate({ type: "session", sessionID: selected.id });
      await save((draft) => {
        draft.ids = [selected.id, idle.id];
        draft.phase = "ready";
      });
    }
    const [selected, idle] = report.ids;
    const resumed = report.phase === "reloading";
    const timer = setInterval(async () => {
      if (checking || stopped) return;
      checking = true;
      try {
        const elapsed = Date.now() - began;
        const tabs = context.ui.tabs.list();
        if (scenario === "disabled") {
          if (context.ui.tabs.enabled())
            throw new Error("Native tabs unexpectedly enabled");
          if (elapsed >= 11000) {
            for (const sessionID of report.ids)
              await context.client.session.get({ sessionID });
            await save((draft) => {
              draft.phase = "passed";
            });
          }
        } else if (!resumed && report.phase === "ready" && elapsed >= 8000) {
          if (!report.ids.every((id) => tabs.some((t) => t.sessionID === id)))
            throw new Error("Reload fixtures were not open before reload");
          const reload = context.keymap
            .commands()
            .find((c) => c.slash?.name === "reload");
          if (!reload?.id) throw new Error("Public reload command unavailable");
          await save((draft) => {
            draft.phase = "reloading";
          });
          context.keymap.dispatch(reload.id);
        } else if (resumed) {
          if (
            elapsed >= 5200 &&
            elapsed <= 5800 &&
            tabs.some((t) => t.sessionID === idle)
          ) {
            await save((draft) => {
              draft.earlyProtected = true;
            });
          }
          if (elapsed >= 5800 && !report.earlyProtected)
            throw new Error("Reload grace was not observed");
          if (elapsed >= 6500 && !tabs.some((t) => t.sessionID === idle)) {
            if (!tabs.some((t) => t.sessionID === selected && t.active))
              throw new Error("Reload lost selected tab");
            for (const sessionID of report.ids)
              await context.client.session.get({ sessionID });
            await save((draft) => {
              draft.phase = "passed";
            });
          }
        }
      } catch {
        await save((draft) => {
          draft.phase = "failed";
          draft.failure = "native-lifecycle-assertion";
        });
      } finally {
        checking = false;
      }
    }, 100);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  },
} satisfies Plugin.Definition;
