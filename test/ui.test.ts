import { expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/tui";
import { createUI } from "../src/ui";
import { harness } from "./support";

function uiFixture(
  answers: (string | undefined)[],
  prompts: string[] = [],
  confirms: boolean[] = [],
) {
  const h = harness();
  const alerts: string[] = [],
    selections: any[] = [];
  const context = {
    options: {},
    ui: {
      tabs: { list: () => h.tabs(), focus: () => true },
      dialog: {
        select: async (input: any) => {
          selections.push(input);
          return answers.shift();
        },
        prompt: async () => prompts.shift(),
        confirm: async () => confirms.shift() ?? false,
        alert: async ({ message }: { message: string }) => {
          alerts.push(message);
        },
      },
    },
  } as unknown as Plugin.Context;
  return {
    ...h,
    alerts,
    selections,
    ui: createUI(context, h.controller),
    context,
  };
}
test("manager opens inspector with protection explanations", async () => {
  const h = uiFixture(["tabs", undefined]);
  await h.ui.manager();
  expect(h.selections[1].options[0].description).toContain("Idle/grace timer");
});
test("lock and temporary snooze actions persist", async () => {
  const h = uiFixture(["one", "lock"]);
  await h.ui.tabs();
  expect(h.state.locks[h.controller.lockKey("one")].until).toBeNull();
  const s = uiFixture(["one", "snooze"], ["20"]);
  await s.ui.tabs();
  expect(s.state.locks[s.controller.lockKey("one")].until).toBe(
    s.now() + 1200000,
  );
});
test("nested protections have actual toggles and a safety confirmation", async () => {
  const h = uiFixture(["protections", "questions", "false"], [], [true]);
  await h.ui.settings();
  expect(h.controller.config().protections.questions).toBe(false);
});
test("invalid setting is not saved", async () => {
  const h = uiFixture(["batchSize"], ["-1"]);
  await h.ui.settings();
  expect(h.state.preferences).toEqual({});
  expect(h.alerts).toHaveLength(1);
});
test("file controlled settings cannot be changed in dialog", async () => {
  const h = uiFixture(["batchSize"], ["10"]);
  (h.context.options as Record<string, unknown>).batchSize = 2;
  await h.ui.settings();
  expect(h.state.preferences).toEqual({});
  expect(h.alerts[0]).toContain("controlled");
});
test("cleanup requires confirmation and respects cancellation", async () => {
  const h = uiFixture([], [], [false]);
  h.advance(61000);
  await h.ui.cleanup();
  expect(h.closed).toEqual([]);
});
test("manual cleanup confirmation invokes safe runner", async () => {
  const h = uiFixture([], [], [true]);
  h.advance(61000);
  await h.ui.cleanup();
  expect(h.closed).toEqual(["one"]);
});
test("corral reopening works through UI", async () => {
  const h = uiFixture([]);
  h.advance(61000);
  await h.controller.run();
  const id = h.state.corral[0].id;
  const context = {
    ...h.context,
    ui: {
      ...h.context.ui,
      dialog: { ...h.context.ui.dialog, select: async () => id },
    },
  };
  let calls = 0;
  context.ui.dialog.select = async () =>
    (++calls === 1 ? id : "background") as any;
  await createUI(context as unknown as Plugin.Context, h.controller).corral();
  expect(h.opened).toEqual(["one"]);
});
test("pause/resume dialog changes runtime only", async () => {
  const h = uiFixture(["forever"]);
  await h.ui.pause();
  expect(h.controller.paused()).toBe(true);
  expect(h.state.preferences).toEqual({});
});
test("automatic mode is a dropdown with explicit confirmation", async () => {
  const h = uiFixture(["mode", "auto"], [], [true]);
  await h.ui.settings();
  expect(h.controller.config().mode).toBe("auto");
});
test("guided keep-open rule creation", async () => {
  const h = uiFixture(
    ["rules", "$add", "title", "keep"],
    ["Important tabs", "*important*"],
    [true],
  );
  await h.ui.settings();
  expect(h.controller.config().rules[0]).toMatchObject({
    name: "Important tabs",
    match: { title: "*important*" },
    set: { excluded: true },
    stop: true,
  });
});
test("rules can be toggled without editing JSON", async () => {
  const h = uiFixture(["rules", "0", "toggle"]);
  await h.controller.preferences({
    rules: [
      { name: "First", match: {}, set: {} },
      { name: "Second", match: {}, set: {} },
    ],
  });
  await h.ui.settings();
  expect(h.controller.config().rules[0].enabled).toBe(false);
});
test("cross-field and JSON settings errors explain how to correct the input", async () => {
  const h = uiFixture(["cleanup", "over-limit"]);
  await h.ui.settings();
  expect(h.alerts[0]).toContain("softMaxTabs");
  const j = uiFixture(["batchSize"], ["{"]);
  await j.ui.settings();
  expect(j.alerts[0]).toContain("Invalid JSON");
});
test("rule ordering controls really reorder", async () => {
  const h = uiFixture(["rules", "1", "up"]);
  await h.controller.preferences({
    rules: [
      { name: "First", match: {}, set: {} },
      { name: "Second", match: {}, set: {} },
    ],
  });
  await h.ui.settings();
  expect(h.controller.config().rules.map((r) => r.name)).toEqual([
    "Second",
    "First",
  ]);
});
test("one-click exclusion takes precedence over existing stopping rules", async () => {
  const h = uiFixture(["one", "directory"]);
  await h.controller.preferences({
    rules: [
      { name: "Earlier rule", match: {}, set: { excluded: false }, stop: true },
    ],
  });
  await h.ui.tabs();
  h.advance(61000);
  expect(h.controller.decisions()[0].reasons).toContain("excluded");
});
test("partial file-controlled object allows other child settings", async () => {
  const h = uiFixture(["protections", "questions", "false"], [], [true]);
  (h.context.options as Record<string, unknown>).protections = {
    permissions: true,
  };
  await h.ui.settings();
  expect(h.controller.config().protections.questions).toBe(false);
});
