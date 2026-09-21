import { ChatEventsGateway } from './chat/chat-events.gateway';
import { EntityEventsGateway } from './chat/entity-events.gateway';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import { ProduceProxyController } from './produce-proxy.controller';
import type { AuthUser } from '../auth';
import type { SparkService } from '../spark/spark.service';
import type { EntitlementService } from '../entitlements';
import { mastraFetch } from './mastra-fetch';

jest.mock('./mastra-fetch', () => ({ mastraFetch: jest.fn() }));
jest.mock('../spark/spark.service', () => ({ SparkService: class {} }));
jest.mock('../entitlements', () => ({ EntitlementService: class {} }));

describe('Produce proxy cookie diagnostics', () => {
  const oldUrl = process.env.MASTRA_URL;
  let logs: jest.SpyInstance;
  let warnings: jest.SpyInstance;
  let controller: ProduceProxyController;
  beforeEach(() => {
    process.env.MASTRA_URL = 'http://agent.test.invalid';
    logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnings = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    (mastraFetch as jest.Mock).mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ runId: 'test' }),
    });
    controller = new ProduceProxyController(
      {
        extractAndCacheUpload: jest.fn().mockResolvedValue({
          textRef: 'ref',
          text: 'story',
          excerpt: 'story',
        }),
      } as unknown as SparkService,
      {} as EntitlementService,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (oldUrl === undefined) delete process.env.MASTRA_URL;
    else process.env.MASTRA_URL = oldUrl;
  });
  it.each(['sync', 'upload'])(
    'keeps cookie values out of %s logs while forwarding authentication',
    async (route) => {
      const cookie = 'satoken=FAKE_SECRET_SESSION; other=FAKE_PRIVATE_COOKIE';
      const req = { headers: { cookie } } as Request;
      const user = { userId: 'test-user' } as AuthUser;
      if (route === 'sync')
        await controller.sync({ projectId: 'test-project' }, user, req);
      else
        await controller.step1GenerateFromFile(
          { buffer: Buffer.from('story'), originalname: 'story.txt', size: 5 },
          { projectId: 'test-project' },
          user,
          req,
        );
      const output = JSON.stringify([
        ...logs.mock.calls,
        ...warnings.mock.calls,
      ]);
      expect(output).not.toContain('FAKE_SEC');
      expect(output).not.toContain('FAKE_PRIVATE');
      expect(output).toContain('cookie=present');
      expect((mastraFetch as jest.Mock).mock.calls[0][1].headers.cookie).toBe(
        cookie,
      );
    },
  );
  it('retains missing-cookie diagnostics without inventing authentication', async () => {
    await controller.sync(
      { projectId: 'test-project' },
      { userId: 'test-user' } as AuthUser,
      { headers: {} } as Request,
    );
    expect(JSON.stringify(warnings.mock.calls)).toContain('cookie=MISSING');
    expect(
      (mastraFetch as jest.Mock).mock.calls[0][1].headers.cookie,
    ).toBeUndefined();
  });
});

it.each(['chat', 'entity'])(
  'redacts %s handshake and rejection diagnostics',
  async (kind) => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const validateToken = jest.fn().mockResolvedValue(null);
    const gateway =
      kind === 'chat'
        ? new ChatEventsGateway({ validateToken } as never, {} as never)
        : new EntityEventsGateway({ validateToken } as never);
    try {
      await gateway.handleConnection(
        { send: jest.fn(), close: jest.fn() } as never,
        {
          url: '/?projectId=test&satoken=FAKE_SECRET_SESSION',
          headers: { host: 'localhost' },
        } as never,
      );
      expect(validateToken).toHaveBeenCalledWith('satoken=FAKE_SECRET_SESSION');
      expect(JSON.stringify([log.mock.calls, warn.mock.calls])).not.toContain(
        'FAKE_SEC',
      );
      expect(JSON.stringify(log.mock.calls)).toContain('src=query');
    } finally {
      jest.restoreAllMocks();
    }
  },
);
