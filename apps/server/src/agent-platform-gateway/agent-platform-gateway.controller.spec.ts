import { AgentPlatformGatewayController } from './agent-platform-gateway.controller';
import { AgentPublicErrorSchema } from './agent-platform-gateway.dto';
import { AgentAdmissionRejectedException } from './agent-platform-invocation.service';

describe('AgentPlatformGatewayController', () => {
  it('publishes Retry-After without widening the public admission error body', async () => {
    const rejection = new AgentAdmissionRejectedException({
      scope: 'actor',
      dimension: 'active_runs',
      limit: 2,
      retryAfterSeconds: 7,
    });
    const gateway = {
      invoke: jest.fn().mockRejectedValue(rejection),
    };
    const controller = new AgentPlatformGatewayController(
      gateway as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const response = { setHeader: jest.fn() };

    await expect(
      controller.invoke(
        { userId: 'actor-1' },
        {
          schemaVersion: 'agent-invocation-gateway/v1',
          conversationId: '0197f4a2-0800-7000-8000-000000000004',
          inputEventId: 'event-1',
          clientMessageId: 'message-1',
          sessionName:
            'agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004',
          locale: 'en-US',
        },
        response as never,
      ),
    ).rejects.toBe(rejection);

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '7');
    expect(AgentPublicErrorSchema.parse(rejection.getResponse())).toStrictEqual(
      {
        code: 'AGENT_ADMISSION_CAPACITY_EXHAUSTED',
        messageKey: 'agent.error.capacity_exhausted',
        message:
          'Agent execution capacity is currently full. Retry after an active run settles.',
        retryable: true,
        diagnosticId: rejection.diagnosticId,
      },
    );
  });
});
