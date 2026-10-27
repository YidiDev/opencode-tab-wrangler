// Test-only native draft/attachment round trip. Never submits the prompt.
import type { Plugin } from "@opencode/plugin/tui";

export default {
  id: "test.tab-wrangler-probe",
  async setup(context) {
    const [report, save] = context.storage.store("results", {
      initial: {
        phase: "starting",
        ids: [] as string[],
        attachmentBefore: false,
        attachmentAfter: false,
      },
    });
    const location = context.location ?? context.data.location.default();
    const keeper = await context.client.session.create({
      title: "draft-selected",
      location,
    });
    const target = await context.client.session.create({
      title: "draft-target",
      location,
    });
    for (const s of [keeper, target]) await context.data.session.sync(s.id);
    context.ui.tabs.open(keeper.id);
    context.ui.tabs.focus(keeper.id);
    context.ui.tabs.open(target.id);
    context.ui.tabs.focus(target.id);
    context.ui.router.navigate({ type: "session", sessionID: target.id });
    const imageAvailable = () =>
      context.keymap
        .commands()
        .some(
          (c) =>
            c.title === "View image attachments" &&
            (typeof c.enabled === "function"
              ? c.enabled()
              : c.enabled !== false),
        );
    const fail = async () => {
      await save((draft) => {
        draft.phase = "failed";
      });
    };
    let stopped = false,
      checking = false,
      acting = false;
    context.keymap.layer(() => ({
      mode: "global",
      priority: 10000,
      commands: [
        {
          id: "test.draft.arm",
          bind: "f9",
          run: async (_input, event) => {
            event?.preventDefault();
            event?.stopPropagation();
            const tabs = context.ui.tabs.list();
            if (
              report.phase === "ready" &&
              tabs.some((t) => t.sessionID === target.id && t.active) &&
              tabs.some((t) => t.sessionID === keeper.id)
            )
              await save((draft) => {
                draft.phase = "input-ready";
              });
          },
        },
        {
          id: "test.draft.advance",
          bind: "f8",
          run: async (_input, event) => {
            event?.preventDefault();
            event?.stopPropagation();
            if (acting || stopped) return;
            acting = true;
            try {
              if (report.phase === "attachment-ready") {
                if (!imageAvailable())
                  throw new Error("No native image attachment before close");
                context.ui.tabs.focus(keeper.id);
                context.ui.router.navigate({
                  type: "session",
                  sessionID: keeper.id,
                });
                await save((draft) => {
                  draft.attachmentBefore = true;
                  draft.phase = "closing";
                });
              } else if (report.phase === "closed") {
                await save((draft) => {
                  draft.phase = "restoring";
                });
                context.keymap.dispatch("wrangler.restore");
              } else if (report.phase === "restored") {
                if (
                  !imageAvailable() ||
                  !context.keymap
                    .commands()
                    .some((c) => c.id === "prompt.clear")
                )
                  throw new Error("Restored draft command missing");
                // Python has independently observed the restored text. Clear locally before any slash command.
                context.keymap.dispatch("prompt.clear");
                await save((draft) => {
                  draft.phase = "clearing";
                });
              }
            } catch {
              await fail();
            } finally {
              acting = false;
            }
          },
        },
      ],
    }));
    await save((draft) => {
      draft.ids = [keeper.id, target.id];
      draft.phase = "ready";
    });
    const timer = setInterval(async () => {
      if (checking || stopped) return;
      checking = true;
      try {
        const tabs = context.ui.tabs.list();
        if (
          report.phase === "input-ready" &&
          imageAvailable() &&
          tabs.some((t) => t.sessionID === target.id && t.active)
        ) {
          await save((draft) => {
            draft.phase = "attachment-ready";
          });
        } else if (
          report.phase === "closing" &&
          !tabs.some((t) => t.sessionID === target.id)
        ) {
          await save((draft) => {
            draft.phase = "closed";
          });
        } else if (
          report.phase === "restoring" &&
          tabs.some((t) => t.sessionID === target.id && t.active) &&
          imageAvailable()
        ) {
          await save((draft) => {
            draft.attachmentAfter = true;
            draft.phase = "restored";
          });
        } else if (report.phase === "clearing" && !imageAvailable()) {
          for (const sessionID of report.ids) {
            await context.client.session.get({ sessionID });
            if (
              (await context.client.session.inbox.list({ sessionID })).length ||
              (await context.client.message.list({ sessionID })).data.length
            )
              throw new Error("Draft was submitted");
          }
          await save((draft) => {
            draft.phase = "passed";
          });
        }
      } catch {
        await fail();
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
