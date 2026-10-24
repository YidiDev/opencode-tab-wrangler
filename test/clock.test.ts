import { expect, test } from "bun:test";
import { createSleeper } from "../src/clock";

test("sleep resolves normally", async () => {
  const clock = createSleeper();
  await clock.sleep(1);
  clock.dispose();
});
test("unloading resolves pending long sleeps and disarms their timers", async () => {
  const clock = createSleeper(),
    start = Date.now();
  const sleeps = [clock.sleep(3600000), clock.sleep(3600000)];
  clock.dispose();
  await Promise.all(sleeps);
  await clock.sleep(3600000);
  expect(Date.now() - start).toBeLessThan(1000);
});
