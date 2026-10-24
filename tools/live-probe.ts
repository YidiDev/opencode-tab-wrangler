// Loaded ONLY by the explicitly invoked isolated live test. Creates disposable sessions, no model prompts.
import { Plugin } from "@opencode/plugin/tui";
import type { SessionInfo } from "@opencode/client";

export default Plugin.define({
  id: "test.tab-wrangler-probe",
  async setup(context) {
    const [, save] = context.storage.store<Record<string, unknown>>("results", {
      initial: { phase: "starting" },
    });
    const location = context.location ?? context.data.location.default();
    const sessions: SessionInfo[] = [];
    for (const title of [
      "fixture-idle-a",
      "fixture-idle-b",
      "fixture-idle-c",
      "fixture-question",
      "fixture-selected",
    ]) {
      sessions.push(await context.client.session.create({ title, location }));
    }
    const idle = sessions.slice(0, 3),
      question = sessions[3],
      selected = sessions[4];
    await context.client.session.form.create({
      sessionID: question.id,
      title: "Fixture waiting question",
      fields: [
        { key: "reply", type: "string", title: "Disposable test question" },
      ],
    });
    for (const session of sessions) context.ui.tabs.open(session.id);
    context.ui.tabs.focus(selected.id);
    let restoring = false,
      finished = false,
      checking = false;
    await save((draft) => {
      draft.phase = "ready";
      draft.ids = sessions.map((s) => s.id);
    });
    const timer = setInterval(async () => {
      if (checking || finished) return;
      checking = true;
      try {
        const tabs = context.ui.tabs.list(),
          ids = tabs.map((t) => t.sessionID);
        if (
          !restoring &&
          idle.every((s) => !ids.includes(s.id)) &&
          ids.includes(question.id) &&
          ids.includes(selected.id)
        ) {
          for (const session of sessions)
            await context.client.session.get({ sessionID: session.id });
          const forms = await context.client.session.form.list({
            sessionID: question.id,
          });
          if (!forms.length) throw new Error("Waiting question lost");
          restoring = true;
          await save((draft) => {
            draft.phase = "restoring";
            draft.closed = idle.map((s) => s.id);
            draft.sessionsIntact = true;
            draft.questionProtected = true;
            draft.selectedProtected = true;
          });
          context.keymap.dispatch("wrangler.restore");
        } else if (restoring && idle.some((s) => ids.includes(s.id))) {
          finished = true;
          await save((draft) => {
            draft.phase = "passed";
            draft.restored = true;
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
});
