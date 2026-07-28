import { NotFoundException, RequestMethod } from '@nestjs/common';
import {
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY } from '@repo/shared/studio-agent-transport';
import type { AuthUser } from '../auth';
import { anyString } from './__tests__/typed-expect';
import { StudioAgentController } from './studio-agent.controller';

const THREAD_ID = '019f8c10-0000-7000-8000-0000000000a0';
const CHANNEL = `studio-agent:thread:${THREAD_ID}`;
const USER: AuthUser = { userId: 'user-7' };

const GRANT = {
  channel: CHANNEL,
  ttlMs: 120_000,
  tokenRequest: {
    keyName: 'app.key',
    clientId: 'user-7',
    capability: JSON.stringify({
      [CHANNEL]: [...STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY],
    }),
    timestamp: 1_770_000_000_000,
    nonce: 'nonce-0123456789abcdef',
    mac: 'signature',
    ttl: 120_000,
  },
};

function harness(options: { authorized?: boolean } = {}) {
  const authorized = options.authorized ?? true;
  const studioAgent = {
    requireThread: jest.fn(() =>
      authorized
        ? Promise.resolve({ id: THREAD_ID })
        : Promise.reject(
            new NotFoundException({
              code: 'STUDIO_AGENT_THREAD_NOT_FOUND',
              message: 'Agent conversation not found.',
            }),
          ),
    ),
    startInvocation: jest.fn(() =>
      Promise.resolve({
        threadId: THREAD_ID,
        messageId: '019f8c10-0000-7000-8000-0000000000b0',
        runId: '019f8c10-0000-7000-8000-0000000000c0',
        inputId: null,
        channelName: CHANNEL,
      }),
    ),
  };
  const realtimeTokens = {
    issueThreadToken: jest.fn(() => Promise.resolve(GRANT)),
  };
  const controller = new StudioAgentController(
    studioAgent as never,
    realtimeTokens as never,
  );
  return { controller, studioAgent, realtimeTokens };
}

function route(name: string): object {
  return Object.getOwnPropertyDescriptor(StudioAgentController.prototype, name)
    ?.value as object;
}

describe('StudioAgentController realtime token', () => {
  it('mints a grant for the caller, in the house envelope', async () => {
    const { controller, realtimeTokens } = harness();

    const response = await controller.realtimeToken(USER, {
      threadId: THREAD_ID,
    });

    expect(response).toEqual({ code: 200, data: GRANT });
    expect(realtimeTokens.issueThreadToken).toHaveBeenCalledWith(
      THREAD_ID,
      'user-7',
    );
  });

  it('re-runs the thread read authorization on EVERY mint', async () => {
    // A token lives for its TTL and nothing renews it but another call here.
    // Authorizing once and then minting freely would make the TTL decorative:
    // a withdrawn grant would keep refreshing for as long as the tab was open.
    const { controller, studioAgent } = harness();

    await controller.realtimeToken(USER, { threadId: THREAD_ID });
    await controller.realtimeToken(USER, { threadId: THREAD_ID });
    await controller.realtimeToken(USER, { threadId: THREAD_ID });

    expect(studioAgent.requireThread).toHaveBeenCalledTimes(3);
    expect(studioAgent.requireThread).toHaveBeenLastCalledWith(USER, THREAD_ID);
  });

  it('answers 404 — never 403 — for a caller with no access, and mints nothing', async () => {
    // Non-probeable posture, matching every other route in the module: a thread
    // you may not read is indistinguishable from a thread that does not exist.
    // A 403 would confirm the id belongs to somebody.
    const { controller, realtimeTokens } = harness({ authorized: false });

    const failure = await controller
      .realtimeToken(USER, { threadId: THREAD_ID })
      .then(
        () => null,
        (error: unknown) => error as NotFoundException,
      );

    expect(failure).toBeInstanceOf(NotFoundException);
    expect(failure?.getStatus()).toBe(404);
    expect(realtimeTokens.issueThreadToken).not.toHaveBeenCalled();
  });

  it('is a GET that no cache may keep a copy of', () => {
    // The response body is a bearer credential.
    expect(Reflect.getMetadata(PATH_METADATA, route('realtimeToken'))).toBe(
      'threads/:threadId/realtime-token',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, route('realtimeToken'))).toBe(
      RequestMethod.GET,
    );
    expect(
      Reflect.getMetadata(HEADERS_METADATA, route('realtimeToken')),
    ).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
  });
});

describe('StudioAgentController invocation endpoint', () => {
  it('is the POST the library aims at, at the path the client transport uses', () => {
    // `@ably/ai-transport`'s ChatTransport POSTs `Invocation.toJSON()` to a
    // single configured `api`. The path is part of the wire contract with the
    // browser; moving it silently is a turn that never starts.
    expect(Reflect.getMetadata(PATH_METADATA, route('startInvocation'))).toBe(
      'invocations',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, route('startInvocation'))).toBe(
      RequestMethod.POST,
    );
  });

  it('hands the whole body to the service and answers in the house envelope', async () => {
    const { controller, studioAgent } = harness();
    const body = {
      inputEventId: 'AAAAA0LrQ:0:0',
      sessionName: CHANNEL,
      threadId: THREAD_ID,
      clientMessageId: '019f8c10-0000-7000-8000-0000000000d0',
      parts: [
        { type: 'text' as const, format: 'plain_text' as const, text: 'Hi.' },
      ],
      targetRunId: null,
      delivery: null,
      kind: 'submission' as const,
      scope: {
        workspaceId: 'workspace-1',
        container: {
          resourceType: 'story.project',
          resourceId: '019f8c10-0000-7000-8000-0000000000e0',
          revision: null,
        },
        focus: null,
      },
      locale: 'en-US',
    };

    const response = await controller.startInvocation(USER, body);

    expect(studioAgent.startInvocation).toHaveBeenCalledWith(USER, body);
    expect(response).toMatchObject({
      code: 200,
      data: { runId: anyString() },
    });
  });
});

describe('StudioAgentController retired surface', () => {
  it.each([
    // Replay. The conversation is read from the channel (`view.loadOlder`)
    // seeded by the thread snapshot; a journal cursor endpoint would be a
    // second history with a different shape.
    ['eventPage'],
    // A server-sent stream whose live wake no longer exists would be a poller
    // wearing a stream's clothes — and behind Azure Front Door, which does not
    // support SSE, it never worked in production at all.
    ['eventStream'],
    // Two ways to start a turn is two authorization paths to keep in step.
    // `POST invocations` is the one the library calls, so it is the only one.
    ['submitMessage'],
    // The hand-rolled approval. `POST threads/:id/approvals/:approvalId/resolve`
    // was a second authorization path for one decision, and it never worked: the
    // workflow it signalled resumed the run's status only AFTER trying to
    // execute the approved action, so the executor answered 409
    // `STUDIO_AGENT_RUN_NOT_EXECUTABLE`. Approvals now arrive on `POST
    // invocations` like every other thing the creator does, published by the
    // library's own continuation.
    ['resolveApproval'],
  ])('no longer exposes %s', (name) => {
    expect(StudioAgentController.prototype).not.toHaveProperty(name);
  });

  it('takes no event store, so it cannot grow a replay route back by accident', () => {
    // The constructor is the boundary: a controller that cannot reach the
    // journal cannot serve it. Two parameters — the service and the token
    // issuer.
    expect(StudioAgentController.length).toBe(2);
  });
});
