import {
  DiscoveryAssistantController,
  DiscoveryAssistantReadController,
} from './discovery-assistant.controller';
import type { DiscoveryAssistantService } from './discovery-assistant.service';
import { IS_PUBLIC_KEY, SKIP_END_USER_AUTH_KEY } from '../auth/auth.decorator';

describe('discovery controller authentication', () => {
  const previous = process.env.AGENT_OS_INTERNAL_TOKEN;
  afterEach(() => {
    if (previous === undefined) delete process.env.AGENT_OS_INTERNAL_TOKEN;
    else process.env.AGENT_OS_INTERNAL_TOKEN = previous;
  });
  it('keeps all browser assistant actions behind the global session guard', () => {
    for (const key of ['run', 'receipt', 'cancel'] as const) {
      const method = DiscoveryAssistantController.prototype[key];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, method)).toBeUndefined();
      expect(
        Reflect.getMetadata(SKIP_END_USER_AUTH_KEY, method),
      ).toBeUndefined();
    }
  });
  it('requires configured constant-time machine authentication before scoped reads', async () => {
    const read = jest.fn().mockResolvedValue({ allowed: true });
    const controller = new DiscoveryAssistantReadController({
      read,
    } as unknown as DiscoveryAssistantService);
    const body = {
      requestId: '11111111-1111-4111-8111-111111111111',
      readToken: 'a'.repeat(64),
      kind: 'creators' as const,
      input: {
        requestId: '11111111-1111-4111-8111-111111111111',
        query: {
          basedIn: null,
          serves: null,
          remoteOnly: false,
          availableForWork: false,
          category: null,
          text: '',
        },
        cursor: null,
        limit: 1,
        selectedCreatorId: null,
        map: null,
      },
    };
    delete process.env.AGENT_OS_INTERNAL_TOKEN;
    await expect(controller.read(undefined, body)).rejects.toThrow(
      'authentication',
    );
    process.env.AGENT_OS_INTERNAL_TOKEN = 'private-machine-token';
    await expect(
      controller.read('invalid-machine-token', body),
    ).rejects.toThrow('authentication');
    expect(read).not.toHaveBeenCalled();
    await expect(
      controller.read('private-machine-token', body),
    ).resolves.toEqual({ allowed: true });
    expect(read).toHaveBeenCalledWith(body);
  });
});
