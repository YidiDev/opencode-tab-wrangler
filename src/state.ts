import { z } from "zod";
import type { Config } from "./config";
import type { Entry, Persisted, Runtime } from "./model";

const stateSchema = z.strictObject({
  version: z.literal(1),
  preferences: z.record(z.string(), z.unknown()),
  locks: z.record(
    z.string(),
    z.strictObject({ until: z.number().finite().nonnegative().nullable() }),
  ),
  corral: z.array(
    z.strictObject({
      id: z.string(),
      scope: z.string(),
      sessionID: z.string(),
      title: z.string().optional(),
      directory: z.string(),
      project: z.string(),
      index: z.number().int().nonnegative(),
      time: z.number().finite().nonnegative(),
      state: z.enum(["intent", "closed", "uncertain"]),
      reason: z.string(),
    }),
  ),
});
export const initialState = (): Persisted => ({
  version: 1,
  preferences: {},
  locks: {},
  corral: [],
});
export function validateState(state: unknown): Persisted {
  return stateSchema.parse(state);
}
export function validateRuntime(value: unknown): Runtime {
  return z
    .strictObject({
      pauseUntil: z.number().finite().nonnegative().nullable(),
      observations: z.record(
        z.string(),
        z.strictObject({
          opened: z.number().finite().nonnegative(),
          touched: z.number().finite().nonnegative(),
          grace: z.number().finite().nonnegative(),
          updated: z.number().finite().nonnegative(),
          protected: z.boolean(),
        }),
      ),
    })
    .parse(value);
}
export function prune(entries: Entry[], config: Config, now: number): Entry[] {
  const cutoff = now - config.history.days * 86400000;
  return entries
    .filter((e) => e.time >= cutoff)
    .sort((a, b) => b.time - a.time)
    .slice(0, config.history.maxEntries)
    .map((e) =>
      config.history.rememberTitles ? e : { ...e, title: undefined },
    );
}
