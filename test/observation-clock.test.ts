import { expect, test } from "bun:test";
import { ObservationClock } from "../src/observation-clock";
import { harness, tab } from "./support";

test("intentional waits permit intermediate observations but not oversleep", () => {
  let wall = 0,
    mono = 0;
  const clock = new ObservationClock(
    () => wall,
    () => mono,
  );
  expect(clock.check(60000)).toBeUndefined();
  const wait = clock.beginWait(120000);
  wall = mono = 90000;
  expect(clock.check(60000)).toBeUndefined();
  wall = mono = 120000;
  expect(clock.check(60000)).toBeUndefined();
  clock.endWait(wait);
  wall = mono = 180001;
  expect(clock.check(60000)).toBe("gap");
});
test("either clock detects suspension and rollback drops stale wait allowances", () => {
  let wall = 0,
    mono = 0;
  const clock = new ObservationClock(
    () => wall,
    () => mono,
  );
  clock.check(60000);
  const wait = clock.beginWait(2000);
  wall = 3602000;
  mono = 2000;
  expect(clock.check(60000)).toBe("gap");
  clock.endWait(wait);
  clock.beginWait(3600000);
  wall = 100;
  expect(clock.check(60000)).toBe("rollback");
  wall = 70100;
  expect(clock.check(60000)).toBe("gap");
  mono += 70000;
  expect(clock.check(60000)).toBe("gap");
});
test.each(["run", "refresh", "observe"] as const)(
  "%s detects a gap before scheduled tick",
  async (method) => {
    const h = harness({ idleMinutes: 30, graceMinutes: 30 });
    await h.controller.tick();
    h.advance(3600000);
    await h.controller[method]();
    expect(h.closed).toEqual([]);
    expect(h.controller.decisions()[0].reasons).toContain("idle-grace");
  },
);
test("suspension during a two-second batch delay protects remaining tabs", async () => {
  const h = harness({ mode: "auto", batchSize: 2, batchDelaySeconds: 2 }, [
    tab("a", { index: 0 }),
    tab("b", { index: 1 }),
    tab("c", { index: 2 }),
  ]);
  await h.controller.tick();
  h.advance(30000);
  await h.controller.tick();
  h.controller.dep.sleep = async (ms) => {
    h.advance(ms + 3600000);
  };
  h.advance(30000);
  await h.controller.tick();
  expect(h.closed).toEqual(["a"]);
  expect(
    h.controller.decisions().every((d) => d.reasons.includes("idle-grace")),
  ).toBe(true);
});
test("manual deliberate waits do not become a gap at the next scheduled tick", async () => {
  const h = harness({ mode: "auto", batchSize: 2, batchDelaySeconds: 120 }, [
    tab("a", { index: 0 }),
    tab("b", { index: 1 }),
    tab("c", { index: 2 }),
  ]);
  await h.controller.tick();
  h.age(61000);
  expect(await h.controller.run()).toBe(2);
  h.advance(30000);
  await h.controller.tick();
  expect(h.controller.decisions()[0].reasons).not.toContain("idle-grace");
});
test.each([
  "running",
  "questions",
  "permissions",
  "pending",
  "attention",
  "unread",
  "busy",
] as const)(
  "transient %s is retained during persistence with optional activity disabled",
  async (field) => {
    const h = harness({
      activity: { backgroundEvents: false, sessionUpdates: false },
    });
    h.age(61000);
    let changed = false;
    h.onWrite(() => {
      if (changed) return;
      changed = true;
      h.patch(
        "one",
        field === "unread" ? { unread: "activity" } : { [field]: true },
      );
      h.controller.observe(true);
      h.patch(
        "one",
        field === "unread" ? { unread: undefined } : { [field]: false },
      );
      h.controller.observe(true);
    });
    expect(await h.controller.run()).toBe(0);
    expect(changed).toBe(true);
    expect(h.controller.decisions()[0].reasons).toContain("idle-grace");
    h.age(61000);
    expect(await h.controller.run()).toBe(1);
  },
);
test("verification hydration alone never resets eligible-tab grace", async () => {
  const h = harness();
  h.age(61000);
  h.onRefresh(() => {
    h.patch("one", { known: false });
    h.controller.observe(true);
    h.patch("one", { known: true });
    h.controller.observe(true);
  });
  expect(await h.controller.run()).toBe(1);
});
test("a positive guard survives unverified negative observations", async () => {
  const h = harness({
    activity: { backgroundEvents: false, sessionUpdates: false },
  });
  h.age(61000);
  let changed = false;
  h.onWrite(() => {
    if (changed) return;
    changed = true;
    h.patch("one", { running: true });
    h.controller.observe(true);
    h.patch("one", { running: false, known: false });
    h.controller.observe(true);
  });
  h.onRefresh(() => {
    if (changed) h.patch("one", { known: true });
  });
  expect(await h.controller.run()).toBe(0);
  expect(h.controller.decisions()[0].reasons).toContain("idle-grace");
});
