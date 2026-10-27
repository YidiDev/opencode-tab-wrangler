// Isolated local-dummy fixture. Execution requires the driver's explicit submit option.
import type { Plugin } from "@opencode/plugin/tui";

export default {
  id: "test.tab-wrangler-probe",
  async setup(context) {
    const [report, save] = context.storage.store("results", {
      initial: {
        phase: "starting",
        ids: [] as string[],
        protectedDuringCleanup: false,
        workingAt: 0,
        completedAt: 0,
        submitted: false,
      },
    });
    if (["passed", "failed"].includes(report.phase)) return;
    const selected = (await context.client.model.default()).data;
    if (selected?.providerID !== "fixture" || selected.modelID !== "holding")
      throw new Error("Only the local fixture model is permitted");
    const location = context.location ?? context.data.location.default();
    const sessions = report.ids.length
      ? await Promise.all(
          report.ids.map((sessionID) =>
            context.client.session.get({ sessionID }),
          ),
        )
      : await (async () => {
          const keeper = await context.client.session.create({
            title: "running-keeper",
            location,
          });
          const root = await context.client.session.create({
            title: "running-parent",
            location,
          });
          const child = await context.client.session.create({
            title: "running-child",
            parentID: root.id,
            location: { directory: `${location.directory}/child` },
            model: { providerID: "fixture", id: "holding" },
          });
          const idle = await Promise.all(
            ["a", "b"].map((suffix) =>
              context.client.session.create({
                title: `running-idle-${suffix}`,
                location,
              }),
            ),
          );
          return [keeper, root, child, ...idle];
        })();
    if (sessions.length !== 5)
      throw new Error("Incomplete running fixture state");
    const [keeper, root, child, ...idle] = sessions;
    for (const s of sessions) await context.data.session.sync(s.id);
    if (!report.ids.length) {
      context.ui.tabs.open(keeper.id);
      context.ui.tabs.focus(keeper.id);
      for (const s of [root, ...idle]) context.ui.tabs.open(s.id);
      context.ui.tabs.focus(root.id);
      context.ui.router.navigate({ type: "session", sessionID: child.id });
      await save((draft) => {
        draft.ids = sessions.map((s) => s.id);
        draft.phase = "ready";
      });
    }
    context.keymap.layer(() => ({
      mode: "global",
      priority: 10000,
      commands: [
        {
          id: "test.running.arm",
          bind: "f8",
          run: async (_input, event) => {
            event?.preventDefault();
            event?.stopPropagation();
            if (report.phase === "ready")
              await save((draft) => {
                draft.phase = "armed";
              });
            else if (report.phase === "closed") {
              await save((draft) => {
                draft.phase = "restoring";
              });
              context.keymap.dispatch("wrangler.restore");
            }
          },
        },
      ],
    }));
    let stopped = false,
      checking = false,
      began = report.workingAt,
      ended = report.completedAt;
    const timer = setInterval(async () => {
      if (stopped || checking || ["passed", "failed"].includes(report.phase))
        return;
      checking = true;
      try {
        const active =
          (await context.client.session.active())[child.id]?.type === "running";
        const tabs = context.ui.tabs.list();
        const parent = tabs.find((t) => t.sessionID === root.id);
        if (report.phase === "armed" && active) {
          if (idle.some((s) => !tabs.some((t) => t.sessionID === s.id)))
            throw new Error(
              "Idle fixtures disappeared before running observation",
            );
          began = Date.now();
          context.ui.tabs.focus(keeper.id);
          context.ui.router.navigate({ type: "session", sessionID: keeper.id });
          await save((draft) => {
            draft.phase = "working";
            draft.workingAt = began;
          });
        } else if (report.phase === "working") {
          if (active) {
            if (
              !parent ||
              parent.active ||
              !tabs.some((t) => t.sessionID === keeper.id && t.active)
            )
              throw new Error("Background running parent was not protected");
            if (
              Date.now() - began >= 12000 &&
              idle.every((s) => !tabs.some((t) => t.sessionID === s.id))
            )
              await save((draft) => {
                draft.protectedDuringCleanup = true;
              });
          } else {
            if (
              !report.protectedDuringCleanup ||
              (await context.client.session.get({ sessionID: child.id }))
                .outcome !== "succeeded"
            )
              throw new Error(
                "Real running interval or successful completion missing",
              );
            ended = Date.now();
            await save((draft) => {
              draft.phase = "completed";
              draft.completedAt = ended;
            });
          }
        } else if (report.phase === "completed" && !parent) {
          for (const s of sessions)
            await context.client.session.get({ sessionID: s.id });
          await save((draft) => {
            draft.phase = "closed";
          });
        } else if (report.phase === "restoring" && parent?.active) {
          await save((draft) => {
            draft.phase = "passed";
          });
        }
        if (ended && Date.now() - ended > 35000 && report.phase !== "passed")
          throw new Error(
            "Completed parent did not become eligible and restore",
          );
      } catch {
        await save((draft) => {
          draft.phase = "failed";
        });
      } finally {
        checking = false;
      }
    }, 100);
    if (context.options.submit === true && !report.submitted) {
      if (
        report.phase !== "armed" ||
        !["owner", "owner-authorized-agent"].includes(
          String(context.options.initiator),
        )
      )
        throw new Error("Missing explicit local execution authorization");
      // Persist one-shot admission before waking this fixture child; owner replacement cannot replay it.
      await save((draft) => {
        draft.submitted = true;
      });
      await context.client.session.prompt({
        sessionID: child.id,
        text: "Reply once without tools.",
        resume: true,
      });
    }
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  },
} satisfies Plugin.Definition;
