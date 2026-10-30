import type { Plugin } from "@opencode/plugin/tui";
import { createEffect, createRoot } from "solid-js";
import { Controller } from "./controller";
import { createHost } from "./host";
import { initialState, validateRuntime } from "./state";
import type { Persisted, Runtime } from "./model";
import { createUI } from "./ui";
import { createSleeper } from "./clock";
import type { Host } from "./host";

export interface Environment {
  host(context: Plugin.Context): Host;
  effect(run: () => void): () => void;
  schedule(run: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
  now(): number;
}
const environment: Environment = {
  host: createHost,
  effect: (run) =>
    createRoot((dispose) => {
      createEffect(run);
      return dispose;
    }),
  schedule: setTimeout,
  cancel: clearTimeout,
  now: Date.now,
};

/** Forward-compatible eligibility, not a claim that every future release is tested. */
export function supportsHost(version: unknown): boolean {
  if (typeof version !== "string") return false;
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
      version,
    );
  if (!match) return false;
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  if (match[4]?.split(".").some((part) => /^0\d+$/.test(part))) return false;
  const [major, minor, patch] = parts;
  return (
    major > 2 ||
    (major === 2 &&
      (minor > 1 || (minor === 1 && (patch > 4 || (patch === 4 && !match[4])))))
  );
}

export async function setup(
  context: Plugin.Context,
  env: Environment = environment,
) {
  if (!supportsHost(context.app.version)) {
    context.ui.toast.show({
      message:
        "Tab Wrangler supports OpenCode 2.1.4 and newer; this host version is older or unrecognized, so cleanup is disabled.",
      variant: "warning",
    });
    return;
  }
  let state: Persisted,
    update: (mutation: (draft: Persisted) => void) => Promise<void>,
    memory: Runtime,
    runtime: Runtime,
    updateMemory: (mutation: (draft: Runtime) => void) => void;
  try {
    [state, update] = context.storage.store<Persisted>("state", {
      initial: initialState(),
    });
    [memory, updateMemory] = context.storage.memory<Runtime>("runtime", {
      initial: { pauseUntil: 0, observations: {} },
    });
    runtime = validateRuntime(memory);
  } catch {
    context.ui.toast.show({
      message:
        "Tab Wrangler: storage is unavailable or invalid; plugin disabled without closing tabs.",
      variant: "error",
    });
    return;
  }
  // Observations remain TUI-local; use a mutable working copy, checkpointed across plugin reloads.
  let controller: Controller;
  let host: Host | undefined;
  const sleeper = createSleeper();
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  const checkpoint = () => {
    if (checkpointTimer !== undefined) env.cancel(checkpointTimer);
    checkpointTimer = undefined;
    updateMemory((draft) => {
      draft.pauseUntil = runtime.pauseUntil;
      draft.observations = JSON.parse(JSON.stringify(runtime.observations));
    });
  };
  try {
    host = env.host(context);
    controller = new Controller({
      host,
      options: context.options,
      state,
      runtime,
      update,
      now: env.now,
      monotonic: performance.now,
      sleep: sleeper.sleep,
      notify: (message) => context.ui.toast.show({ message, variant: "info" }),
      changed: () => {
        if (checkpointTimer === undefined)
          checkpointTimer = env.schedule(() => {
            try {
              checkpoint();
            } catch {
              controller.health =
                "Local checkpoint unavailable; pause may not survive reload";
            }
          }, 250);
      },
    });
  } catch {
    host?.dispose?.();
    sleeper.dispose();
    context.ui.toast.show({
      message:
        "Tab Wrangler: invalid settings or stored state; disabled without closing tabs. Check cli.json against schema.json.",
      variant: "error",
    });
    return;
  }
  try {
    await controller.reconcile(true);
  } catch {
    controller.dispose();
    sleeper.dispose();
    context.ui.toast.show({
      message:
        "Tab Wrangler: could not persist recovery state; disabled without closing tabs.",
      variant: "error",
    });
    return;
  }
  let stopped = false,
    stop = () => {},
    disposeEffect = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    for (const release of [
      () => {
        if (timer !== undefined) env.cancel(timer);
      },
      () => stop(),
      () => disposeEffect(),
      () => controller.dispose(),
      () => sleeper.dispose(),
      checkpoint,
    ]) {
      try {
        release();
      } catch {
        /* Cleanup is best-effort per resource; continue releasing the rest. */
      }
    }
  };
  try {
    controller.resetGrace();
    const ui = createUI(context, controller);
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "wrangler.open",
          title: "Tab Wrangler",
          group: "Tab Wrangler",
          palette: true,
          slash: { name: "wrangler" },
          run: ui.manager,
        },
        {
          id: "wrangler.preview",
          title: "Wrangler: inspect tabs",
          group: "Tab Wrangler",
          palette: true,
          run: ui.tabs,
        },
        {
          id: "wrangler.cleanup",
          title: "Wrangler: clean eligible tabs",
          group: "Tab Wrangler",
          palette: true,
          run: ui.cleanup,
        },
        {
          id: "wrangler.corral",
          title: "Wrangler: open corral",
          group: "Tab Wrangler",
          palette: true,
          run: ui.corral,
        },
        {
          id: "wrangler.settings",
          title: "Wrangler: settings",
          group: "Tab Wrangler",
          palette: true,
          run: ui.settings,
        },
        {
          id: "wrangler.pause",
          title: "Wrangler: pause / resume",
          group: "Tab Wrangler",
          palette: true,
          run: ui.pause,
        },
        {
          id: "wrangler.restore",
          title: "Wrangler: reopen last closed tab",
          group: "Tab Wrangler",
          palette: true,
          run: async () => {
            const entry = controller.history()[0];
            if (entry) await controller.restore(entry.id);
          },
        },
      ],
    }));
    stop = context.data.listen(({ details }) => {
      // Only activity events touch timers; viewing metadata and refreshes must not keep idle tabs alive forever.
      if (
        !/^(session\.(message|execution|inbox)|permission\.|form\.)/.test(
          details.type,
        )
      )
        return;
      const data: unknown = details.data;
      if (
        typeof data !== "object" ||
        data === null ||
        !("sessionID" in data) ||
        typeof data.sessionID !== "string"
      )
        return;
      try {
        controller.touch(context.data.session.root(data.sessionID));
      } catch {
        controller.health =
          "Activity observation unavailable; cleanup blocked until settings/state are corrected";
      }
    });
    disposeEffect = env.effect(() => {
      try {
        context.ui.tabs.enabled();
        context.ui.tabs.list();
        context.ui.router.current();
        controller.observe(true);
      } catch {
        controller.health =
          "Settings/state invalid; cleanup blocked until corrected";
      }
    });
    const loop = async () => {
      let delay = 30000;
      try {
        await controller.tick();
        delay = controller.config().checkSeconds * 1000;
      } catch {
        controller.health =
          "Observation failed; cleanup suspended until state can be verified";
      }
      if (!stopped)
        timer = env.schedule(() => {
          void loop();
        }, delay);
    };
    void loop();
    return cleanup;
  } catch {
    cleanup();
    // Let the host unwind its scoped keymap registrations as well.
    throw new Error(
      "Tab Wrangler setup failed; resources released and cleanup disabled",
    );
  }
}
export default {
  id: "opencode.tab-wrangler",
  setup: (context) => setup(context),
} satisfies Plugin.Definition;
