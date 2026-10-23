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
  refreshTimeoutSeconds: z.number().int().min(1).max(120),
  refreshConcurrency: z.number().int().min(1).max(8),
  storageTimeoutSeconds: z.number().int().min(1).max(120),
  verificationMaxAgeSeconds: z.number().int().min(1).max(120),
  previewRefreshSeconds: z.number().int().min(30).max(3600),
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
  refreshTimeoutSeconds: 15,
  refreshConcurrency: 3,
  storageTimeoutSeconds: 10,
  verificationMaxAgeSeconds: 5,
  previewRefreshSeconds: 300,
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
  optionsSchema.parse(preferences);
  optionsSchema.parse(options);
  const config = configSchema.parse(
    merge(merge(defaults, preferences), options),
  );
  if (config.softMaxTabs !== null && config.softMaxTabs < config.minTabs)
    throw new SettingsError("softMaxTabs must be at least minTabs");
  if (config.cleanup === "over-limit" && config.softMaxTabs === null)
    throw new SettingsError(
      "Choose softMaxTabs before enabling over-limit cleanup",
    );
  return freeze(config);
}
function freeze<T extends object>(value: T): T {
  for (const item of Object.values(value))
    if (typeof item === "object" && item !== null) freeze(item);
  return Object.freeze(value);
}
export class SettingsError extends Error {}
export function fileControls(options: Options, path: string): boolean {
  let current: unknown = options;
  for (const key of path.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

interface CompiledGlob {
  stars: bigint;
  questions: bigint;
  literals: Map<string, bigint>;
  end: bigint;
}
const globCache = new Map<string, CompiledGlob>();
const globResults = new Map<string, boolean>();
// Bit-parallel wildcard NFA: bounded masks, no backtracking or pattern/input matrix allocation.
export function glob(
  pattern: string,
  value: string,
  sensitive = false,
): boolean {
  if (!sensitive) {
    pattern = pattern.toLowerCase();
    value = value.toLowerCase();
  }
  pattern = pattern.replace(/\*+/g, "*");
  if (!/[?*]/.test(pattern)) return pattern === value;
  if (pattern === "*") return true;
  const resultKey = `${pattern.length}:${pattern}${value}`;
  const remembered = globResults.get(resultKey);
  if (remembered !== undefined) return remembered;
  const remember = (result: boolean) => {
    if (globResults.size >= 512)
      globResults.delete(globResults.keys().next().value!);
    globResults.set(resultKey, result);
    return result;
  };
  let compiled = globCache.get(pattern);
  if (!compiled) {
    compiled = { stars: 0n, questions: 0n, literals: new Map(), end: 1n };
    for (const char of pattern) {
      const bit = compiled.end;
      if (char === "*") compiled.stars |= bit;
      else if (char === "?") compiled.questions |= bit;
      else
        compiled.literals.set(char, (compiled.literals.get(char) ?? 0n) | bit);
      compiled.end <<= 1n;
    }
    if (globCache.size >= 512) globCache.delete(globCache.keys().next().value!);
    globCache.set(pattern, compiled);
  }
  const closure = (bits: bigint) => bits | ((bits & compiled.stars) << 1n);
  let current = closure(1n);
  for (const char of value) {
    current = closure(
      (current & compiled.stars) |
        ((current &
          (compiled.questions | (compiled.literals.get(char) ?? 0n))) <<
          1n),
    );
    if (current === 0n) return remember(false);
  }
  return remember((current & compiled.end) !== 0n);
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
const policyCache = new WeakMap<
  Config,
  Map<string, { policy: Policy; rules: string[] }>
>();
export function policyFor(
  config: Config,
  tab: Identity,
): { policy: Policy; rules: string[] } {
  let cache = policyCache.get(config);
  if (!cache) {
    cache = new Map();
    policyCache.set(config, cache);
  }
  const key = JSON.stringify([tab.id, tab.title, tab.directory, tab.project]);
  const cached = cache.get(key);
  if (cached) return cached;
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
  const value = freeze({ policy: policy.parse(result), rules });
  // Bounded per immutable configuration snapshot; old snapshots are weakly held.
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
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
