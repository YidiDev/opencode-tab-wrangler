import type { Plugin } from "@opencode/plugin/tui";
import type { Tab } from "./model";

export interface Host {
  enabled(): boolean;
  list(): Tab[];
  refresh(id: string): Promise<void>;
  close(id: string): boolean;
  open(id: string, focus: boolean): boolean;
  exists(id: string): Promise<boolean>;
  move(id: string, index: number): void;
  dispose?(): void;
}

export function createHost(context: Plugin.Context): Host {
  const d = context.data.session;
  const abort = new AbortController();
  const assertActive = () => {
    if (abort.signal.aborted) throw new Error("Plugin unloaded");
  };
  const families = new Map<string, string[]>();
  const synced = new Set<string>();
  let active: Record<string, { type: "running" }> = {};
  const family = (id: string) => [
    ...new Set([id, ...(families.get(id) ?? []), ...d.family(id)]),
  ];
  return {
    enabled: () => !abort.signal.aborted && context.ui.tabs.enabled(),
    list() {
      const route = context.ui.router.current();
      const activeRoot =
        route.type === "session" ? d.root(route.sessionID) : undefined;
      return context.ui.tabs.list().map((tab, index) => {
        const info = d.get(tab.sessionID),
          members = family(tab.sessionID);
        const pending = members.some((id) =>
          d.pending.list(id).some((item) => item.type !== "synthetic"),
        );
        return {
          id: tab.sessionID,
          title: tab.title ?? "Untitled session",
          directory: info?.location.directory ?? "",
          project: info?.projectID ?? "",
          index,
          active: tab.active || activeRoot === tab.sessionID,
          busy: tab.busy,
          attention: tab.attention,
          unread: tab.unread,
          running: members.some(
            (id) =>
              d.status(id) === "running" || active[id]?.type === "running",
          ),
          permissions: members.some((id) =>
            Boolean(d.permission.list(id)?.length),
          ),
          questions: members.some((id) =>
            Boolean(d.form.list(id, d.get(id)?.location)?.length),
          ),
          pending,
          known:
            synced.has(tab.sessionID) &&
            members.every(
              (id) =>
                Boolean(d.get(id)) &&
                d.permission.list(id) !== undefined &&
                d.form.list(id, d.get(id)?.location) !== undefined,
            ),
          updated: Math.max(
            0,
            ...members.map((id) => d.get(id)?.time.updated ?? 0),
          ),
        };
      });
    },
    async refresh(id) {
      assertActive();
      synced.delete(id);
      // Discover descendants through the public paginated API rather than assuming a warm cache is complete.
      const found = new Set<string>();
      const queue = [id];
      while (queue.length) {
        const parent = queue.shift()!;
        if (found.has(parent)) continue;
        if (found.size >= 256)
          throw new Error("Session family too large to verify safely");
        found.add(parent);
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          assertActive();
          const page = await context.client.session.list(
            cursor ? { cursor, limit: 100 } : { parentID: parent, limit: 100 },
            { signal: abort.signal },
          );
          assertActive();
          for (const child of page.data) {
            if (child.parentID !== parent)
              throw new Error("Unexpected session family response");
            queue.push(child.id);
          }
          cursor = page.cursor.next ?? undefined;
          if (cursor && seen.has(cursor))
            throw new Error("Repeated session cursor");
          if (cursor) seen.add(cursor);
          if (queue.length > 256)
            throw new Error("Session family too large to verify safely");
        } while (cursor);
      }
      const ids = [...found];
      for (const member of ids) {
        assertActive();
        d.invalidate(member);
        d.pending.invalidate(member);
        d.permission.invalidate(member);
        await d.sync(member);
        assertActive();
        const info = d.get(member);
        if (!info) throw new Error("Session unavailable");
        d.form.invalidate(member, info.location);
        await Promise.all([
          d.pending.sync(member),
          d.permission.sync(member),
          d.form.sync(member, info.location),
        ]);
      }
      families.set(id, ids);
      assertActive();
      active = await context.client.session.active({ signal: abort.signal });
      assertActive();
      synced.add(id);
    },
    close: (id) => !abort.signal.aborted && context.ui.tabs.close(id),
    open: (id, focus) =>
      !abort.signal.aborted &&
      (focus ? context.ui.tabs.focus(id) : context.ui.tabs.open(id)),
    async exists(id) {
      assertActive();
      const session = await context.client.session.get(
        { sessionID: id },
        { signal: abort.signal },
      );
      return session.id === id;
    },
    move: (id, index) => {
      if (!abort.signal.aborted) context.ui.tabs.move(id, index);
    },
    dispose: () => abort.abort(),
  };
}
