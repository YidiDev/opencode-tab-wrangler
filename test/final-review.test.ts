import { expect, test } from "bun:test";
import { harness, tab } from "./support";
import { createUI } from "../src/ui";
import { glob, policyFor, resolveConfig } from "../src/config";
import type { Plugin } from "@opencode/plugin/tui";

test("activity and metadata changes in another tab cannot starve eligible cleanup", async () => {
  const h = harness({}, [
    tab("idle"),
    tab("busy", { index: 1, running: true }),
  ]);
  h.age(61000);
  h.onWrite(() => {
    h.controller.touch("busy");
    h.patch("busy", { updated: h.now() });
    h.controller.observe(true);
  });
  expect(await h.controller.run()).toBe(1);
  expect(h.closed).toEqual(["idle"]);
});
test("candidate activity during post-intent verification prevents closure even with zero timers", async () => {
  const h = harness({ idleMinutes: 0, graceMinutes: 0 });
  let calls = 0;
  h.onRefresh(() => {
    if (++calls === 3) h.controller.touch("one");
  });
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("server state is reverified after a slow intent write", async () => {
  const h = harness();
  h.age(61000);
  let persisted = false,
    afterWriteReads = 0;
  h.onWrite(() => {
    persisted = true;
    h.advance(600000);
  });
  h.onRefresh(() => {
    if (persisted) {
      afterWriteReads++;
      h.patch("one", { running: true });
    }
  });
  expect(await h.controller.run()).toBe(0);
  expect(afterWriteReads).toBe(1);
  expect(h.closed).toEqual([]);
});
test("post-intent verification that exceeds the freshness window cannot close", async () => {
  const h = harness();
  h.age(61000);
  let calls = 0;
  h.onRefresh(() => {
    if (++calls === 3) h.advance(6000);
  });
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("clock rollback during post-intent verification cannot close", async () => {
  const h = harness({ idleMinutes: 0, graceMinutes: 0 });
  let calls = 0;
  h.onRefresh(() => {
    if (++calls === 3) h.advance(-1000);
  });
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("monotonic verification age protects even if wall time does not advance", async () => {
  const h = harness();
  h.age(61000);
  let mono = 0,
    calls = 0;
  h.controller.dep.monotonic = () => mono;
  h.onRefresh(() => {
    if (++calls === 3) mono += 6000;
  });
  expect(await h.controller.run()).toBe(0);
  expect(h.closed).toEqual([]);
});
test("a stalled write disables cleanup and a late callback cannot mutate recovery state", async () => {
  const h = harness({ storageTimeoutSeconds: 1 });
  h.age(61000);
  let callback: ((draft: typeof h.state) => void) | undefined;
  h.controller.dep.update = (fn) => {
    callback = fn;
    return new Promise(() => {});
  };
  expect(await h.controller.run()).toBe(0);
  expect(h.controller.status()).toContain("uncertain");
  callback!(h.state);
  expect(h.state.corral).toEqual([]);
  expect(h.closed).toEqual([]);
  expect(await h.controller.run()).toBe(0);
});
test("a late persisted intent never admits a close after a write timeout", async () => {
  const h = harness({ storageTimeoutSeconds: 1 });
  h.age(61000);
  let finish: (() => void) | undefined;
  h.controller.dep.update = async (fn) => {
    const draft = structuredClone(h.state);
    fn(draft);
    await new Promise<void>((resolve) => {
      finish = () => {
        Object.assign(h.state, draft);
        resolve();
      };
    });
  };
  expect(await h.controller.run()).toBe(0);
  finish!();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.state.corral[0].state).toBe("intent");
  expect(h.closed).toEqual([]);
  expect(await h.controller.run()).toBe(0);
  expect(await h.controller.restore(h.state.corral[0].id)).toBe(true);
  expect(h.state.corral).toHaveLength(1);
  expect(h.controller.status()).toContain("uncertain");
});
test("restore-all undoes left-to-right and right-to-left removals in inverse order", async () => {
  for (const order of ["left-to-right", "right-to-left"]) {
    const ids = ["a", "b", "c", "keep"];
    const h = harness(
      { batchSize: 3, order },
      ids.map((id, index) => tab(id, { index, active: id === "keep" })),
    );
    h.host.list = () => h.tabs().map((t, index) => ({ ...t, index }));
    h.host.move = (id, index) => {
      const tabs = h.tabs();
      const [item] = tabs.splice(
        tabs.findIndex((t) => t.id === id),
        1,
      );
      tabs.splice(Math.min(index, tabs.length), 0, item);
    };
    h.age(61000);
    await h.controller.run();
    let done: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const restore = h.controller.restore.bind(h.controller);
    let restored = 0;
    h.controller.restore = async (...args) => {
      const result = await restore(...args);
      if (++restored === 3) done!();
      return result;
    };
    const context = {
      ui: {
        dialog: {
          select: async ({ actions }: any) => {
            actions[0].onTrigger();
            return undefined;
          },
          confirm: async () => true,
          alert: async () => {},
        },
      },
    } as unknown as Plugin.Context;
    await createUI(context, h.controller).corral();
    await completed;
    expect(h.tabs().map((t) => t.id)).toEqual(ids);
  }
});
test("maximum redundant wildcard patterns are cheap across many tabs", () => {
  const config = resolveConfig(
    {},
    {
      rules: Array.from({ length: 200 }, (_, i) => ({
        name: `r${i}`,
        match: { title: "*".repeat(512) },
        set: {},
      })),
    },
  );
  const start = performance.now();
  for (let i = 0; i < 50; i++)
    expect(
      policyFor(config, tab(String(i), { title: "x".repeat(4096) })).rules,
    ).toHaveLength(200);
  expect(performance.now() - start).toBeLessThan(1000);
});
test("wildcard cache and frozen policy cache stay bounded under churn", () => {
  const config = resolveConfig(
    {},
    { rules: [{ name: "all", match: { title: "*" }, set: {} }] },
  );
  for (let i = 0; i < 600; i++) {
    expect(glob(`*${i}`, String(i))).toBe(true);
    policyFor(config, tab(String(i)));
  }
  expect(policyFor(config, tab("0")).rules).toEqual(["all"]);
  expect(Object.isFrozen(config)).toBe(true);
  expect(Object.isFrozen(policyFor(config, tab()).policy)).toBe(true);
});
