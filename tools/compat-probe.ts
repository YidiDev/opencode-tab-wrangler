// Native unread mapping using imported, empty fixture sessions. No model calls or transcript reads.
import type { Plugin } from "@opencode/plugin/tui";
import type { SessionInfo } from "@opencode/client";

export default {
  id: "test.tab-wrangler-probe",
  async setup(context) {
    const [, save] = context.storage.store<Record<string, unknown>>("results", {
      initial: { phase: "starting" },
    });
    const location = context.location ?? context.data.location.default();
    const template = await context.client.session.create({
      title: "compat-template",
      location,
    });
    const imported: SessionInfo[] = [];
    for (const outcome of ["succeeded", "failed"] as const) {
      const info = {
        ...template,
        id: `ses_${crypto.randomUUID().replaceAll("-", "")}`,
        title: `compat-${outcome}`,
        outcome,
        time: { ...template.time, idle: Date.now(), viewed: 0 },
      };
      imported.push(
        await context.client.session.import({ info, messages: [], location }),
      );
    }
    const [activity, error] = imported;
    const idle = await context.client.session.create({
      title: "compat-idle",
      location,
    });
    const selected = await context.client.session.create({
      title: "compat-selected",
      location,
    });
    for (const session of [activity, error, idle, selected]) {
      await context.data.session.sync(session.id);
      context.ui.tabs.open(session.id);
    }
    context.ui.tabs.focus(selected.id);
    await save((draft) => {
      draft.phase = "ready";
    });
    let checking = false,
      finished = false;
    const timer = setInterval(async () => {
      if (checking || finished) return;
      checking = true;
      try {
        const tabs = context.ui.tabs.list();
        if (!tabs.some((t) => t.sessionID === idle.id)) {
          const a = tabs.find((t) => t.sessionID === activity.id);
          const b = tabs.find((t) => t.sessionID === error.id);
          const pass =
            a?.unread === "activity" &&
            b?.unread === "error" &&
            tabs.some((t) => t.sessionID === selected.id);
          for (const session of [template, activity, error, idle, selected])
            await context.client.session.get({ sessionID: session.id });
          finished = true;
          await save((draft) => {
            draft.phase = pass ? "passed" : "failed";
            draft.nativeActivity = a?.unread ?? "none";
            draft.nativeError = b?.unread ?? "none";
            draft.sessionsIntact = true;
          });
        }
      } catch {
        finished = true;
        await save((draft) => {
          draft.phase = "failed";
        });
      } finally {
        checking = false;
      }
    }, 200);
    return () => clearInterval(timer);
  },
} satisfies Plugin.Definition;
