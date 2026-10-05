import { ForbiddenException } from '@nestjs/common';
import { AgentUsersInternalController } from './agent-users-internal.controller';

jest.mock('./agent-user-runner.service', () => ({
  AgentUserRunnerService: class {},
}));
jest.mock('../ip-commerce/ip-commerce.service', () => ({
  IpCommerceService: class {},
}));

it.each([
  ['viewIp', 'recordIpView', 'recordAgentIpView'],
  ['likeIp', 'likeIp', 'likeAgentIp'],
  ['collectIp', 'collectIp', 'saveAgentCollectionItem'],
] as const)(
  'rejects disabled %s before internal API side effects',
  async (capability, method, target) => {
    const users = {
      ensureRunnable: jest.fn().mockResolvedValue({
        policy: { capabilities: { [capability]: false } },
      }),
      createAction: jest.fn(),
    };
    const ips = { [target]: jest.fn() };
    const controller = new AgentUsersInternalController(
      users as never,
      {} as never,
      ips as never,
    );
    const params = { agentUserId: 'agent-1', ipId: 'ip-1' };
    await expect(
      method === 'recordIpView'
        ? controller.recordIpView(params, {} as never)
        : controller[method](params),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ips[target]).not.toHaveBeenCalled();
    expect(users.createAction).not.toHaveBeenCalled();
  },
);

it.each(['unlikeIp', 'uncollectIp'] as const)(
  'allows %s to undo engagement after capabilities are disabled',
  async (method) => {
    const users = {
      ensureRunnable: jest.fn().mockResolvedValue({
        policy: { capabilities: { likeIp: false, collectIp: false } },
      }),
      createAction: jest.fn().mockResolvedValue({}),
    };
    const ips = {
      unlikeAgentIp: jest.fn().mockResolvedValue({}),
      removeAgentCollectionItem: jest.fn().mockResolvedValue({}),
    };
    const controller = new AgentUsersInternalController(
      users as never,
      {} as never,
      ips as never,
    );
    await controller[method]({ agentUserId: 'agent-1', ipId: 'ip-1' });
    expect(
      method === 'unlikeIp' ? ips.unlikeAgentIp : ips.removeAgentCollectionItem,
    ).toHaveBeenCalledWith('agent-1', 'ip-1');
  },
);
