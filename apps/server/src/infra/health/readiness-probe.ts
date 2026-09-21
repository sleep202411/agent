/** One in-flight operation per dependency, even after its response times out. */
export class ReadinessProbeRunner {
  private readonly running = new Map<string, Promise<boolean>>();

  constructor(private readonly timeoutMs = 3_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Readiness timeout must be a positive integer');
    }
  }

  check(name: string, probe: () => Promise<boolean>): Promise<boolean> {
    const current = this.running.get(name);
    if (current) return current;

    let finish!: (ok: boolean) => void;
    const response = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    this.running.set(name, response);
    // Timing out the response does not cancel the operation. Keep its slot
    // occupied until it settles so repeated health requests cannot pile up work.
    const timer = setTimeout(() => finish(false), this.timeoutMs);
    void Promise.resolve()
      .then(probe)
      .then(
        (ok) => {
          finish(ok === true);
        },
        () => {
          finish(false);
        },
      )
      .finally(() => {
        clearTimeout(timer);
        this.running.delete(name);
      });
    return response;
  }
}
