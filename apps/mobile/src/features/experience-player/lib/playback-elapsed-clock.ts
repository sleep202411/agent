/** Monotonic story time for measuring contiguous viewing, excluding paused wall time. */
export class PlaybackElapsedClock {
  private anchor = performance.now();
  private elapsed = 0;
  private running = false;
  private rate = 1;

  now(): number {
    return (
      this.elapsed + (this.running ? Math.max(0, performance.now() - this.anchor) * this.rate : 0)
    );
  }

  update(running: boolean, rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0)
      throw new RangeError("Playback rate must be finite and positive.");
    this.elapsed = this.now();
    this.anchor = performance.now();
    this.running = running;
    this.rate = rate;
  }
}
