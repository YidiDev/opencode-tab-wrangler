import { describe, expect, test } from "bun:test";
import {
  defaults,
  fileControls,
  glob,
  inSchedule,
  merge,
  policyFor,
  resolveConfig,
} from "../src/config";
import { tab } from "./support";

describe("configuration", () => {
  test("safe defaults and nested precedence", () => {
    const config = resolveConfig(
      { idleMinutes: 10, protections: { questions: false, pending: false } },
      { idleMinutes: 40, protections: { pending: true } },
    );
    expect(config.mode).toBe("preview");
    expect(config.idleMinutes).toBe(40);
    expect(config.protections.questions).toBe(false);
    expect(config.protections.pending).toBe(true);
    expect(config.protections.permissions).toBe(true);
  });
  test.each([
    { idleMinutes: -1 },
    { idleMinutes: Infinity },
    { checkSeconds: 0 },
    { batchSize: 0 },
    { minTabs: 4, softMaxTabs: 2 },
    { cleanup: "over-limit" },
    { mode: "force" },
    { unknown: true },
    { protections: { selected: false } },
    { history: { maxEntries: 0 } },
    { rules: [{ name: "x", match: { regex: "x" }, set: {} }] },
  ])("invalid input rejected: %j", (input) => {
    expect(() => resolveConfig({}, input)).toThrow();
  });
  test("prototype pollution rejected", () => {
    expect(() =>
      merge({}, JSON.parse('{"__proto__":{"polluted":true}}')),
    ).toThrow();
    expect(() => merge({}, { rules: [], constructor: {} })).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  test("file ownership is explicit including nested keys", () => {
    expect(
      fileControls({ protections: { pending: true } }, "protections.pending"),
    ).toBe(true);
    expect(
      fileControls({ protections: { pending: true } }, "protections.questions"),
    ).toBe(false);
  });
  test.each([
    ["*", "anything", true],
    ["a?c", "abc", true],
    ["a?c", "ac", false],
    ["*.ts", "foo.tsx", false],
    ["a.b", "axb", false],
    ["a[b]", "a[b]", true],
    ["*prod*", "Production", true],
    ["", "", true],
    ["*a*b*", "xyazb", true],
    ["a*", "b", false],
  ] as const)("glob %s / %s", (pattern, value, expected) => {
    expect(glob(pattern, value)).toBe(expected);
  });
  test("case-sensitive patterns", () => {
    expect(glob("Prod*", "prod-test", true)).toBe(false);
  });
  test("wildcards and literals handle Unicode code points", () => {
    expect(glob("?", "🙂")).toBe(true);
    expect(glob("*🙂", "Hello 🙂")).toBe(true);
    expect(glob("é?", "é好")).toBe(true);
  });
  test("rules combine match fields, merge nested protections, and stop", () => {
    const config = resolveConfig(
      {},
      {
        rules: [
          {
            name: "project",
            match: { project: "proj*", directory: "/projects/*" },
            set: { idleMinutes: 90, protections: { pending: false } },
          },
          {
            name: "specific",
            match: { title: "Session*" },
            set: { idleMinutes: 5 },
            stop: true,
          },
          { name: "ignored", match: {}, set: { excluded: true } },
        ],
      },
    );
    const result = policyFor(config, tab());
    expect(result.rules).toEqual(["project", "specific"]);
    expect(result.policy.idleMinutes).toBe(5);
    expect(result.policy.protections.pending).toBe(false);
    expect(result.policy.protections.questions).toBe(true);
    expect(result.policy.excluded).toBe(false);
  });
  test("disabled and nonmatching rules have no effect", () => {
    const config = resolveConfig(
      {},
      {
        rules: [
          {
            name: "disabled",
            enabled: false,
            match: {},
            set: { excluded: true },
          },
          {
            name: "other",
            match: { directory: "/different/*" },
            set: { excluded: true },
          },
        ],
      },
    );
    expect(policyFor(config, tab()).rules).toEqual([]);
  });
  test("overnight windows belong to starting weekday", () => {
    const c = resolveConfig(
      {},
      { schedule: { days: [1], startHour: 22, endHour: 6 } },
    );
    expect(inSchedule(c, new Date(2026, 9, 19, 23).getTime())).toBe(true);
    expect(inSchedule(c, new Date(2026, 9, 20, 3).getTime())).toBe(true);
    expect(inSchedule(c, new Date(2026, 9, 20, 23).getTime())).toBe(false);
    expect(inSchedule(c, new Date(2026, 9, 20, 6).getTime())).toBe(false);
  });
  test("empty days disables cleanup, full-day default permits it", () => {
    expect(inSchedule(defaults, Date.now())).toBe(true);
    expect(
      inSchedule(resolveConfig({}, { schedule: { days: [] } }), Date.now()),
    ).toBe(false);
  });
});
