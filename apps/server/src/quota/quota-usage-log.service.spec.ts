import { Logger } from '@nestjs/common';
import { QuotaUsageLogService } from './quota-usage-log.service';

const event = { userId: 'test', dimension: 'chat' as const, reason: 'test' };
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('quota usage log recovery', () => {
  let create: jest.Mock;
  let service: QuotaUsageLogService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    create = jest.fn().mockRejectedValue(new Error('database unavailable'));
    service = new QuotaUsageLogService({ quotaUsageLog: { create } } as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  async function openCircuit() {
    for (let i = 0; i < 33; i++) {
      service.log(event);
      await settle();
    }
    expect(create).toHaveBeenCalledTimes(33);
    service.log(event);
    expect(create).toHaveBeenCalledTimes(33);
  }
  it('resumes logging after the database recovers, without a restart', async () => {
    await openCircuit();
    create.mockResolvedValue({});
    await jest.advanceTimersByTimeAsync(30_000);
    service.log(event);
    await settle();
    expect(create).toHaveBeenCalledTimes(34);
    service.log({ ...event, cost: -1 });
    await settle();
    expect(create).toHaveBeenCalledTimes(35);
    const [lastWrite] = create.mock.calls[34] as [{ data: { cost: number } }];
    expect(lastWrite.data.cost).toBe(-1);
  });
  it('admits only one pending recovery attempt and backs off again on failure', async () => {
    await openCircuit();
    let reject!: (error: Error) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await jest.advanceTimersByTimeAsync(30_000);
    service.log(event);
    for (let i = 0; i < 10; i++) service.log(event);
    expect(create).toHaveBeenCalledTimes(34);
    reject(new Error('still unavailable'));
    await settle();
    service.log(event);
    expect(create).toHaveBeenCalledTimes(34);
    await jest.advanceTimersByTimeAsync(30_000);
    service.log(event);
    await settle();
    expect(create).toHaveBeenCalledTimes(35);
  });
});
