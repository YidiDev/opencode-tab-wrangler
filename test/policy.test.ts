import { expect, test } from "bun:test";
import {
  candidates,
  evaluate,
  observe,
  protectionReasons,
} from "../src/policy";
import { resolveConfig } from "../src/config";
import { tab } from "./support";
import type { Tab } from "../src/model";

const config = resolveConfig(
  {},
  { idleMinutes: 1, graceMinutes: 1, minTabs: 1, batchSize: 10 },
);
test.each([
  [{ active: true }, "selected"],
  [{ running: true }, "running"],
  [{ known: false }, "unknown-state"],
  [{ unread: "activity" }, "unread-activity"],
  [{ unread: "error" }, "unread-error"],
  [{ questions: true }, "question-waiting"],
  [{ permissions: true }, "permission-waiting"],
  [{ pending: true }, "queued-work"],
  [{ attention: true }, "attention"],
  [{ busy: true }, "unknown-busy"],
] as [Partial<Tab>, string][])("protection %j", (patch, reason) => {
  expect(protectionReasons(tab("a", patch), config, undefined, 1000)).toContain(
    reason,
  );
});
test("all applicable reasons are returned", () => {
  expect(
    protectionReasons(
      tab("a", { active: true, running: true, permissions: true }),
      config,
      { until: null },
      1000,
    ),
  ).toEqual(["selected", "running", "locked", "permission-waiting"]);
});
test("oversized peer metadata is protected without evaluating patterns", () => {
  expect(
    protectionReasons(
      tab("a", { title: "x".repeat(5000) }),
      config,
      undefined,
      0,
    ),
  ).toContain("unknown-state");
});
test("advanced opt-outs do not disable hard protections", () => {
  const c = resolveConfig(
    {},
    {
      protections: {
        questions: false,
        permissions: false,
        attention: false,
        pending: false,
        unreadActivity: false,
        unreadErrors: false,
      },
    },
  );
  expect(
    protectionReasons(
      tab("a", {
        active: true,
        running: true,
        known: false,
        questions: true,
        permissions: true,
        pending: true,
        unread: "activity",
        attention: true,
      }),
      c,
      undefined,
      0,
    ),
  ).toEqual(["unknown-state", "selected", "running"]);
});
test("locks expire and permanent locks do not", () => {
  expect(protectionReasons(tab(), config, { until: 2000 }, 1000)).toContain(
    "locked",
  );
  expect(protectionReasons(tab(), config, { until: 1000 }, 1000)).not.toContain(
    "locked",
  );
  expect(protectionReasons(tab(), config, { until: null }, 999999)).toContain(
    "locked",
  );
});
test("fresh observations and protection clearing grant grace", () => {
  const a = tab("a", { unread: "activity" });
  const old = observe(a, config, undefined, undefined, 1000);
  const next = observe(
    { ...a, unread: undefined },
    config,
    old,
    undefined,
    100000,
  );
  expect(next.grace).toBe(100000);
  expect(next.touched).toBe(100000);
  expect(
    evaluate({ ...a, unread: undefined }, config, next, undefined, 100001)
      .eligible,
  ).toBe(false);
  expect(
    evaluate({ ...a, unread: undefined }, config, next, undefined, 160000)
      .eligible,
  ).toBe(true);
});
test("selection and metadata activity are individually configurable", () => {
  const c = resolveConfig(
    {},
    { activity: { selection: false, sessionUpdates: false } },
  );
  const old = observe(tab(), c, undefined, undefined, 1000);
  const next = observe(
    tab("one", { active: true, updated: 10 }),
    c,
    old,
    undefined,
    4000,
  );
  expect(next.touched).toBe(1000);
});
test("count floor and batch limits", () => {
  const ds = Array.from({ length: 5 }, (_, i) => {
    const t = tab(String(i), { index: i });
    return evaluate(
      t,
      config,
      observe(t, config, undefined, undefined, 0),
      undefined,
      100000,
    );
  });
  expect(candidates(ds, { ...config, minTabs: 4 })).toHaveLength(1);
  expect(candidates(ds, { ...config, batchSize: 2 })).toHaveLength(2);
  expect(
    candidates(ds, { ...config, cleanup: "over-limit", softMaxTabs: 3 }),
  ).toHaveLength(2);
  expect(
    candidates(ds, { ...config, cleanup: "over-limit", softMaxTabs: 5 }),
  ).toHaveLength(0);
  expect(
    candidates(
      ds.map((d) => ({ ...d, eligible: false })),
      config,
    ),
  ).toHaveLength(0);
  expect(candidates(ds, { ...config, order: "right-to-left" })[0].tab.id).toBe(
    "4",
  );
});
test("oldest-opened sorting is independent of last activity", () => {
  const a = evaluate(
    tab("a"),
    config,
    { opened: 0, touched: 1000, grace: 0, updated: 1, protected: false },
    undefined,
    100000,
  );
  const b = evaluate(
    tab("b"),
    config,
    { opened: 500, touched: 0, grace: 0, updated: 1, protected: false },
    undefined,
    100000,
  );
  expect(
    candidates([a, b], { ...config, minTabs: 0, order: "oldest-opened" })[0].tab
      .id,
  ).toBe("a");
  expect(
    candidates([a, b], { ...config, minTabs: 0, order: "oldest-idle" })[0].tab
      .id,
  ).toBe("b");
});
