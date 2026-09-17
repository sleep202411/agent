import { ReadinessProbeRunner } from './readiness-probe';

describe('bounded readiness probes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('accepts healthy dependencies and clears completed operations', async () => {
    const runner = new ReadinessProbeRunner();
    const probe = jest.fn(async () => true);
    await expect(runner.check('db', probe)).resolves.toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    await expect(runner.check('db', probe)).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent calls and bounds a stuck dependency', async () => {
    const runner = new ReadinessProbeRunner();
    const probe = jest.fn(() => new Promise<boolean>(() => {}));
    const first = runner.check('db', probe);
    expect(runner.check('db', probe)).toBe(first);
    await jest.advanceTimersByTimeAsync(3_000);
    await expect(first).resolves.toBe(false);
    await expect(runner.check('db', probe)).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('allows a fresh probe after a late completion without changing timed-out responses', async () => {
    const runner = new ReadinessProbeRunner();
    let resolve!: (ok: boolean) => void;
    const first = runner.check(
      'db',
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    );
    await jest.advanceTimersByTimeAsync(3_000);
    resolve(true);
    await jest.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe(false);
    await expect(runner.check('db', async () => true)).resolves.toBe(true);
  });

  it('handles late rejection and permits recovery', async () => {
    const runner = new ReadinessProbeRunner();
    let reject!: (error: Error) => void;
    const first = runner.check(
      'db',
      () =>
        new Promise<boolean>((_, r) => {
          reject = r;
        }),
    );
    await jest.advanceTimersByTimeAsync(3_000);
    reject(new Error('private connection detail'));
    await jest.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe(false);
    await expect(runner.check('db', async () => true)).resolves.toBe(true);
  });

  it('isolates dependency names and synchronous failures', async () => {
    const runner = new ReadinessProbeRunner();
    const stuck = runner.check('db', () => new Promise<boolean>(() => {}));
    await expect(runner.check('redis', async () => true)).resolves.toBe(true);
    await expect(
      runner.check('storage', () => {
        throw new Error('secret');
      }),
    ).resolves.toBe(false);
    await jest.advanceTimersByTimeAsync(3_000);
    await expect(stuck).resolves.toBe(false);
  });

  it('rejects invalid budgets', () => {
    for (const timeout of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => new ReadinessProbeRunner(timeout)).toThrow();
    }
  });
});
