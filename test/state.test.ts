import { expect, test } from "bun:test";
import { initialState, prune, validateState } from "../src/state";
import { resolveConfig } from "../src/config";
import type { Entry } from "../src/model";

const entry = (patch: Partial<Entry> = {}): Entry => ({
  id: "e",
  scope: "s",
  sessionID: "id",
  title: "Private title",
  directory: "/project",
  project: "p",
  index: 0,
  time: 100000000,
  state: "closed",
  reason: "idle",
  ...patch,
});
test("state has explicit version and rejects unknown/corrupt formats", () => {
  expect(validateState(initialState())).toEqual(initialState());
  expect(() => validateState({ ...initialState(), version: 2 })).toThrow();
  expect(() =>
    validateState({
      ...initialState(),
      corral: [{ ...entry(), state: "done" }],
    }),
  ).toThrow();
});
test("history age, cap, ordering, and title opt-out", () => {
  const config = resolveConfig(
    {},
    { history: { days: 1, maxEntries: 2, rememberTitles: false } },
  );
  const result = prune(
    [
      entry({ time: 1 }),
      entry({ id: "a", time: 99999999 }),
      entry({ id: "b" }),
      entry({ id: "c", time: 99999998 }),
    ],
    config,
    100000000,
  );
  expect(result.map((e) => e.id)).toEqual(["b", "a"]);
  expect(result[0].title).toBeUndefined();
});
