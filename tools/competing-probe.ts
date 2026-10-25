// Two isolated CLI owners, one private server and one native shared layout.
// Explicit exclusions protect both keepers: the API cannot see the other CLI's selection.
import type { Plugin } from "@opencode/plugin/tui";

interface Actor {
  protected: boolean;
  invisible: boolean;
  closed: boolean;
  restored: boolean;
}
interface Report {
  phase: string;
  ids: string[];
  actors: Record<string, Actor>;
}
export default {
  id: "test.tab-wrangler-probe",
  async setup(context) {
    const role = context.options.role === "b" ? "b" : "a";
    const [report, save] = context.storage.store<Report>("results", {
      initial: { phase: "starting", ids: [], actors: {} },
    });
    if (!report.ids.length) {
      if (role !== "a") throw new Error("Peer started before coordinator");
      const location = context.location ?? context.data.location.default();
      const sessionIDs: string[] = [];
      for (const [index, title] of [
        "competing-selected-a",
        "competing-selected-b",
        "competing-idle-1",
        "competing-idle-2",
      ].entries()) {
        const s = await context.client.session.create({
          title,
          location:
            context.options.scope === "cwd" && index % 2 === 1
              ? { directory: `${location.directory}/child` }
              : location,
        });
        sessionIDs.push(s.id);
      }
      await save((draft) => {
        draft.ids = sessionIDs;
        draft.phase = "ready";
      });
    }
    const own = report.ids[role === "a" ? 0 : 1],
      other = report.ids[role === "a" ? 1 : 0];
    const ownIDs = [own, report.ids[role === "a" ? 2 : 3]];
    for (const sessionID of ownIDs) {
      await context.data.session.sync(sessionID);
      context.ui.tabs.open(sessionID);
    }
    context.ui.tabs.focus(own);
    context.ui.router.navigate({ type: "session", sessionID: own });
    const enabled = context.options.epoch === 1;
    if (enabled)
      await save((draft) => {
        if (draft.phase === "unacknowledged-protected") draft.phase = "enabled";
      });
    let stopped = false,
      checking = false,
      observed = false,
      restoreRequested = false;
    const began = Date.now();
    const timer = setInterval(async () => {
      if (checking || stopped) return;
      checking = true;
      try {
        const tabs = context.ui.tabs.list(),
          ids = tabs.map((t) => t.sessionID);
        const visible = context.options.scope === "cwd" ? ownIDs : report.ids;
        if (visible.every((id) => ids.includes(id))) observed = true;
        if (
          !enabled &&
          report.phase === "ready" &&
          Date.now() - began >= 11000
        ) {
          if (
            !observed ||
            !visible.every((id) => ids.includes(id)) ||
            (context.options.scope === "cwd" &&
              report.ids
                .filter((id) => !ownIDs.includes(id))
                .some((id) => ids.includes(id))) ||
            !tabs.some((t) => t.sessionID === own && t.active) ||
            tabs.some((t) => t.sessionID === other && t.active)
          )
            throw new Error(
              "Unacknowledged shared layout changed or selection semantics differ",
            );
          await save((draft) => {
            draft.actors[role] = {
              protected: true,
              invisible: true,
              closed: false,
              restored: false,
            };
            if (draft.actors.a?.protected && draft.actors.b?.protected)
              draft.phase = "unacknowledged-protected";
          });
        } else if (
          enabled &&
          report.phase === "enabled" &&
          observed &&
          report.ids.slice(2).every((id) => !ids.includes(id))
        ) {
          if (
            !tabs.some((t) => t.sessionID === own && t.active) ||
            (context.options.scope !== "cwd" && !ids.includes(other))
          )
            throw new Error("Explicit keeper exclusion lost");
          for (const sessionID of report.ids)
            await context.client.session.get({ sessionID });
          await save((draft) => {
            draft.actors[role].closed = true;
          });
        }
        if (
          role === "a" &&
          report.phase === "enabled" &&
          report.actors.a?.closed &&
          report.actors.b?.closed
        ) {
          await save((draft) => {
            draft.phase = "restoring";
          });
          context.keymap.dispatch("wrangler.restore");
        } else if (
          role === "b" &&
          context.options.scope === "cwd" &&
          report.phase === "restoring" &&
          !restoreRequested
        ) {
          restoreRequested = true;
          context.keymap.dispatch("wrangler.restore");
        } else if (
          report.phase === "restoring" &&
          report.ids.slice(2).some((id) => ids.includes(id))
        ) {
          for (const sessionID of report.ids)
            await context.client.session.get({ sessionID });
          await save((draft) => {
            draft.actors[role].restored = true;
            if (draft.actors.a?.restored && draft.actors.b?.restored)
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
