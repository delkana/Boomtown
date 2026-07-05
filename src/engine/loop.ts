/**
 * RenderLoop: a per-animation-frame render loop.
 *
 * The economy TICK is no longer driven here — that's the server's job now
 * (AuthoritativeGame runs it on a fixed real-time interval and broadcasts
 * snapshots). The client just paints the latest known state every frame and
 * applies smooth input (panning), decoupled from the tick rate.
 */
export class RenderLoop {
  private rafId = 0;
  private lastFrame = 0;
  private running = false;

  constructor(private readonly onFrame: (dtMs: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = now - this.lastFrame;
      this.lastFrame = now;
      this.onFrame(dt);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
