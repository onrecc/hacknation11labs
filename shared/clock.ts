import type { ISO, Ms } from "./schema";

/** One clock per session: `t` = ms since session start (monotonic). Wall time only for `wall`. */
export class SessionClock {
  constructor(
    readonly perfAtT0: number = performance.now(),
    readonly wallAtT0: ISO = new Date().toISOString(),
  ) {}

  /** Re-create the clock of an existing session (e.g. a second tab joining). */
  static fromWall(wallAtT0: ISO): SessionClock {
    const elapsed = Date.now() - Date.parse(wallAtT0);
    return new SessionClock(performance.now() - elapsed, wallAtT0);
  }

  now(): Ms {
    return Math.round(performance.now() - this.perfAtT0);
  }

  wall(t: Ms): ISO {
    return new Date(Date.parse(this.wallAtT0) + t).toISOString();
  }
}
