import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createRoot } from "solid-js";
import { Controller } from "./controller";
import { createHost } from "./host";
import { initialState } from "./state";
import type { Persisted, Runtime } from "./model";
import { createUI } from "./ui";
import { createSleeper } from "./clock";

export default Plugin.define({
  id: "opencode.tab-wrangler",
  async setup(context) {
    if (context.app.version.replace(/^v/, "") !== "2.1.4") {
      context.ui.toast.show({
        message:
          "Tab Wrangler: this release supports OpenCode 2.1.4 only; cleanup disabled.",
        variant: "warning",
      });
      return;
    }
    const [state, update] = context.storage.store<Persisted>("state", {
      initial: initialState(),
    });
    const [memory, updateMemory] = context.storage.memory<Runtime>("runtime", {
      initial: { pauseUntil: 0, observations: {} },
    });
    // Observations remain TUI-local; use a mutable working copy, checkpointed across plugin reloads.
    const runtime: Runtime = {
      pauseUntil: memory.pauseUntil,
      observations: structuredClone(
        JSON.parse(JSON.stringify(memory.observations)),
      ),
    };
    let controller: Controller;
    const sleeper = createSleeper();
    try {
      controller = new Controller({
        host: createHost(context),
        options: context.options,
        state,
        runtime,
        update,
        now: Date.now,
        sleep: sleeper.sleep,
        notify: (message) =>
          context.ui.toast.show({ message, variant: "info" }),
        changed: () =>
          updateMemory((draft) => {
            draft.pauseUntil = runtime.pauseUntil;
            draft.observations = JSON.parse(
              JSON.stringify(runtime.observations),
            );
          }),
      });
    } catch {
      context.ui.toast.show({
        message:
          "Tab Wrangler: invalid settings or stored state; disabled without closing tabs. Check cli.json against schema.json.",
        variant: "error",
      });
      return;
    }
    try {
      await controller.reconcile();
    } catch {
      controller.dispose();
      context.ui.toast.show({
        message:
          "Tab Wrangler: could not persist recovery state; disabled without closing tabs.",
        variant: "error",
      });
      return;
    }
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
    let stopped = false;
    const stop = context.data.listen(({ details }) => {
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
      controller.touch(context.data.session.root(data.sessionID));
    });
    const disposeEffect = createRoot((dispose) => {
      createEffect(() => {
        context.ui.tabs.enabled();
        context.ui.tabs.list();
        context.ui.router.current();
        controller.observe(true);
      });
      return dispose;
    });
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      try {
        await controller.tick();
      } catch {
        controller.health =
          "Observation failed; cleanup suspended until state can be verified";
      }
      if (!stopped)
        timer = setTimeout(() => {
          void loop();
        }, controller.config().checkSeconds * 1000);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stop();
      disposeEffect();
      controller.dispose();
      sleeper.dispose();
    };
  },
});
