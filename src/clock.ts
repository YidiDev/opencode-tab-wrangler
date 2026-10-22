/** Resolve cancelled sleeps so stale async runners can reach their disposal checks without leaking timers. */
export function createSleeper() {
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  let disposed = false;
  return {
    sleep(ms: number): Promise<void> {
      if (disposed) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          resolve();
        }, ms);
        timers.set(timer, resolve);
      });
    },
    dispose() {
      disposed = true;
      for (const [timer, resolve] of timers) {
        clearTimeout(timer);
        resolve();
      }
      timers.clear();
    },
  };
}
