import { Controller } from "../src/controller";
import { initialState } from "../src/state";
import type { Tab, Runtime } from "../src/model";
import type { Options } from "../src/config";
import type { Host } from "../src/host";

export const tab = (id = "one", patch: Partial<Tab> = {}): Tab => ({
  id,
  title: `Session ${id}`,
  directory: "/projects/test",
  project: "project",
  index: 0,
  active: false,
  busy: false,
  attention: false,
  running: false,
  questions: false,
  permissions: false,
  pending: false,
  known: true,
  updated: 1,
  ...patch,
});
export function harness(options: Options = {}, tabs = [tab()]) {
  let time = 1_000_000;
  const state = initialState(),
    runtime: Runtime = { pauseUntil: 0, observations: {} };
  let current = tabs;
  let persistFailure = false,
    refreshFailure = false,
    closeFailure = false,
    delayedClose = false,
    missing = false;
  let onWrite: (() => void) | undefined, onRefresh: (() => void) | undefined;
  const closed: string[] = [],
    opened: string[] = [],
    notices: string[] = [];
  const host: Host = {
    enabled: () => true,
    list: () => current,
    refresh: async () => {
      onRefresh?.();
      if (refreshFailure) {
        current = current.map((t) => ({ ...t, known: false }));
        throw new Error("offline");
      }
    },
    close(id) {
      closed.push(id);
      if (closeFailure) return false;
      if (!delayedClose) current = current.filter((t) => t.id !== id);
      return true;
    },
    open(id, focus) {
      opened.push(id);
      if (!current.some((t) => t.id === id))
        current.push(tab(id, { active: focus }));
      return true;
    },
    exists: async () => !missing,
    move: () => {},
  };
  const controller = new Controller({
    host,
    options: {
      connectionKey: "test",
      acknowledgeSharedTabs: true,
      minTabs: 0,
      idleMinutes: 1,
      graceMinutes: 1,
      batchDelaySeconds: 0,
      ...options,
    },
    state,
    runtime,
    update: async (fn) => {
      if (persistFailure) throw new Error("disk full");
      const draft = structuredClone(state);
      fn(draft);
      Object.assign(state, draft);
      onWrite?.();
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    notify: (m) => notices.push(m),
    changed: () => {},
  });
  controller.observe();
  return {
    controller,
    state,
    runtime,
    host,
    closed,
    opened,
    notices,
    advance(ms: number) {
      time += ms;
    },
    now: () => time,
    setTabs(value: Tab[]) {
      current = value;
    },
    tabs: () => current,
    patch(id: string, value: Partial<Tab>) {
      current = current.map((t) => (t.id === id ? { ...t, ...value } : t));
    },
    failPersist() {
      persistFailure = true;
    },
    failRefresh() {
      refreshFailure = true;
    },
    failClose() {
      closeFailure = true;
    },
    delayClose() {
      delayedClose = true;
    },
    missing() {
      missing = true;
    },
    onWrite(fn: () => void) {
      onWrite = fn;
    },
    onRefresh(fn: () => void) {
      onRefresh = fn;
    },
  };
}
