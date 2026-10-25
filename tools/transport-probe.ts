// Native private-server outage/restart fixture. All sessions remain idle; no generation.
import type { Plugin } from "@opencode/plugin/tui";

interface Report {
  phase: string;
  ids: string[];
  setupCount: number;
  earlyProtected: boolean;
}
export default {
  id: "test.tab-wrangler-probe",
  async setup(context) {
    const [report, save] = context.storage.store<Report>("results", {
      initial: {
        phase: "starting",
        ids: [],
        setupCount: 0,
        earlyProtected: false,
      },
    });
    const scenario = context.options.scenario;
    let stopped = false,
      checking = false,
      phaseAt = Date.now(),
      observed = false;
    await save((draft) => {
      draft.setupCount++;
    });
    if (!report.ids.length) {
      const location = context.location ?? context.data.location.default();
      const sessions = await Promise.all(
        [
          "transport-selected",
          "transport-idle",
          ...(scenario === "restart" ? ["transport-remaining"] : []),
        ].map((title) => context.client.session.create({ title, location })),
      );
      for (const s of sessions) {
        await context.data.session.sync(s.id);
        context.ui.tabs.open(s.id);
      }
      context.ui.tabs.focus(sessions[0].id);
      context.ui.router.navigate({
        type: "session",
        sessionID: sessions[0].id,
      });
      await save((draft) => {
        draft.ids = sessions.map((s) => s.id);
        draft.phase = "ready";
      });
    } else if (scenario === "restart" && report.phase === "restart") {
      for (const sessionID of report.ids)
        await context.client.session.get({ sessionID });
      context.ui.tabs.focus(report.ids[0]);
      context.ui.router.navigate({ type: "session", sessionID: report.ids[0] });
      await save((draft) => {
        draft.phase = "after-restart";
        draft.earlyProtected = false;
      });
      phaseAt = Date.now();
    }
    const target = scenario === "restart" ? report.ids[2] : report.ids[1];
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "test.transport.advance",
          bind: "f8",
          run: async () => {
            if (scenario !== "disconnect") return;
            if (report.phase === "ready") {
              const tabs = context.ui.tabs.list();
              if (
                !report.ids.every((id) =>
                  tabs.some((t) => t.sessionID === id),
                ) ||
                !tabs.some((t) => t.sessionID === report.ids[0] && t.active)
              )
                return;
              await save((draft) => {
                draft.phase = "armed";
              });
            }
          },
        },
        {
          id: "test.transport.offline",
          bind: "f9",
          run: async () => {
            if (scenario !== "disconnect" || report.phase !== "armed") return;
            phaseAt = Date.now();
            await save((draft) => {
              draft.phase = "offline";
            });
          },
        },
      ],
    }));
    const timer = setInterval(async () => {
      if (checking || stopped) return;
      checking = true;
      try {
        const tabs = context.ui.tabs.list(),
          ids = tabs.map((t) => t.sessionID),
          elapsed = Date.now() - phaseAt;
        if (report.ids.every((id) => ids.includes(id))) observed = true;
        if (
          scenario === "restart" &&
          report.phase === "ready" &&
          observed &&
          report.ids.slice(1).some((id) => !ids.includes(id))
        ) {
          const closed = report.ids.slice(1).filter((id) => !ids.includes(id));
          const remaining = report.ids.slice(1).find((id) => ids.includes(id));
          if (closed.length !== 1 || !remaining)
            throw new Error("No remaining tab before restart");
          await save((draft) => {
            draft.ids = [report.ids[0], closed[0], remaining];
            draft.phase = "restart";
          });
        } else if (report.phase === "offline" && elapsed >= 11500) {
          if (!report.ids.every((id) => ids.includes(id)))
            throw new Error("Outage lost a fixture tab");
          await save((draft) => {
            draft.phase = "offline-protected";
          });
        } else if (report.phase === "offline-protected") {
          if (!report.ids.every((id) => ids.includes(id)))
            throw new Error("Outage lost a fixture tab");
          // Recovery is acknowledged by a real server read, not a key sent while
          // the connection overlay may own input. A frozen server cannot satisfy it.
          try {
            await context.client.session.get(
              { sessionID: target },
              { signal: AbortSignal.timeout(500) },
            );
          } catch {
            return;
          }
          phaseAt = Date.now();
          await save((draft) => {
            draft.phase = "recovering";
            draft.earlyProtected = false;
          });
        } else if (["recovering", "after-restart"].includes(report.phase)) {
          if (elapsed >= 5200 && elapsed <= 5800) {
            if (!ids.includes(target))
              throw new Error("No fresh recovery grace");
            await save((draft) => {
              draft.earlyProtected = true;
            });
          }
          if (elapsed >= 5800 && !report.earlyProtected)
            throw new Error("Recovery grace unobserved");
          if (elapsed >= 6500 && !ids.includes(target)) {
            if (!tabs.some((t) => t.sessionID === report.ids[0] && t.active))
              throw new Error("Selected fixture lost");
            for (const sessionID of report.ids)
              await context.client.session.get({ sessionID });
            await save((draft) => {
              draft.phase = "restoring";
            });
            context.keymap.dispatch("wrangler.restore");
          }
        } else if (
          report.phase === "restoring" &&
          tabs.some((t) => t.sessionID === target && t.active)
        ) {
          await save((draft) => {
            draft.phase = "passed";
          });
        }
      } catch {
        await save((draft) => {
          draft.phase = "failed";
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
