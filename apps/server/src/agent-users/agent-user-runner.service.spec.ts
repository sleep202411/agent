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

describe('Agent User runner action limits', () => {
  it('enforces the daily budget even when the hourly budget has room', async () => {
    const { runner, prisma, users } = fixture();
    prisma.agentAction.count.mockResolvedValueOnce(30).mockResolvedValueOnce(0);
    await expect(
      runner.runTick({
        trigger: 'manual_agent_internal',
        agentUserId: 'agent-1',
      }),
    ).resolves.toMatchObject({
      results: [{ status: 'skipped', reason: 'daily_budget' }],
    });
    expect(users.createRun).not.toHaveBeenCalled();
  });

  it('allows a compound action that exactly fits the remaining budget', async () => {
    const { runner, ips } = fixture(4);
    await runner['executeDecision']({
      agentUserId: 'agent-1',
      runId: 'run-1',
      policy: {},
      candidates: [{ id: 'ip-1' } as never],
      decision: {
        runSummary: '',
        memories: [],
        actions: [{ ipId: 'ip-1', action: 'like', reason: '' }],
      },
    });
    expect(ips.recordAgentIpView).toHaveBeenCalledTimes(1);
    expect(ips.likeAgentIp).toHaveBeenCalledTimes(1);
  });

  it('does not execute a decision if the agent was paused while planning', async () => {
    const { runner, ips, agent } = fixture();
    agent.status = 'paused';
    await runner['executeDecision']({
      agentUserId: 'agent-1',
      runId: 'run-1',
      policy: {},
      candidates: [{ id: 'ip-1' } as never],
      decision: {
        runSummary: '',
        memories: [],
        actions: [{ ipId: 'ip-1', action: 'view', reason: '' }],
      },
    });
    expect(ips.recordAgentIpView).not.toHaveBeenCalled();
  });

  it('does not let a targeted manual run bypass the hourly budget', async () => {
    const { runner, users } = fixture(6);
    await expect(
      runner.runTick({
        trigger: 'manual_agent_internal',
        agentUserId: 'agent-1',
      }),
    ).resolves.toMatchObject({
      results: [{ status: 'skipped', reason: 'hourly_budget' }],
    });
    expect(users.createRun).not.toHaveBeenCalled();
  });

  it('claims targeted manual runs before starting a second execution', async () => {
    const { runner, prisma, users } = fixture();
    prisma.agentUser.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      runner.runTick({
        trigger: 'manual_agent_internal',
        agentUserId: 'agent-1',
      }),
    ).resolves.toMatchObject({
      results: [{ status: 'skipped', reason: 'already_claimed' }],
    });
    expect(users.createRun).not.toHaveBeenCalled();
  });

  it.each(['like', 'collect'] as const)(
    'counts the implicit view before admitting %s',
    async (action) => {
      const { runner, ips, users } = fixture(5);
      await runner['executeDecision']({
        agentUserId: 'agent-1',
        runId: 'run-1',
        policy: {},
        candidates: [{ id: 'ip-1' } as never],
        decision: {
          runSummary: '',
          memories: [],
          actions: [{ ipId: 'ip-1', action, reason: '' }],
        },
      });
      expect(ips.recordAgentIpView).not.toHaveBeenCalled();
      expect(ips.likeAgentIp).not.toHaveBeenCalled();
      expect(ips.saveAgentCollectionItem).not.toHaveBeenCalled();
      expect(users.createAction).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          status: 'skipped',
          result: { reason: 'hourly_budget' },
        }),
      );
    },
  );

  it('stops a decision batch at the remaining budget', async () => {
    const { runner, ips } = fixture(5);
    await runner['executeDecision']({
      agentUserId: 'agent-1',
      runId: 'run-1',
      policy: {},
      candidates: [{ id: 'ip-1' } as never, { id: 'ip-2' } as never],
      decision: {
        runSummary: '',
        memories: [],
        actions: [
          { ipId: 'ip-1', action: 'view', reason: '' },
          { ipId: 'ip-2', action: 'view', reason: '' },
        ],
      },
    });
    expect(ips.recordAgentIpView).toHaveBeenCalledTimes(1);
  });
});

describe('Agent User capability enforcement', () => {
  it.each(['view', 'like', 'collect'] as const)(
    'does not execute %s when browsing is disabled',
    async (action) => {
      const { runner, ips, users } = fixture();
      await runner['executeDecision']({
        agentUserId: 'agent-1',
        runId: 'run-1',
        policy: { capabilities: { viewIp: false } },
        candidates: [{ id: 'ip-1' } as never],
        decision: {
          runSummary: '',
          memories: [],
          actions: [{ ipId: 'ip-1', action, reason: '' }],
        },
      });
      expect(ips.recordAgentIpView).not.toHaveBeenCalled();
      expect(ips.likeAgentIp).not.toHaveBeenCalled();
      expect(ips.saveAgentCollectionItem).not.toHaveBeenCalled();
      expect(users.createAction).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          status: 'skipped',
          result: { reason: 'view_disabled' },
        }),
      );
    },
  );
  it.each([
    ['view', 'viewIp'],
    ['like', 'likeIp'],
    ['collect', 'collectIp'],
  ] as const)(
    'rechecks a revoked %s capability after planning',
    async (action, capability) => {
      const { runner, ips, agent } = fixture();
      agent.policy = { capabilities: { [capability]: false } };
      await runner['executeDecision']({
        agentUserId: 'agent-1',
        runId: 'run-1',
        policy: {},
        candidates: [{ id: 'ip-1' } as never],
        decision: {
          runSummary: '',
          memories: [],
          actions: [{ ipId: 'ip-1', action, reason: '' }],
        },
      });
      expect(ips.recordAgentIpView).not.toHaveBeenCalled();
      expect(ips.likeAgentIp).not.toHaveBeenCalled();
      expect(ips.saveAgentCollectionItem).not.toHaveBeenCalled();
    },
  );
});
