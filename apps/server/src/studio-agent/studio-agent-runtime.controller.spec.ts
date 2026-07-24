import { StudioAgentRuntimeController } from './studio-agent-runtime.controller';

describe('StudioAgentRuntimeController', () => {
  it('keeps every runtime command in the canonical success envelope', async () => {
    const result = { id: 'canonical-result' };
    const runtime = {
      appendEvent: jest.fn().mockResolvedValue(result),
      loadModelPlan: jest.fn().mockResolvedValue(result),
      prepareAction: jest.fn().mockResolvedValue(result),
      prepareChildRun: jest.fn().mockResolvedValue(result),
      executeAction: jest.fn().mockResolvedValue(result),
      denyAction: jest.fn().mockResolvedValue(result),
      resolveApproval: jest.fn().mockResolvedValue(result),
      consumeInput: jest.fn().mockResolvedValue(result),
      transitionRun: jest.fn().mockResolvedValue(result),
    };
    const controller = new StudioAgentRuntimeController(runtime as never);
    const body = { schemaVersion: 'studio-agent-v1' };

    const responses = await Promise.all([
      controller.appendEvent(body as never),
      controller.loadModelPlan(body as never),
      controller.prepareAction(body as never),
      controller.prepareChildRun(body as never),
      controller.executeAction(body as never),
      controller.denyAction(body as never),
      controller.resolveApproval(body as never),
      controller.consumeInput(body as never),
      controller.transitionRun(body as never),
    ]);

    expect(responses).toEqual(
      Array.from({ length: 9 }, () => ({ code: 200, data: result })),
    );
    for (const method of Object.values(runtime)) {
      expect(method).toHaveBeenCalledWith(body);
    }
  });
});
