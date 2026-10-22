import { expect, test } from "bun:test";
import { harness, tab } from "./support";
import type { Entry } from "../src/model";

test("manual cleanup records history and never deletes sessions", async () => {
  const h = harness();
  h.advance(61000);
  expect(await h.controller.run()).toBe(1);
  expect(h.closed).toEqual(["one"]);
  expect(h.state.corral[0].state).toBe("closed");
  expect(h.notices).toHaveLength(1);
});
test("preview ticks never close tabs (regression)", async () => {
  const h = harness({ idleMinutes: 0, graceMinutes: 0 });
  await h.controller.tick();
  h.advance(30000);
  await h.controller.tick();
  expect(h.closed).toEqual([]);
});
test("auto ticks close only after grace", async () => {
  const h = harness({ mode: "auto" });
  await h.controller.tick();
  expect(h.closed).toEqual([]);
  h.advance(60000);
  await h.controller.tick();
  expect(h.closed).toEqual(["one"]);
});
test.each([
  { mode: "off" },
  { connectionKey: "unconfigured" },
  { acknowledgeSharedTabs: false },
])("setup gate %j", async (options) => {
  const h = harness(options);
  h.advance(61000);
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("pause and resume restart grace", async () => {
  const h = harness();
  h.advance(61000);
  h.controller.pause(null);
  expect(await h.controller.run()).toBe(0);
  h.controller.resume();
  expect(await h.controller.run()).toBe(0);
  h.advance(60000);
  expect(await h.controller.run()).toBe(1);
});
test("expired pause grants fresh grace on tick", async () => {
  const h = harness({ mode: "auto" });
  h.controller.pause(1);
  h.advance(61000);
  await h.controller.tick();
  expect(h.closed).toEqual([]);
});
test("sleep/resume observation gaps grant grace", async () => {
  const h = harness({ mode: "auto" });
  await h.controller.tick();
  h.advance(3600000);
  await h.controller.tick();
  expect(h.closed).toEqual([]);
});
test("clock rollback grants grace", async () => {
  const h = harness({ mode: "auto" });
  await h.controller.tick();
  h.advance(-500);
  await h.controller.tick();
  expect(h.closed).toEqual([]);
});
test("freshly selected tab is rechecked after persistence", async () => {
  const h = harness();
  h.advance(61000);
  h.onWrite(() => h.patch("one", { active: true }));
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
  expect(h.state.corral).toEqual([]);
});
test("work starting during persistence prevents close", async () => {
  const h = harness();
  h.advance(61000);
  h.onWrite(() => h.patch("one", { running: true, busy: true }));
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("background events during persistence prevent close", async () => {
  const h = harness();
  h.advance(61000);
  h.onWrite(() => h.controller.touch("one"));
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("failed persistence means no closure", async () => {
  const h = harness();
  h.advance(61000);
  h.failPersist();
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("failed sync protects affected tabs", async () => {
  const h = harness();
  h.advance(61000);
  h.failRefresh();
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("close returning false leaves no fake successful history", async () => {
  const h = harness();
  h.advance(61000);
  h.failClose();
  expect(await h.controller.run()).toBe(0);
  expect(h.state.corral).toEqual([]);
});
test("unconfirmed closure is retained as uncertain and never retried automatically", async () => {
  const h = harness();
  h.advance(61000);
  h.delayClose();
  expect(await h.controller.run()).toBe(0);
  expect(h.state.corral[0].state).toBe("uncertain");
  await h.controller.run();
  expect(h.closed).toHaveLength(1);
});
test("floor is re-evaluated between closes", async () => {
  const h = harness({ minTabs: 1 }, [tab("a"), tab("b"), tab("c")]);
  h.advance(61000);
  expect(await h.controller.run()).toBe(2);
  expect(h.tabs()).toHaveLength(1);
});
test("locks and unlock grant grace", async () => {
  const h = harness();
  h.advance(61000);
  await h.controller.lock("one", null);
  expect(await h.controller.run()).toBe(0);
  await h.controller.unlock("one");
  expect(await h.controller.run()).toBe(0);
  h.advance(61000);
  expect(await h.controller.run()).toBe(1);
});
test("reopening receives fresh grace and removes history", async () => {
  const h = harness();
  h.advance(61000);
  await h.controller.run();
  const id = h.state.corral[0].id;
  expect(await h.controller.restore(id, false)).toBe(true);
  expect(h.state.corral).toEqual([]);
  expect(await h.controller.run()).toBe(0);
  expect(h.opened).toEqual(["one"]);
});
test("unavailable session retains corral entry", async () => {
  const h = harness();
  h.advance(61000);
  await h.controller.run();
  h.missing();
  expect(await h.controller.restore(h.state.corral[0].id)).toBe(false);
  expect(h.state.corral).toHaveLength(1);
});
test("dispose during write prevents external effect", async () => {
  const h = harness();
  h.advance(61000);
  h.onWrite(() => h.controller.dispose());
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("same-tab reopen by user resets observation", () => {
  const h = harness();
  h.advance(61000);
  h.setTabs([]);
  h.controller.observe();
  h.setTabs([tab()]);
  h.controller.observe();
  expect(h.controller.preview()).toEqual([]);
});
test("re-enabling native tabs grants fresh grace instead of catching up closures", async () => {
  const h = harness();
  let enabled = false;
  h.host.enabled = () => enabled;
  h.controller.observe();
  h.advance(3600000);
  expect(await h.controller.run()).toBe(0);
  enabled = true;
  h.controller.observe();
  expect(await h.controller.run()).toBe(0);
  h.advance(61000);
  expect(await h.controller.run()).toBe(1);
});
test("saved preferences validate, preserve file overrides, and reset timers", async () => {
  const h = harness({ idleMinutes: 1 });
  h.advance(61000);
  await h.controller.preferences({ idleMinutes: 90, batchSize: 1 });
  expect(h.controller.config().idleMinutes).toBe(1);
  expect(h.controller.config().batchSize).toBe(1);
  expect(h.controller.preview()).toEqual([]);
  await expect(h.controller.preferences({ batchSize: -1 })).rejects.toThrow();
});
test("reconcile intents as uncertain without retry; isolates connection history", async () => {
  const h = harness();
  const entry: Entry = {
    id: "intent",
    scope: "test",
    sessionID: "one",
    directory: "/",
    project: "p",
    time: h.now(),
    index: 0,
    state: "intent",
    reason: "automatic-idle",
  };
  h.state.corral.push(entry, { ...entry, id: "other", scope: "remote" });
  await h.controller.reconcile();
  expect(h.state.corral[0].state).toBe("uncertain");
  expect(h.controller.history()).toHaveLength(1);
  h.advance(61000);
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("concurrent runs are serialized", async () => {
  const h = harness();
  h.advance(61000);
  await Promise.all([
    h.controller.run(),
    h.controller.run(),
    h.controller.run(),
  ]);
  expect(h.closed).toHaveLength(1);
});
test("a competing uncertain intent cannot be bypassed by our own intent", async () => {
  const h = harness();
  h.advance(61000);
  let inserted = false;
  h.onWrite(() => {
    if (inserted || !h.state.corral.length) return;
    inserted = true;
    h.state.corral.push({
      ...h.state.corral[0],
      id: "other-client-intent",
      state: "uncertain",
    });
  });
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("slow refresh grants a new grace period", async () => {
  const h = harness();
  h.advance(61000);
  h.onRefresh(() => h.advance(120000));
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("disposed generations cannot change settings or locks", async () => {
  const h = harness();
  h.controller.dispose();
  await expect(h.controller.preferences({ mode: "auto" })).rejects.toThrow(
    "unloaded",
  );
  await expect(h.controller.lock("one", null)).rejects.toThrow("unloaded");
  expect(h.state.preferences).toEqual({});
  expect(h.state.locks).toEqual({});
});
test("manual lock and pause durations cannot overflow stored timestamps", async () => {
  const h = harness();
  await expect(h.controller.lock("one", 1e308)).rejects.toThrow("duration");
  expect(() => h.controller.pause(1e308)).toThrow("duration");
});
test("history privacy setting scrubs persisted titles immediately", async () => {
  const h = harness();
  h.advance(61000);
  await h.controller.run();
  expect(h.state.corral[0].title).toBeDefined();
  await h.controller.preferences({ history: { rememberTitles: false } });
  expect(h.state.corral[0].title).toBeUndefined();
});
