import { AgentUserRunnerService } from './agent-user-runner.service';

jest.mock('@ai-sdk/alibaba', () => ({ createAlibaba: jest.fn() }));
jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('../ip-commerce/ip-commerce.service', () => ({
  IpCommerceService: class {},
}));

function fixture(count = 0) {
  const agent = {
    id: 'agent-1',
    status: 'active',
    timezone: 'UTC',
    schedule: { dailyActionBudget: 30, hourlyActionBudget: 6 },
    policy: {},
  };
  const prisma = {
    agentUser: {
      findMany: jest.fn().mockResolvedValue([agent]),
      findUnique: jest.fn().mockResolvedValue(agent),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    agentAction: {
      count: jest.fn().mockImplementation(() => Promise.resolve(count)),
    },
  };
  const users = {
    createRun: jest.fn(),
    createAction: jest
      .fn()
      .mockImplementation((_id: string, input: { status: string }) => {
        if (input.status === 'succeeded') count += 1;
        return Promise.resolve({ id: `receipt-${count}` });
      }),
  };
  const ips = {
    recordAgentIpView: jest.fn().mockResolvedValue({ recorded: true }),
    likeAgentIp: jest.fn().mockResolvedValue({}),
    saveAgentCollectionItem: jest.fn().mockResolvedValue({}),
  };
  const runner = new AgentUserRunnerService(
    prisma as never,
    users as never,
    ips as never,
  );
  return { runner, prisma, users, ips, agent };
}

describe('Agent User runner background task isolation', () => {
  const keys = [
    'BACKGROUND_TASKS_ENABLED',
    'AGENT_USER_RUNNER_ENABLED',
    'AGENT_USER_RUNNER_RUN_ON_BOOT',
    'ALIBABA_API_KEY',
  ] as const;
  let previous: Array<string | undefined>;

  beforeEach(() => {
    previous = keys.map((key) => process.env[key]);
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    process.env.AGENT_USER_RUNNER_ENABLED = 'true';
    process.env.AGENT_USER_RUNNER_RUN_ON_BOOT = 'true';
    process.env.ALIBABA_API_KEY = 'unit-test-fixture-key';
    jest.useFakeTimers();
  });

  afterEach(() => {
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    jest.useRealTimers();
  });

  it('blocks boot scheduling and direct manual runs without reads or actions', async () => {
    const { runner, prisma, users, ips } = fixture();
    runner.onModuleInit();

    await expect(
      runner.runTick({
        trigger: 'manual_agent_internal',
        agentUserId: 'agent-1',
      }),
    ).resolves.toEqual({ skipped: true, reason: 'background_tasks_disabled' });

    expect(jest.getTimerCount()).toBe(0);
    expect(prisma.agentUser.findMany).not.toHaveBeenCalled();
    expect(prisma.agentUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.agentUser.updateMany).not.toHaveBeenCalled();
    expect(prisma.agentAction.count).not.toHaveBeenCalled();
    expect(users.createRun).not.toHaveBeenCalled();
    expect(users.createAction).not.toHaveBeenCalled();
    expect(ips.recordAgentIpView).not.toHaveBeenCalled();
    expect(ips.likeAgentIp).not.toHaveBeenCalled();
    expect(ips.saveAgentCollectionItem).not.toHaveBeenCalled();
    runner.onApplicationShutdown();
  });

  it('still validates the enabled runner required credential at startup', () => {
    delete process.env.ALIBABA_API_KEY;
    expect(() => fixture().runner.onModuleInit()).toThrow(
      'AGENT_USER_RUNNER_ENABLED=true requires ALIBABA_API_KEY.',
    );
    expect(jest.getTimerCount()).toBe(0);
  });
});
