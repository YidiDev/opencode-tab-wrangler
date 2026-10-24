import type { Plugin } from "@opencode/plugin/tui";
import { merge, ruleSchema, type Rule } from "./config";
import type { Controller } from "./controller";

export async function rulesUI(context: Plugin.Context, controller: Controller) {
  const dialog = context.ui.dialog;
  const rules = controller.config().rules;
  const selection = await dialog.select({
    title: "Ordered rules · later matches win",
    options: [
      {
        title: "Add rule (guided)",
        value: "$add",
        description:
          "Choose a project, directory, title, session, or catch-all pattern",
      },
      {
        title: "Edit entire array as JSON",
        value: "$json",
        description:
          "Advanced nested overrides, multi-field matches, and reordering",
      },
      ...rules.map((r, index) => ({
        title: `${index + 1}. ${r.name}${r.enabled ? "" : " [disabled]"}${r.stop ? " [stop]" : ""}`,
        value: String(index),
        description: `${JSON.stringify(r.match)} → ${JSON.stringify(r.set)}`,
      })),
    ],
  });
  if (selection === undefined) return;
  async function save(next: Rule[]) {
    if (
      next.some((r) =>
        Object.values(r.set.protections ?? {}).some((v) => v === false),
      ) &&
      !(await dialog.confirm({
        title: "Advanced protection overrides",
        message:
          "These rules disable one or more unread/waiting protections. Matching tabs may close while they need attention. Continue?",
      }))
    )
      return;
    await controller.preferences(
      merge(controller.dep.state.preferences, { rules: next }),
    );
  }
  if (selection === "$json") {
    const input = await dialog.prompt({
      title: "Rules array (JSON)",
      value: JSON.stringify(rules),
    });
    if (input === undefined) return;
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) throw new Error("Expected rules array");
    await save(parsed.map((r) => ruleSchema.parse(r)));
    return;
  }
  if (selection === "$add") {
    const name = await dialog.prompt({
      title: "Rule name",
      value: "Keep important tabs",
    });
    if (name === undefined) return;
    const field = await dialog.select({
      title: "Match by",
      options: [
        { title: "Session title", value: "title" },
        { title: "Directory", value: "directory" },
        { title: "Project ID", value: "project" },
        { title: "Session ID", value: "session" },
        { title: "All tabs", value: "$all" },
      ],
    });
    if (!field) return;
    const pattern =
      field === "$all"
        ? "*"
        : await dialog.prompt({
            title: `${field} pattern`,
            placeholder: "*important*",
            description:
              "* matches anything; ? matches one character. Case-insensitive by default.",
          });
    if (pattern === undefined) return;
    const behavior = await dialog.select({
      title: "Rule behavior",
      options: [
        { title: "Keep matching tabs open", value: "keep" },
        { title: "Custom idle/grace timeout", value: "timeout" },
        { title: "Advanced policy JSON", value: "json" },
      ],
    });
    if (!behavior) return;
    let set: Rule["set"] = { excluded: true };
    if (behavior === "timeout") {
      const duration = await dialog.prompt({
        title: "Idle and grace duration (minutes)",
        value: "120",
      });
      if (duration === undefined) return;
      set = { idleMinutes: Number(duration), graceMinutes: Number(duration) };
    }
    if (behavior === "json") {
      const input = await dialog.prompt({
        title: "Policy override (JSON object)",
        value: '{"idleMinutes":60,"protections":{"unreadActivity":true}}',
      });
      if (input === undefined) return;
      set = JSON.parse(input);
    }
    const stop = await dialog.confirm({
      title: "Stop after this rule matches?",
      message:
        "Yes: ignore later rules for matching tabs. No: allow later rules to override it.",
    });
    if (stop === undefined) return;
    const rule = ruleSchema.parse({
      name,
      match: field === "$all" ? {} : { [field]: pattern },
      set,
      stop,
    });
    await save([...rules, rule]);
    return;
  }
  const index = Number(selection),
    rule = rules[index];
  if (!rule) return;
  const action = await dialog.select({
    title: rule.name,
    options: [
      { title: "Edit rule JSON", value: "edit" },
      { title: rule.enabled ? "Disable" : "Enable", value: "toggle" },
      { title: "Move earlier", value: "up", disabled: index === 0 },
      {
        title: "Move later",
        value: "down",
        disabled: index === rules.length - 1,
      },
      { title: "Duplicate", value: "copy" },
      { title: "Delete rule", value: "delete" },
    ],
  });
  if (!action) return;
  const next = [...rules];
  if (action === "edit") {
    const input = await dialog.prompt({
      title: "Rule (JSON)",
      value: JSON.stringify(rule),
    });
    if (input === undefined) return;
    next[index] = ruleSchema.parse(JSON.parse(input));
  }
  if (action === "toggle") next[index] = { ...rule, enabled: !rule.enabled };
  if (action === "up" && index > 0)
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
  if (action === "down" && index < next.length - 1)
    [next[index + 1], next[index]] = [next[index], next[index + 1]];
  if (action === "copy")
    next.splice(index + 1, 0, { ...rule, name: `${rule.name} (copy)` });
  if (action === "delete") {
    if (!(await dialog.confirm({ title: "Delete rule?", message: rule.name })))
      return;
    next.splice(index, 1);
  }
  await save(next);
}
