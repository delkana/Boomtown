import { TICK_SECONDS } from "../game/constants";

/**
 * Fixed-timestep game loop.
 *
 * Two cadences:
 *   - SIMULATION ticks at a fixed real interval (TICK_SECONDS). This is the
 *     economy step; in multiplayer the server owns this clock and the client
 *     just renders whatever snapshots arrive.
 *   - RENDER runs every animation frame, decoupled from simulation, so panning
 *     and hover stay smooth regardless of tick rate.
 */
export interface LoopCallbacks {
  onTick: () => void;
  onRender: (dtMs: number) => void;
}

export class GameLoop {
  private rafId = 0;
  private lastFrame = 0;
  private tickAccumulatorMs = 0;
  private readonly tickIntervalMs = TICK_SECONDS * 1000;
  private running = false;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = now - this.lastFrame;
      this.lastFrame = now;

      this.tickAccumulatorMs += dt;
      // Catch up on any whole ticks that elapsed (clamped to avoid spirals).
      let guard = 0;
      while (this.tickAccumulatorMs >= this.tickIntervalMs && guard++ < 5) {
        this.tickAccumulatorMs -= this.tickIntervalMs;
        this.cb.onTick();
      }

      this.cb.onRender(dt);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
