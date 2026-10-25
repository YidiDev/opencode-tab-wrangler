// Loaded ONLY by isolated tests. All queued input explicitly uses resume:false: no generation.
import type { Plugin } from "@opencode/plugin/tui";
import type { SessionInfo } from "@opencode/client";

export default {
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
    // Parked synthetic context must not be mistaken for executable queued work.
    await context.client.session.synthetic({
      sessionID: idle[0].id,
      text: "Disposable parked fixture context",
      resume: false,
    });
    const permission = await context.client.session.create({
      title: "fixture-permission",
      location,
      permissions: [
        { action: "wrangler_fixture", resource: "*", effect: "ask" },
      ],
    });
    sessions.push(permission);
    const permissionAbort = new AbortController();
    void context.client.permission
      .create(
        {
          sessionID: permission.id,
          action: "wrangler_fixture",
          resources: ["fixture-only"],
        },
        { signal: permissionAbort.signal },
      )
      .catch(() => {});
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await context.client.permission.list({ sessionID: permission.id }))
          .length
      ) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!waiting) {
      permissionAbort.abort();
      throw new Error("Fixture permission did not become pending");
    }
    const child = await context.client.session.create({
      title: "fixture-child-question",
      parentID: question.id,
      location: { directory: `${location.directory}/child` },
    });
    const selectedChild = await context.client.session.create({
      title: "fixture-selected-child",
      parentID: selected.id,
      location: { directory: `${location.directory}/child` },
    });
    const queued = await context.client.session.create({
      title: "fixture-queued-root",
      location,
    });
    sessions.push(queued);
    const queuedChild = await context.client.session.create({
      title: "fixture-queued-child",
      parentID: queued.id,
      location: { directory: `${location.directory}/child` },
    });
    // Public 2.1.4 Session.prompt admits a real user inbox item, but only wakes execution
    // when resume !== false. Do not remove this explicit no-generation safeguard.
    const queuedItem = await context.client.session.prompt({
      sessionID: queuedChild.id,
      text: "Disposable queued fixture work; never execute",
      delivery: "queue",
      resume: false,
    });
    await context.client.session.form.create({
      sessionID: child.id,
      title: "Fixture waiting question",
      fields: [
        { key: "reply", type: "string", title: "Disposable test question" },
      ],
    });
    for (const session of sessions) context.ui.tabs.open(session.id);
    context.ui.tabs.focus(selected.id);
    context.ui.router.navigate({
      type: "session",
      sessionID: selectedChild.id,
    });
    let observed = false,
      restoring = false,
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
        if (!observed) {
          observed = sessions.every((s) => ids.includes(s.id));
          return;
        }
        if (!ids.includes(queued.id))
          throw new Error("Queued descendant root was closed");
        if (
          !restoring &&
          idle.every((s) => !ids.includes(s.id)) &&
          ids.includes(question.id) &&
          ids.includes(permission.id) &&
          ids.includes(selected.id)
        ) {
          for (const session of [
            ...sessions,
            child,
            selectedChild,
            queuedChild,
          ])
            await context.client.session.get({ sessionID: session.id });
          const forms = await context.client.session.form.list({
            sessionID: child.id,
          });
          if (!forms.length) throw new Error("Waiting question lost");
          const inbox = await context.client.session.inbox.list({
            sessionID: queuedChild.id,
          });
          if (
            !inbox.some(
              (item) => item.id === queuedItem.id && item.type === "user",
            )
          )
            throw new Error("Queued user input was lost or executed");
          if (
            !(
              await context.client.permission.list({ sessionID: permission.id })
            ).length
          )
            throw new Error("Waiting permission lost");
          restoring = true;
          await save((draft) => {
            draft.phase = "restoring";
            draft.closed = idle.map((s) => s.id);
            draft.sessionsIntact = true;
            draft.questionProtected = true;
            draft.selectedProtected = true;
            draft.permissionProtected = true;
            draft.parkedContextDidNotBlockCleanup = true;
            draft.queuedDescendantProtected = true;
          });
          context.keymap.dispatch("wrangler.restore");
        } else if (restoring && idle.some((s) => ids.includes(s.id))) {
          const restored = tabs.find((t) =>
            idle.some((s) => s.id === t.sessionID),
          );
          if (!restored?.active || !ids.includes(question.id))
            throw new Error(
              "Restore did not focus the recovered tab or lost the waiting tab",
            );
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
    return () => {
      clearInterval(timer);
      permissionAbort.abort();
    };
  },
} satisfies Plugin.Definition;
