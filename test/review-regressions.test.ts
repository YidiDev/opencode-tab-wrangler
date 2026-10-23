import { expect, test } from "bun:test";
import { harness, tab } from "./support";
import { createUI } from "../src/ui";
import { resolveConfig } from "../src/config";
import type { Plugin } from "@opencode/plugin/tui";
import { withDeadline } from "../src/deadline";

test("confirmation binds cleanup to named IDs even if tabs reorder", async () => {
  const h = harness({ batchSize: 1, order: "right-to-left" }, [
    tab("a", { index: 0 }),
    tab("b", { index: 1 }),
  ]);
  h.age(61000);
  let shown = "";
  const context = {
    options: {},
    ui: {
      dialog: {
        alert: async () => {},
        confirm: async ({ message }: { message: string }) => {
          shown = message;
          h.setTabs([tab("b", { index: 0 }), tab("a", { index: 1 })]);
          return true;
        },
      },
    },
  } as unknown as Plugin.Context;
  await createUI(context, h.controller).cleanup();
  expect(shown).toContain("Session b");
  expect(h.closed).not.toContain("a");
});
test("transient visits during refresh reset idle and grace", async () => {
  const h = harness();
  h.age(61000);
  h.onRefresh(() => {
    h.patch("one", { active: true });
    h.controller.observe(true);
    h.patch("one", { active: false });
    h.controller.observe(true);
  });
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("invalid lower-precedence values are never accepted even if masked", () => {
  expect(() =>
    resolveConfig({ idleMinutes: "invalid" }, { idleMinutes: 30 }),
  ).toThrow();
  expect(() =>
    resolveConfig(
      { protections: { questions: "invalid" } },
      { protections: { questions: true } },
    ),
  ).toThrow();
});
test("decision pass resolves configuration once regardless of retained history", () => {
  const rules = Array.from({ length: 20 }, (_, i) => ({
    name: `r${i}`,
    match: { title: "Session*" },
    set: {},
  }));
  const h = harness(
    { rules },
    Array.from({ length: 100 }, (_, i) => tab(`t${i}`)),
  );
  h.state.corral = Array.from({ length: 200 }, (_, i) => ({
    id: `e${i}`,
    scope: "test",
    sessionID: `old${i}`,
    directory: "/",
    project: "p",
    index: 0,
    time: h.now(),
    state: "closed",
    reason: "idle",
  }));
  let calls = 0;
  const config = h.controller.config.bind(h.controller);
  h.controller.config = () => {
    calls++;
    return config();
  };
  const started = performance.now();
  expect(h.controller.decisions()).toHaveLength(100);
  expect(calls).toBe(1);
  expect(performance.now() - started).toBeLessThan(1000);
});
test("tab churn does not accumulate runtime observations", () => {
  const h = harness();
  for (let i = 0; i < 100; i++) {
    h.setTabs([tab(String(i))]);
    h.controller.observe();
  }
  expect(Object.keys(h.runtime.observations)).toHaveLength(1);
  h.setTabs([]);
  h.controller.observe();
  expect(h.runtime.observations).toEqual({});
});
test("housekeeping physically expires durable history and locks without a close", async () => {
  const h = harness({ mode: "off" });
  h.state.corral.push({
    id: "old",
    scope: "test",
    sessionID: "old",
    directory: "/",
    project: "p",
    index: 0,
    time: 1,
    state: "closed",
    reason: "idle",
  });
  h.state.locks.old = { until: 1 };
  h.advance(31 * 86400000);
  await h.controller.tick();
  expect(h.state.corral).toEqual([]);
  expect(h.state.locks).toEqual({});
  expect(h.closed).toEqual([]);
});
test("deliberate batch waits are not mistaken for machine sleep", async () => {
  const h = harness(
    {
      mode: "auto",
      idleMinutes: 1,
      graceMinutes: 3,
      batchSize: 2,
      batchDelaySeconds: 120,
    },
    [tab("a"), tab("b"), tab("c")],
  );
  await h.controller.tick();
  for (let i = 0; i < 6; i++) {
    h.advance(30000);
    await h.controller.tick();
  }
  expect(h.closed).toHaveLength(2);
  h.advance(30000);
  await h.controller.tick();
  expect(h.controller.decisions()[0].reasons).not.toContain("idle-grace");
});
test("deadlines reject hung transports, including cancellation-ignorant ones", async () => {
  const started = Date.now();
  await expect(withDeadline(() => new Promise(() => {}), 5)).rejects.toThrow(
    "deadline",
  );
  expect(Date.now() - started).toBeLessThan(1000);
});
test("deadlines propagate parent cancellation and clean successful work", async () => {
  const parent = new AbortController();
  const promise = withDeadline(
    () => new Promise(() => {}),
    60000,
    parent.signal,
  );
  parent.abort();
  await expect(promise).rejects.toThrow();
  expect(await withDeadline(async () => 42, 100)).toBe(42);
});
test("patching preferences preserves a concurrent unrelated preference", async () => {
  const h = harness();
  const update = h.controller.dep.update;
  h.controller.dep.update = async (mutation) => {
    h.state.preferences.notification = "silent";
    await update(mutation);
  };
  await h.controller.patchPreferences({ batchSize: 1 });
  expect(h.state.preferences).toMatchObject({
    notification: "silent",
    batchSize: 1,
  });
});
test("operational status explains preview/setup/pause rather than promising closure", () => {
  const h = harness();
  expect(h.controller.status()).toContain("Preview");
  h.controller.pause(null);
  expect(h.controller.status()).toContain("Paused");
});
test("result-write failure after an admitted close retains intent and blocks retry", async () => {
  const h = harness();
  h.age(61000);
  const update = h.controller.dep.update;
  let writes = 0;
  h.controller.dep.update = async (mutation) => {
    if (++writes === 2) throw new Error("disk failure");
    await update(mutation);
  };
  await h.controller.run();
  expect(h.closed).toEqual(["one"]);
  expect(h.state.corral[0].state).toBe("intent");
  h.setTabs([tab()]);
  h.controller.observe();
  h.age(61000);
  await h.controller.run();
  expect(h.closed).toHaveLength(1);
});
test("clear history removes only the current namespace", async () => {
  const h = harness();
  h.age(61000);
  await h.controller.run();
  h.state.corral.push({
    ...h.state.corral[0],
    id: "other",
    scope: "elsewhere",
  });
  await h.controller.clearHistory();
  expect(h.state.corral.map((e) => e.id)).toEqual(["other"]);
});
test("restore preserves the stored position without moving already-open sessions", async () => {
  const h = harness({}, [tab("a", { index: 3 })]);
  h.age(61000);
  await h.controller.run();
  const moves: unknown[] = [];
  h.host.move = (id, index) => {
    moves.push([id, index]);
  };
  const entry = structuredClone(h.state.corral[0]);
  expect(await h.controller.restore(entry.id, false)).toBe(true);
  expect(moves).toEqual([["a", 3]]);
  h.state.corral.push(entry);
  expect(await h.controller.restore(entry.id, false)).toBe(true);
  expect(moves).toHaveLength(1);
});
