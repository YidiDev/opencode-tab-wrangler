import { inSchedule, policyFor, validIdentity, type Config } from "./config";
import type { Decision, Lock, Observation, Tab } from "./model";

export function protectionReasons(
  tab: Tab,
  config: Config,
  lock: Lock | undefined,
  now: number,
): string[] {
  const { policy } = policyFor(config, tab),
    p = policy.protections;
  const reasons: string[] = [];
  if (!tab.known || !validIdentity(tab)) reasons.push("unknown-state");
  if (tab.active) reasons.push("selected");
  if (tab.running) reasons.push("running");
  if (tab.busy && !tab.running && !tab.pending) reasons.push("unknown-busy");
  if (lock && (lock.until === null || lock.until > now)) reasons.push("locked");
  if (policy.excluded) reasons.push("excluded");
  if (p.unreadActivity && tab.unread === "activity")
    reasons.push("unread-activity");
  if (p.unreadErrors && tab.unread === "error") reasons.push("unread-error");
  if (p.questions && tab.questions) reasons.push("question-waiting");
  if (p.permissions && tab.permissions) reasons.push("permission-waiting");
  if (p.pending && tab.pending) reasons.push("queued-work");
  if (p.attention && tab.attention) reasons.push("attention");
  return reasons;
}
export function observe(
  tab: Tab,
  config: Config,
  old: Observation | undefined,
  lock: Lock | undefined,
  now: number,
): Observation {
  const { policy } = policyFor(config, tab);
  const guarded = protectionReasons(tab, config, lock, now).length > 0;
  const value: Observation = old
    ? { ...old }
    : {
        opened: now,
        touched: now,
        grace: now,
        updated: tab.updated,
        protected: guarded,
      };
  if (
    old &&
    ((policy.activity.selection && tab.active) ||
      (policy.activity.sessionUpdates && tab.updated > old.updated))
  )
    value.touched = now;
  if (old?.protected && !guarded) {
    value.grace = now;
    value.touched = now;
  }
  value.updated = tab.updated;
  value.protected = guarded;
  return value;
}
export function evaluate(
  tab: Tab,
  config: Config,
  observation: Observation | undefined,
  lock: Lock | undefined,
  now: number,
): Decision {
  const { policy, rules } = policyFor(config, tab);
  const reasons = protectionReasons(tab, config, lock, now);
  if (config.mode === "off") reasons.push("disabled");
  if (!inSchedule(config, now)) reasons.push("outside-schedule");
  if (!observation) reasons.push("unobserved");
  const dueAt = observation
    ? Math.max(
        observation.touched + policy.idleMinutes * 60000,
        observation.grace + policy.graceMinutes * 60000,
      )
    : Infinity;
  if (now < dueAt) reasons.push("idle-grace");
  return {
    tab,
    reasons,
    rules,
    eligible: reasons.length === 0,
    idleMs: observation ? Math.max(0, now - observation.touched) : 0,
    openedAt: observation?.opened ?? now,
    dueAt,
  };
}
export function candidates(decisions: Decision[], config: Config): Decision[] {
  const count = decisions.length;
  let budget = Math.max(0, count - config.minTabs);
  if (config.cleanup === "over-limit")
    budget = Math.min(
      budget,
      Math.max(0, count - (config.softMaxTabs ?? count)),
    );
  const sorted = decisions
    .filter((d) => d.eligible)
    .sort((a, b) => {
      switch (config.order) {
        case "left-to-right":
          return a.tab.index - b.tab.index;
        case "right-to-left":
          return b.tab.index - a.tab.index;
        case "oldest-opened":
          return a.openedAt - b.openedAt || a.tab.index - b.tab.index;
        default:
          return b.idleMs - a.idleMs || a.tab.index - b.tab.index;
      }
    });
  return sorted.slice(0, Math.min(budget, config.batchSize));
}
