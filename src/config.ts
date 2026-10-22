import { z } from "zod";

const minutes = z.number().finite().min(0).max(525600);
const protections = z.strictObject({
  unreadActivity: z.boolean(),
  unreadErrors: z.boolean(),
  questions: z.boolean(),
  permissions: z.boolean(),
  pending: z.boolean(),
  attention: z.boolean(),
});
const activity = z.strictObject({
  selection: z.boolean(),
  sessionUpdates: z.boolean(),
  backgroundEvents: z.boolean(),
});
const match = z.strictObject({
  directory: z.string().min(1).max(512).optional(),
  title: z.string().min(1).max(512).optional(),
  project: z.string().min(1).max(512).optional(),
  session: z.string().min(1).max(512).optional(),
  caseSensitive: z.boolean().optional(),
});
const policy = z.strictObject({
  idleMinutes: minutes,
  graceMinutes: minutes,
  excluded: z.boolean(),
  protections,
  activity,
});
export const ruleSchema = z.strictObject({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  match,
  set: policy.partial().extend({
    protections: protections.partial().optional(),
    activity: activity.partial().optional(),
  }),
  stop: z.boolean().default(false),
});
export const configSchema = z.strictObject({
  mode: z.enum(["preview", "auto", "off"]),
  connectionKey: z.string().min(1).max(120),
  acknowledgeSharedTabs: z.boolean(),
  idleMinutes: minutes,
  graceMinutes: minutes,
  excluded: z.boolean(),
  protections,
  activity,
  checkSeconds: z.number().int().min(5).max(3600),
  minTabs: z.number().int().min(0).max(10000),
  softMaxTabs: z.number().int().min(1).max(10000).nullable(),
  cleanup: z.enum(["all-idle", "over-limit"]),
  order: z.enum([
    "oldest-idle",
    "oldest-opened",
    "left-to-right",
    "right-to-left",
  ]),
  batchSize: z.number().int().min(1).max(100),
  batchDelaySeconds: z.number().int().min(0).max(3600),
  notification: z.enum(["summary", "silent"]),
  history: z.strictObject({
    maxEntries: z.number().int().min(1).max(5000),
    days: z.number().int().min(1).max(3650),
    rememberTitles: z.boolean(),
  }),
  schedule: z.strictObject({
    days: z.array(z.number().int().min(0).max(6)).max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(24),
  }),
  rules: z.array(ruleSchema).max(200),
});
export type Config = z.infer<typeof configSchema>;
export const optionsSchema = configSchema.partial().extend({
  protections: configSchema.shape.protections.partial().optional(),
  activity: configSchema.shape.activity.partial().optional(),
  history: configSchema.shape.history.partial().optional(),
  schedule: configSchema.shape.schedule.partial().optional(),
});
export type Rule = z.infer<typeof ruleSchema>;
export type Policy = z.infer<typeof policy>;
export const defaults: Config = {
  mode: "preview",
  connectionKey: "unconfigured",
  acknowledgeSharedTabs: false,
  idleMinutes: 30,
  graceMinutes: 30,
  excluded: false,
  protections: {
    unreadActivity: true,
    unreadErrors: true,
    questions: true,
    permissions: true,
    pending: true,
    attention: true,
  },
  activity: { selection: true, sessionUpdates: true, backgroundEvents: true },
  checkSeconds: 30,
  minTabs: 5,
  softMaxTabs: null,
  cleanup: "all-idle",
  order: "oldest-idle",
  batchSize: 3,
  batchDelaySeconds: 2,
  notification: "summary",
  history: { maxEntries: 200, days: 30, rememberTitles: true },
  schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 },
  rules: [],
};

export type Options = Record<string, unknown>;
const isObject = (v: unknown): v is Options =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function merge(base: Options, override: Options): Options {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid configuration key");
    result[key] =
      isObject(value) && isObject(result[key])
        ? merge(result[key], value)
        : value;
  }
  return result;
}
export function resolveConfig(
  preferences: Options = {},
  options: Options = {},
): Config {
  const config = configSchema.parse(
    merge(merge(defaults, preferences), options),
  );
  if (config.softMaxTabs !== null && config.softMaxTabs < config.minTabs)
    throw new Error("softMaxTabs must be at least minTabs");
  if (config.cleanup === "over-limit" && config.softMaxTabs === null)
    throw new Error("over-limit requires softMaxTabs");
  return config;
}
export function fileControls(options: Options, path: string): boolean {
  let current: unknown = options;
  for (const key of path.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

// Linear-space wildcard matcher. Only * and ? have special meaning; no regex or code execution.
export function glob(
  pattern: string,
  value: string,
  sensitive = false,
): boolean {
  if (!sensitive) {
    pattern = pattern.toLowerCase();
    value = value.toLowerCase();
  }
  const chars = [...value];
  let previous = new Uint8Array(chars.length + 1);
  previous[0] = 1;
  for (const char of pattern) {
    const next = new Uint8Array(chars.length + 1);
    if (char === "*") next[0] = previous[0];
    for (let i = 1; i <= chars.length; i++)
      next[i] =
        char === "*"
          ? Number(Boolean(previous[i] || next[i - 1]))
          : Number(
              Boolean(
                previous[i - 1] && (char === "?" || char === chars[i - 1]),
              ),
            );
    previous = next;
  }
  return Boolean(previous[chars.length]);
}
export type Identity = {
  id: string;
  title: string;
  directory: string;
  project: string;
};
export function validIdentity(tab: Identity): boolean {
  return (
    tab.id.length <= 512 &&
    tab.project.length <= 512 &&
    tab.title.length <= 4096 &&
    tab.directory.length <= 4096
  );
}
export function matches(rule: Rule["match"], tab: Identity): boolean {
  if (!validIdentity(tab)) return false;
  const fields = {
    directory: tab.directory,
    title: tab.title,
    project: tab.project,
    session: tab.id,
  };
  return Object.entries(fields).every(([key, value]) => {
    const pattern = rule[key as keyof typeof fields];
    return pattern === undefined || glob(pattern, value, rule.caseSensitive);
  });
}
export function policyFor(
  config: Config,
  tab: Identity,
): { policy: Policy; rules: string[] } {
  let result: Options = {
    idleMinutes: config.idleMinutes,
    graceMinutes: config.graceMinutes,
    excluded: config.excluded,
    protections: config.protections,
    activity: config.activity,
  };
  const rules: string[] = [];
  for (const rule of config.rules) {
    if (!rule.enabled || !matches(rule.match, tab)) continue;
    result = merge(result, rule.set);
    rules.push(rule.name);
    if (rule.stop) break;
  }
  return { policy: policy.parse(result), rules };
}
export function inSchedule(config: Config, now: number): boolean {
  const date = new Date(now),
    { days, startHour, endHour } = config.schedule;
  const hour = date.getHours();
  if (startHour <= endHour)
    return days.includes(date.getDay()) && hour >= startHour && hour < endHour;
  return (
    (days.includes(date.getDay()) && hour >= startHour) ||
    (days.includes((date.getDay() + 6) % 7) && hour < endHour)
  );
}
