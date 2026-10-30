import { expect, test } from "bun:test";
import { supportsHost } from "../src/tui";

test.each([
  "2.1.4",
  "v2.1.4",
  "2.1.4+build.1",
  "2.1.5",
  "2.2.0-rc.1",
  "2.2.2",
  "3.0.0",
  "10.0.0",
])("eligible host %s", (version) => {
  expect(supportsHost(version)).toBe(true);
});
test.each([
  undefined,
  null,
  2,
  "",
  "unknown",
  "2.1",
  "2.1.3",
  "1.99.99",
  "2.0.99",
  "2.1.4-rc.1",
  "02.1.4",
  "2.2.0-01",
  "2.2.0;close",
  "99999999999999999999.0.0",
])("ineligible host %s", (version) => {
  expect(supportsHost(version)).toBe(false);
});
