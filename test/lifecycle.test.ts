import { expect, test } from "bun:test";
import { setup, type Environment } from "../src/tui";
import type { Plugin } from "@opencode/plugin/tui";
import type { Persisted, Runtime } from "../src/model";
import { initialState } from "../src/state";
import { harness } from "./support";

function fixture(options: Record<string, unknown> = {}) {
  const h = harness();
  const state = initialState(),
    memory: Runtime = { pauseUntil: 0, observations: {} };
  const jobs = new Map<number, { run(): void; ms: number }>();
  let next = 0,
    writes = 0,
    checkpoints = 0,
    stopped = 0,
    effectStopped = 0;
  let effect: () => void = () => {},
    listener: (event: any) => void = () => {},
    commands: any[] = [];
  const messages: string[] = [];
  const env: Environment = {
    host: () => h.host,
    now: h.now,
    schedule(run, ms) {
      const id = ++next;
      jobs.set(id, { run, ms });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel(id) {
      jobs.delete(id as unknown as number);
    },
    effect(run) {
      effect = run;
      run();
      return () => {
        effectStopped++;
      };
    },
  };
  const context = {
    app: { version: "2.1.4" },
    options,
    storage: {
      store: () => [
        state,
        async (mutation: (draft: Persisted) => void) => {
          const draft = structuredClone(state);
          mutation(draft);
          Object.assign(state, draft);
          writes++;
        },
      ],
      memory: () => [
        memory,
        (mutation: (draft: Runtime) => void) => {
          mutation(memory);
          checkpoints++;
        },
      ],
    },
    keymap: {
      layer: (get: () => any) => {
        commands = get().commands;
      },
    },
    data: {
      listen: (cb: (event: any) => void) => {
        listener = cb;
        return () => {
          stopped++;
        };
      },
      session: { root: (id: string) => id },
    },
    ui: {
      toast: {
        show: ({ message }: { message: string }) => messages.push(message),
      },
      tabs: { enabled: () => true, list: h.tabs },
      router: { current: () => ({ type: "home" }) },
      dialog: { select: async () => undefined },
    },
  } as unknown as Plugin.Context;
  return {
    h,
    state,
    memory,
    env,
    context,
    jobs,
    messages,
    effect: () => effect(),
    event: (type: string, data: unknown) =>
      listener({ details: { type, data } }),
    commands: () => commands,
    stats: () => ({ writes, checkpoints, stopped, effectStopped }),
    async settle() {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

test("unsupported host registers no commands or timers", async () => {
  const f = fixture();
  (f.context.app as any).version = "2.1.5";
  expect(await setup(f.context, f.env)).toBeUndefined();
  expect(f.jobs.size).toBe(0);
  expect(f.commands()).toEqual([]);
  expect(f.messages[0]).toContain("supports OpenCode");
});
test("invalid settings and unavailable storage fail closed before wiring", async () => {
  const f = fixture({ idleMinutes: -1 });
  expect(await setup(f.context, f.env)).toBeUndefined();
  expect(f.commands()).toEqual([]);
  const s = fixture();
  s.context.storage.store = () => {
    throw new Error("disk failure");
  };
  expect(await setup(s.context, s.env)).toBeUndefined();
  expect(s.messages[0]).toContain("storage is unavailable");
});
test("recovery write failure disables setup and disposes the adapter", async () => {
  const f = fixture();
  let disposed = false;
  f.h.host.dispose = () => {
    disposed = true;
  };
  f.context.storage.store = (() => [
    f.state,
    async () => {
      throw new Error("disk full");
    },
  ]) as any;
  expect(await setup(f.context, f.env)).toBeUndefined();
  expect(disposed).toBe(true);
  expect(f.commands()).toEqual([]);
});
test("lifecycle wires commands, coalesces activity checkpoints, and cleans all resources", async () => {
  const f = fixture();
  const cleanup = await setup(f.context, f.env);
  await f.settle();
  expect(f.commands().map((c) => c.id)).toContain("wrangler.open");
  expect(f.commands()).toHaveLength(7);
  for (let i = 0; i < 100; i++)
    f.event("session.message.content.updated", { sessionID: "one" });
  f.event("other.event", {});
  f.event("session.inbox.enqueued", null);
  f.event("session.execution.started", { sessionID: 1 });
  f.effect();
  expect(f.stats().checkpoints).toBe(0);
  expect([...f.jobs.values()].filter((j) => j.ms === 250)).toHaveLength(1);
  const checkpoint = [...f.jobs.values()].find((j) => j.ms === 250)!;
  checkpoint.run();
  expect(f.stats().checkpoints).toBe(1);
  await f
    .commands()
    .find((c) => c.id === "wrangler.open")
    .run();
  await f
    .commands()
    .find((c) => c.id === "wrangler.restore")
    .run();
  cleanup!();
  expect(f.jobs.size).toBe(0);
  expect(f.stats()).toMatchObject({ stopped: 1, effectStopped: 1 });
});
test("corrupt shared settings cannot cause an unhandled scheduling rejection", async () => {
  const f = fixture();
  const cleanup = await setup(f.context, f.env);
  await f.settle();
  f.state.preferences = { idleMinutes: "bad" };
  f.effect();
  const job = [...f.jobs.values()].find((j) => j.ms === 30000)!;
  job.run();
  await f.settle();
  expect([...f.jobs.values()].some((j) => j.ms === 30000)).toBe(true);
  expect(f.h.closed).toEqual([]);
  cleanup!();
});
test("registration failure releases all resources and propagates to host scope cleanup", async () => {
  const f = fixture();
  let disposed = false;
  f.h.host.dispose = () => {
    disposed = true;
  };
  (f.context.data as any).listen = () => {
    throw new Error("registration failure");
  };
  await expect(setup(f.context, f.env)).rejects.toThrow("resources released");
  expect(disposed).toBe(true);
  expect(f.jobs.size).toBe(0);
});
test("invalid runtime memory disables setup without registering commands", async () => {
  const f = fixture();
  (f.memory as any).observations = { broken: {} };
  expect(await setup(f.context, f.env)).toBeUndefined();
  expect(f.commands()).toEqual([]);
});
