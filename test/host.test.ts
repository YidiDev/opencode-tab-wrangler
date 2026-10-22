import { expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/tui";
import { createHost } from "../src/host";

function fixture() {
  const info: Record<string, any> = {
    root: {
      id: "root",
      title: "Root",
      projectID: "project",
      time: { updated: 10 },
      location: { directory: "/root" },
    },
    child: {
      id: "child",
      parentID: "root",
      projectID: "project",
      time: { updated: 20 },
      location: { directory: "/child" },
    },
  };
  const pending: Record<string, any[]> = {},
    permissions: Record<string, any[]> = {},
    forms: Record<string, any[]> = {};
  const running = new Set<string>();
  const active: Record<string, { type: "running" }> = {};
  const calls: string[] = [];
  let fail = false,
    route = "root",
    repeat = false;
  const d = {
    get: (id: string) => info[id],
    family: () => ["root", "child"],
    root: (id: string) => (id === "child" ? "root" : id),
    status: (id: string) => (running.has(id) ? "running" : "idle"),
    invalidate: () => {},
    sync: async () => {
      if (fail) throw new Error("offline");
    },
    pending: {
      list: (id: string) => pending[id] ?? [],
      sync: async () => {},
      invalidate: () => {},
    },
    permission: {
      list: (id: string) => permissions[id] ?? [],
      sync: async () => {},
      invalidate: () => {},
    },
    form: {
      list: (id: string) => forms[id],
      sync: async (id: string, location: any) => {
        calls.push(`form:${id}:${location.directory}`);
        forms[id] ??= [];
      },
      invalidate: () => {},
    },
  };
  const context = {
    data: { session: d },
    ui: {
      tabs: {
        enabled: () => true,
        list: () => [
          {
            sessionID: "root",
            title: "Root",
            active: false,
            busy: false,
            attention: false,
          },
        ],
        close: (id: string) => {
          calls.push(`close:${id}`);
          return true;
        },
        open: (id: string) => {
          calls.push(`open:${id}`);
          return true;
        },
        focus: (id: string) => {
          calls.push(`focus:${id}`);
          return true;
        },
        move: (id: string, index: number) => {
          calls.push(`move:${id}:${index}`);
          return true;
        },
      },
      router: { current: () => ({ type: "session", sessionID: route }) },
    },
    client: {
      session: {
        list: async ({ parentID, cursor }: any) => {
          if (fail) throw new Error("offline");
          if (repeat) return { data: [], cursor: { next: "same" } };
          return {
            data: parentID === "root" ? [info.child] : [],
            cursor: { next: null },
          };
        },
        active: async () => active,
        get: async ({ sessionID }: any) => {
          if (!info[sessionID]) throw new Error("not found");
          return info[sessionID];
        },
      },
    },
  } as unknown as Plugin.Context;
  return {
    host: createHost(context),
    info,
    pending,
    permissions,
    forms,
    running,
    active,
    calls,
    fail() {
      fail = true;
    },
    repeat() {
      repeat = true;
    },
    route(id: string) {
      route = id;
    },
  };
}

test("cold state is unknown; sync discovers family and uses each location", async () => {
  const h = fixture();
  expect(h.host.list()[0].known).toBe(false);
  await h.host.refresh("root");
  expect(h.host.list()[0].known).toBe(true);
  expect(h.calls).toContain("form:root:/root");
  expect(h.calls).toContain("form:child:/child");
  expect(h.host.list()[0].updated).toBe(20);
});
test("root is selected while viewing child", async () => {
  const h = fixture();
  h.route("child");
  expect(h.host.list()[0].active).toBe(true);
});
test("child waiting/running/queued work aggregates", async () => {
  const h = fixture();
  await h.host.refresh("root");
  h.running.add("child");
  h.forms.child.push({ id: "q" });
  h.permissions.child = [{ id: "p" }];
  h.pending.child = [{ type: "user" }];
  expect(h.host.list()[0]).toMatchObject({
    running: true,
    questions: true,
    permissions: true,
    pending: true,
  });
});
test("server active snapshot protects work absent from local event cache", async () => {
  const h = fixture();
  h.active.child = { type: "running" };
  await h.host.refresh("root");
  expect(h.host.list()[0].running).toBe(true);
});
test("parked synthetic context is not queued execution", async () => {
  const h = fixture();
  h.pending.child = [{ type: "synthetic" }];
  await h.host.refresh("root");
  expect(h.host.list()[0].pending).toBe(false);
});
test("failed refresh invalidates prior verification", async () => {
  const h = fixture();
  await h.host.refresh("root");
  h.fail();
  await expect(h.host.refresh("root")).rejects.toThrow();
  expect(h.host.list()[0].known).toBe(false);
});
test("repeated pagination fails closed", async () => {
  const h = fixture();
  h.repeat();
  await expect(h.host.refresh("root")).rejects.toThrow("Repeated");
  expect(h.host.list()[0].known).toBe(false);
});
test("only tab APIs are used for close and restore", async () => {
  const h = fixture();
  expect(h.host.close("root")).toBe(true);
  h.host.open("root", false);
  h.host.open("root", true);
  h.host.move("root", 3);
  expect(h.calls).toEqual([
    "close:root",
    "open:root",
    "focus:root",
    "move:root:3",
  ]);
  expect(await h.host.exists("root")).toBe(true);
  await expect(h.host.exists("missing")).rejects.toThrow();
});
test("unloaded adapter refuses new requests and tab effects", async () => {
  const h = fixture();
  h.host.dispose!();
  expect(h.host.enabled()).toBe(false);
  expect(h.host.close("root")).toBe(false);
  expect(h.host.open("root", true)).toBe(false);
  await expect(h.host.refresh("root")).rejects.toThrow("unloaded");
  expect(h.calls).toEqual([]);
});
