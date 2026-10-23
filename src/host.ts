import type { Plugin } from "@opencode/plugin/tui";
import type { SessionInfo } from "@opencode/client";
import type { Tab } from "./model";
import { withDeadline } from "./deadline";

export interface RefreshOptions {
  timeoutMs: number;
  concurrency: number;
}
export interface Host {
  enabled(): boolean;
  list(): Tab[];
  refresh(id: string, options?: RefreshOptions): Promise<void>;
  refreshMany?(ids: string[], options: RefreshOptions): Promise<void>;
  close(id: string): boolean;
  open(id: string, focus: boolean): boolean;
  exists(id: string): Promise<boolean>;
  move(id: string, index: number): void;
  dispose?(): void;
}
interface Snapshot {
  info: SessionInfo;
  members: string[];
  running: boolean;
  pending: boolean;
  permissions: boolean;
  questions: boolean;
  updated: number;
}
const defaults: RefreshOptions = { timeoutMs: 15000, concurrency: 3 };

export function createHost(context: Plugin.Context): Host {
  const d = context.data.session,
    lifetime = new AbortController();
  const snapshots = new Map<string, Snapshot>();
  const generations = new Map<string, symbol>();
  let rotation = 0;
  const openIDs = () => new Set(context.ui.tabs.list().map((t) => t.sessionID));
  function prune() {
    const open = openIDs();
    for (const id of snapshots.keys()) if (!open.has(id)) snapshots.delete(id);
    for (const id of generations.keys())
      if (!open.has(id)) generations.delete(id);
  }
  function assertActive(signal = lifetime.signal) {
    if (signal.aborted || lifetime.signal.aborted)
      throw new Error("Plugin unloaded or refresh expired");
  }

  async function read(
    id: string,
    signal: AbortSignal,
    active: Record<string, { type: "running" }>,
  ): Promise<Snapshot> {
    const queue = [id],
      found = new Set<string>();
    while (queue.length) {
      assertActive(signal);
      const parent = queue.shift()!;
      if (found.has(parent)) continue;
      if (found.size >= 256)
        throw new Error("Session family too large to verify safely");
      found.add(parent);
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await context.client.session.list(
          cursor ? { cursor, limit: 100 } : { parentID: parent, limit: 100 },
          { signal },
        );
        assertActive(signal);
        for (const child of page.data) {
          if (child.parentID !== parent || found.has(child.id))
            throw new Error("Unexpected session family response");
          queue.push(child.id);
        }
        cursor = page.cursor.next ?? undefined;
        if (cursor && cursors.has(cursor))
          throw new Error("Repeated session cursor");
        if (cursor) cursors.add(cursor);
        if (queue.length > 256 || cursors.size > 256)
          throw new Error("Session family too large to verify safely");
      } while (cursor);
    }
    const members = [...found];
    let info: SessionInfo | undefined,
      updated = 0,
      pending = false,
      permissions = false,
      questions = false;
    for (const member of members) {
      assertActive(signal);
      const [session, inbox, requests, forms] = await Promise.all([
        context.client.session.get({ sessionID: member }, { signal }),
        context.client.session.inbox.list({ sessionID: member }, { signal }),
        context.client.permission.list({ sessionID: member }, { signal }),
        context.client.session.form.list({ sessionID: member }, { signal }),
      ]);
      assertActive(signal);
      if (session.id !== member) throw new Error("Unexpected session metadata");
      if (member === id) info = session;
      updated = Math.max(updated, session.time.updated);
      pending ||= inbox.some((item) => item.type !== "synthetic");
      permissions ||= requests.length > 0;
      questions ||= forms.length > 0;
    }
    if (!info) throw new Error("Session unavailable");
    return {
      info,
      members,
      updated,
      pending,
      permissions,
      questions,
      running: members.some((member) => active[member]?.type === "running"),
    };
  }

  async function refreshMany(ids: string[], options: RefreshOptions) {
    assertActive();
    prune();
    if (!ids.length) return;
    const tokens = new Map(ids.map((id) => [id, Symbol(id)]));
    for (const [id, token] of tokens) {
      generations.set(id, token);
      snapshots.delete(id);
    }
    // One global active read per bounded pass, not per root. Snapshot publication is generation-fenced.
    await withDeadline(
      async (signal) => {
        const active =
          ids.length > 1 ? await context.client.session.active({ signal }) : {};
        assertActive(signal);
        const ordered = [
          ...ids.slice(rotation % Math.max(ids.length, 1)),
          ...ids.slice(0, rotation % Math.max(ids.length, 1)),
        ];
        let index = 0;
        await Promise.all(
          Array.from(
            { length: Math.min(options.concurrency, ids.length) },
            async () => {
              while (index < ordered.length && !signal.aborted) {
                const id = ordered[index++];
                rotation++;
                try {
                  const snapshot = await withDeadline(
                    async (rootSignal) => {
                      const value = await read(id, rootSignal, active);
                      if (ids.length === 1) {
                        const latest = await context.client.session.active({
                          signal: rootSignal,
                        });
                        value.running = value.members.some(
                          (member) => latest[member]?.type === "running",
                        );
                      }
                      return value;
                    },
                    Math.max(
                      1,
                      options.timeoutMs /
                        Math.min(options.concurrency, ids.length),
                    ),
                    signal,
                  );
                  assertActive(signal);
                  if (
                    generations.get(id) === tokens.get(id) &&
                    openIDs().has(id)
                  )
                    snapshots.set(id, snapshot);
                } catch {
                  // Unknown roots stay absent; failed or late reads never resurrect trusted state.
                }
              }
            },
          ),
        );
      },
      options.timeoutMs,
      lifetime.signal,
    );
  }
  return {
    enabled: () => !lifetime.signal.aborted && context.ui.tabs.enabled(),
    list() {
      prune();
      const route = context.ui.router.current();
      const activeRoot =
        route.type === "session" ? d.root(route.sessionID) : undefined;
      return context.ui.tabs.list().map((tab, index) => {
        const s = snapshots.get(tab.sessionID),
          cached = d.get(tab.sessionID),
          info = s?.info ?? cached;
        const identityConsistent =
          !s ||
          !cached ||
          (cached.title === s.info.title &&
            cached.projectID === s.info.projectID &&
            cached.location.directory === s.info.location.directory);
        const members = [
          ...new Set([
            tab.sessionID,
            ...(s?.members ?? []),
            ...d.family(tab.sessionID),
          ]),
        ];
        const selectedChild =
          route.type === "session" && members.includes(route.sessionID);
        const unread =
          info?.time.idle !== undefined &&
          (info.time.viewed === undefined || info.time.idle > info.time.viewed)
            ? info.outcome === "failed"
              ? "error"
              : "activity"
            : undefined;
        return {
          id: tab.sessionID,
          title: tab.title ?? info?.title ?? "Untitled session",
          directory: info?.location.directory ?? "",
          project: info?.projectID ?? "",
          index,
          active: tab.active || activeRoot === tab.sessionID || selectedChild,
          busy: tab.busy,
          attention: tab.attention,
          unread:
            tab.unread === "error" || unread === "error"
              ? "error"
              : (tab.unread ?? unread),
          running:
            Boolean(s?.running) ||
            members.some((id) => d.status(id) === "running"),
          pending:
            Boolean(s?.pending) ||
            members.some((id) =>
              d.pending.list(id).some((item) => item.type !== "synthetic"),
            ),
          permissions:
            Boolean(s?.permissions) ||
            members.some((id) => Boolean(d.permission.list(id)?.length)),
          questions:
            Boolean(s?.questions) ||
            members.some((id) =>
              Boolean(d.form.list(id, d.get(id)?.location)?.length),
            ),
          known:
            Boolean(s) &&
            identityConsistent &&
            members.every((id) => s!.members.includes(id)),
          updated: Math.max(
            s?.updated ?? 0,
            ...members.map((id) => d.get(id)?.time.updated ?? 0),
          ),
        };
      });
    },
    refreshMany,
    async refresh(id, options = defaults) {
      await refreshMany([id], options);
      if (!snapshots.has(id))
        throw new Error("Session state could not be verified");
    },
    close: (id) => !lifetime.signal.aborted && context.ui.tabs.close(id),
    open: (id, focus) =>
      !lifetime.signal.aborted &&
      (focus ? context.ui.tabs.focus(id) : context.ui.tabs.open(id)),
    async exists(id) {
      return withDeadline(
        async (signal) => {
          assertActive(signal);
          const info = await context.client.session.get(
            { sessionID: id },
            { signal },
          );
          return info.id === id;
        },
        defaults.timeoutMs,
        lifetime.signal,
      );
    },
    move: (id, index) => {
      if (!lifetime.signal.aborted) context.ui.tabs.move(id, index);
    },
    dispose() {
      lifetime.abort();
      snapshots.clear();
      generations.clear();
    },
  };
}
