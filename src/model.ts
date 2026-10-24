import type { Identity } from "./config";

export interface Tab extends Identity {
  active: boolean;
  busy: boolean;
  attention: boolean;
  unread?: "activity" | "error";
  running: boolean;
  questions: boolean;
  permissions: boolean;
  pending: boolean;
  known: boolean;
  updated: number;
  index: number;
}
export interface Observation {
  opened: number;
  touched: number;
  grace: number;
  updated: number;
  protected: boolean;
}
export interface Decision {
  tab: Tab;
  reasons: string[];
  rules: string[];
  eligible: boolean;
  idleMs: number;
  openedAt: number;
  dueAt: number;
}
export interface Lock {
  until: number | null;
}
export interface Entry {
  id: string;
  scope: string;
  sessionID: string;
  title?: string;
  directory: string;
  project: string;
  index: number;
  time: number;
  state: "intent" | "closed" | "uncertain";
  reason: string;
}
export interface Persisted {
  version: 1;
  preferences: Record<string, unknown>;
  locks: Record<string, Lock>;
  corral: Entry[];
}
export interface Runtime {
  pauseUntil: number | null;
  observations: Record<string, Observation>;
}
export const keyFor = (scope: string, id: string) =>
  JSON.stringify([scope, id]);
