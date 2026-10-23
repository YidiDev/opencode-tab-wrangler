import { expect, test } from "bun:test";
import { harness } from "./support";
import { rulesUI } from "../src/rules-ui";
import { createUI } from "../src/ui";
import type { Plugin } from "@opencode/plugin/tui";

const original = {
  name: "Existing",
  enabled: true,
  match: {},
  set: { idleMinutes: 5 },
  stop: false,
};
const added = {
  name: "Concurrent keep",
  enabled: true,
  match: { title: "*important*" },
  set: { excluded: true },
  stop: true,
};
test.each(["toggle", "delete", "$add"])(
  "stale %s operation never erases concurrent rules",
  async (action) => {
    const h = harness();
    await h.controller.preferences({ rules: [original] });
    let select = 0,
      prompt = 0;
    const context = {
      ui: {
        dialog: {
          select: async () => {
            if (++select === 1) {
              await h.controller.patchPreferences({ rules: [original, added] });
              return action === "$add" ? "$add" : "0";
            }
            return action === "$add"
              ? select === 2
                ? "title"
                : "keep"
              : action;
          },
          prompt: async () => (++prompt === 1 ? "New rule" : "*"),
          confirm: async () => true,
        },
      },
    } as unknown as Plugin.Context;
    await expect(rulesUI(context, h.controller)).rejects.toThrow(
      "changed while editing",
    );
    expect(h.controller.config().rules.map((r) => r.name)).toEqual([
      "Existing",
      "Concurrent keep",
    ]);
    await h.controller.patchPreferences({ batchSize: 1 });
    expect(h.controller.status()).not.toContain("uncertain");
  },
);
test("rule comparison uses the latest transaction draft, not just the UI cache", async () => {
  const h = harness();
  await h.controller.preferences({ rules: [original] });
  const rules = h.controller.config().rules,
    update = h.controller.dep.update;
  h.controller.dep.update = async (mutation) => {
    h.state.preferences.rules = [original, added];
    await update(mutation);
  };
  await expect(
    h.controller.patchPreferences({ rules: [] }, { scope: "test", rules }),
  ).rejects.toThrow("changed while editing");
  expect(h.state.preferences.rules).toEqual([original, added]);
});
test("rule edits are rejected across connection namespaces", async () => {
  const h = harness();
  const rules = h.controller.config().rules;
  await expect(
    h.controller.patchPreferences(
      { rules: [added] },
      { scope: "elsewhere", rules },
    ),
  ).rejects.toThrow("connection changed");
  expect(h.controller.config().rules).toEqual([]);
});
function entries(h: ReturnType<typeof harness>) {
  for (const scope of ["a", "b"])
    h.state.corral.push({
      id: scope,
      scope,
      sessionID: `session-${scope}`,
      directory: `/${scope}`,
      project: "p",
      index: 0,
      time: h.now(),
      state: "uncertain",
      reason: "fixture",
    });
}
test("Corral confirmation cannot clear a namespace different from the displayed one", async () => {
  const h = harness();
  delete h.controller.dep.options.connectionKey;
  await h.controller.preferences({ connectionKey: "a" });
  entries(h);
  let finish: (message: string) => void = () => {};
  const finished = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const context = {
    ui: {
      dialog: {
        select: async ({ actions }: any) => {
          actions[1].onTrigger();
          return undefined;
        },
        confirm: async () => {
          await h.controller.patchPreferences({ connectionKey: "b" });
          return true;
        },
        alert: async ({ message }: { message: string }) => finish(message),
      },
    },
  } as unknown as Plugin.Context;
  await createUI(context, h.controller).corral();
  expect(await finished).toContain("Connection changed");
  expect(h.state.corral.map((e) => e.scope)).toEqual(["a", "b"]);
});
test("clear-history namespace is rechecked inside the write transaction", async () => {
  const h = harness();
  delete h.controller.dep.options.connectionKey;
  await h.controller.preferences({ connectionKey: "a" });
  entries(h);
  const update = h.controller.dep.update;
  h.controller.dep.update = async (mutation) => {
    h.state.preferences.connectionKey = "b";
    await update(mutation);
  };
  await expect(h.controller.clearHistory("a")).rejects.toThrow(
    "Connection changed",
  );
  expect(h.state.corral.map((e) => e.scope)).toEqual(["a", "b"]);
});
test("forget-entry namespace is checked in the transaction and does not erase uncertain records", async () => {
  const h = harness();
  delete h.controller.dep.options.connectionKey;
  await h.controller.preferences({ connectionKey: "a" });
  entries(h);
  const update = h.controller.dep.update;
  h.controller.dep.update = async (mutation) => {
    h.state.preferences.connectionKey = "b";
    await update(mutation);
  };
  await expect(h.controller.forgetEntry("a", "a")).rejects.toThrow(
    "Connection changed",
  );
  expect(h.state.corral).toHaveLength(2);
});
test("a restore cannot expand to a namespace other than the opening dialog", async () => {
  const h = harness();
  entries(h);
  expect(await h.controller.restore("a", false, "a")).toBe(false);
  expect(h.opened).toEqual([]);
});
test("one-click exclusions do not overwrite a rule committed after the tab dialog", async () => {
  const h = harness();
  let select = 0;
  const alerts: string[] = [];
  const update = h.controller.dep.update;
  h.controller.dep.update = async (mutation) => {
    h.state.preferences.rules = [added];
    await update(mutation);
  };
  const context = {
    options: {},
    ui: {
      dialog: {
        select: async () => (++select === 1 ? "one" : "project"),
        alert: async ({ message }: { message: string }) => {
          alerts.push(message);
        },
      },
    },
  } as unknown as Plugin.Context;
  await createUI(context, h.controller).tabs();
  expect(alerts[0]).toContain("changed while editing");
  expect(h.controller.config().rules.map((r) => r.name)).toEqual([
    "Concurrent keep",
  ]);
});
test.each(["remove", "disable"])(
  "a stale rule dialog cannot undo a concurrent %s",
  async (change) => {
    const h = harness();
    await h.controller.preferences({ rules: [original] });
    let select = 0;
    const rules = change === "remove" ? [] : [{ ...original, enabled: false }];
    const context = {
      ui: {
        dialog: {
          select: async () => {
            if (++select === 1) {
              await h.controller.patchPreferences({ rules });
              return "0";
            }
            return "toggle";
          },
        },
      },
    } as unknown as Plugin.Context;
    await expect(rulesUI(context, h.controller)).rejects.toThrow(
      "changed while editing",
    );
    expect(h.controller.config().rules).toEqual(rules);
  },
);
test("forgetting a confirmed entry preserves other namespaces", async () => {
  const h = harness();
  delete h.controller.dep.options.connectionKey;
  await h.controller.preferences({ connectionKey: "a" });
  entries(h);
  await h.controller.forgetEntry("a", "a");
  expect(h.state.corral.map((e) => e.scope)).toEqual(["b"]);
});
