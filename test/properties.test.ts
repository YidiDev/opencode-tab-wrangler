import { expect, test } from "bun:test";
import { glob, resolveConfig } from "../src/config";
import { evaluate, observe, candidates } from "../src/policy";
import { tab } from "./support";

test("seeded randomized selection preserves floors, batches, and hard protections", () => {
  let seed = 97;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let run = 0; run < 500; run++) {
    const count = Math.floor(rand() * 50),
      minTabs = Math.floor(rand() * 20),
      batchSize = 1 + Math.floor(rand() * 20);
    const config = resolveConfig(
      {},
      { idleMinutes: 0, graceMinutes: 0, minTabs, batchSize },
    );
    const decisions = Array.from({ length: count }, (_, i) => {
      const t = tab(String(i), {
        active: rand() < 0.2,
        running: rand() < 0.2,
        known: rand() > 0.2,
      });
      return evaluate(
        t,
        config,
        observe(t, config, undefined, undefined, 0),
        undefined,
        1000,
      );
    });
    const selected = candidates(decisions, config);
    expect(selected.length).toBeLessThanOrEqual(Math.max(0, count - minTabs));
    expect(selected.length).toBeLessThanOrEqual(batchSize);
    expect(
      selected.every((d) => !d.tab.active && !d.tab.running && d.tab.known),
    ).toBe(true);
  }
});
test("glob agrees with an independent Unicode regular-expression oracle", () => {
  const patterns = [
    "",
    "*",
    "?",
    "a*?",
    "*好*",
    "a.b",
    "[x]",
    "**?*",
    "?🙂",
    "a\\b",
  ];
  const values = [
    "",
    "a",
    "abc",
    "a.b",
    "[x]",
    "好",
    "a🙂",
    "a\\b",
    "🙂🙂",
    "\n",
  ];
  for (const pattern of patterns) {
    const escaped = [...pattern]
      .map((c) =>
        c === "*"
          ? "[\\s\\S]*"
          : c === "?"
            ? "[\\s\\S]"
            : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    const oracle = new RegExp(`^(?:${escaped})$`, "u");
    for (const value of values)
      expect(glob(pattern, value, true)).toBe(oracle.test(value));
  }
});
