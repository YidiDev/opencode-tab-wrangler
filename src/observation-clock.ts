interface Sample {
  wall: number;
  mono: number;
}
/** Accounts for intentional waits without hiding suspension, clock rollback, or an idle event loop. */
export class ObservationClock {
  private last?: Sample;
  private waits = new Map<symbol, Sample>();
  constructor(
    private now: () => number,
    private monotonic?: () => number,
  ) {}
  private sample(): Sample {
    const wall = this.now();
    return { wall, mono: this.monotonic?.() ?? wall };
  }
  check(budgetMs: number): "gap" | "rollback" | undefined {
    const current = this.sample(),
      previous = this.last;
    this.last = current;
    if (!previous) return;
    if (current.wall < previous.wall || current.mono < previous.mono) {
      this.waits.clear();
      return "rollback";
    }
    let wall = previous.wall,
      mono = previous.mono;
    for (const end of this.waits.values()) {
      wall = Math.max(wall, end.wall);
      mono = Math.max(mono, end.mono);
    }
    if (current.wall - wall > budgetMs || current.mono - mono > budgetMs)
      return "gap";
  }
  beginWait(ms: number): symbol {
    const key = Symbol(),
      current = this.sample();
    this.waits.set(key, { wall: current.wall + ms, mono: current.mono + ms });
    return key;
  }
  endWait(key: symbol) {
    this.waits.delete(key);
  }
}
