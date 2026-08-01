import type { PrismaClient } from '@prisma/client';

import type { AuthUser } from '../auth';
import { buildPrisma } from '../infra/db/db.module';
import type {
  AgentConversationScopeRequest,
  AuthorizedAgentScope,
} from './agent-platform-gateway.dto';
import { AgentPlatformConversationService } from './agent-platform-conversation.service';

const describePostgres =
  process.env.AGENT_PLATFORM_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;

const ACTOR_ID = 'agent-platform-conversation-integration';
const USER = Object.freeze({ userId: ACTOR_ID });

describePostgres('Agent Platform conversation PostgreSQL boundary', () => {
  let prisma: PrismaClient;
  let authorization: {
    authorize: jest.MockedFunction<
      (
        user: AuthUser,
        request: AgentConversationScopeRequest,
      ) => Promise<AuthorizedAgentScope>
    >;
  };
  let service: AgentPlatformConversationService;

  beforeAll(async () => {
    prisma = buildPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.agentPlatformConversation.deleteMany({
      where: { ownerActorId: ACTOR_ID },
    });
    const authorize: typeof authorization.authorize = jest.fn(
      (user, request) => {
        if (request.surface !== 'crew-management') {
          return Promise.reject(
            new Error('This integration fixture accepts only crew scope.'),
          );
        }
        return Promise.resolve({
          actorId: user.userId,
          actorDisplayName: 'Integration Actor',
          surface: 'crew-management' as const,
          scope: {
            kind: 'crew' as const,
            crewId: request.crewId,
          },
          locale: request.locale,
          roles: ['crew.admin'],
          permissions: ['crew.read', 'crew.manage'],
        });
      },
    );
    authorization = {
      authorize,
    };
    service = new AgentPlatformConversationService(
      prisma as never,
      authorization as never,
    );
  });

  afterEach(async () => {
    await prisma.agentPlatformConversation.deleteMany({
      where: { ownerActorId: ACTOR_ID },
    });
  });

  it('converges concurrent resolves onto exactly one active conversation', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.resolve(USER, {
          schemaVersion: 'agent-conversation-resolve/v1',
          surface: 'crew-management',
          crewId: 'integration-crew',
          locale: 'en-GB',
        }),
      ),
    );

    expect(new Set(results.map((result) => result.conversation.id)).size).toBe(
      1,
    );
    await expect(
      prisma.agentPlatformConversation.count({
        where: {
          ownerActorId: ACTOR_ID,
          surface: 'crew-management',
          archivedAt: null,
        },
      }),
    ).resolves.toBe(1);
  });

  it('atomically archives the current conversation before creating a new one', async () => {
    const current = await service.resolve(USER, {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'crew-management',
      crewId: 'integration-crew',
      locale: 'en-GB',
    });
    const replacement = await service.create(USER, {
      schemaVersion: 'agent-conversation-create/v1',
      surface: 'crew-management',
      crewId: 'integration-crew',
      locale: 'en-GB',
      permissionMode: 'ask',
    });

    expect(replacement.conversation.id).not.toBe(current.conversation.id);
    expect(replacement.conversation.permissionMode).toBe('ask');
    const archived = await prisma.agentPlatformConversation.findUniqueOrThrow({
      where: { id: current.conversation.id },
      select: { archivedAt: true },
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(
      prisma.agentPlatformConversation.count({
        where: { ownerActorId: ACTOR_ID, archivedAt: null },
      }),
    ).resolves.toBe(1);
  });

  it('reloads stored scope for reauthorization and conceals other owners', async () => {
    const created = await service.resolve(USER, {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'crew-management',
      crewId: 'integration-crew',
      locale: 'en-GB',
    });
    authorization.authorize.mockClear();

    await expect(
      service.authorizeExisting(USER, {
        schemaVersion: 'agent-session-grant-request/v1',
        conversationId: created.conversation.id,
        locale: 'zh-CN',
      }),
    ).resolves.toMatchObject({
      context: {
        conversationId: created.conversation.id,
        scope: { kind: 'crew', crewId: 'integration-crew' },
        locale: 'zh-CN',
      },
    });
    expect(authorization.authorize).toHaveBeenCalledWith(USER, {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'crew-management',
      crewId: 'integration-crew',
      locale: 'zh-CN',
    });

    await expect(
      service.authorizeExisting(
        { userId: 'another-actor' },
        {
          schemaVersion: 'agent-session-grant-request/v1',
          conversationId: created.conversation.id,
          locale: 'en-GB',
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('persists permission preference and signs the refreshed policy', async () => {
    const created = await service.resolve(USER, {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'crew-management',
      crewId: 'integration-crew',
      locale: 'en-GB',
    });

    await expect(
      service.updatePreference(USER, {
        schemaVersion: 'agent-conversation-preference/v1',
        conversationId: created.conversation.id,
        locale: 'en-GB',
        permissionMode: 'full',
      }),
    ).resolves.toMatchObject({
      conversation: { permissionMode: 'full' },
      context: { permissionMode: 'full' },
    });
    await expect(
      prisma.agentPlatformConversation.findUniqueOrThrow({
        where: { id: created.conversation.id },
        select: { permissionMode: true },
      }),
    ).resolves.toEqual({ permissionMode: 'full' });
  });

  it('enforces closed scope shape and one-active-conversation invariants in PostgreSQL', async () => {
    const first = await service.resolve(USER, {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'crew-management',
      crewId: 'integration-crew',
      locale: 'en-GB',
    });
    const row = await prisma.agentPlatformConversation.findUniqueOrThrow({
      where: { id: first.conversation.id },
    });

    await expect(
      prisma.$executeRaw`
        INSERT INTO "agent_platform_conversations" (
          "id",
          "owner_actor_id",
          "surface",
          "scope_kind",
          "scope_key",
          "scope"
        ) VALUES (
          gen_random_uuid(),
          ${ACTOR_ID},
          'crew-management',
          'crew',
          ${row.scopeKey},
          '{"kind":"crew","crewId":"integration-crew","forged":true}'::jsonb
        )
      `,
    ).rejects.toThrow();

    await expect(
      prisma.agentPlatformConversation.create({
        data: {
          ownerActorId: ACTOR_ID,
          surface: row.surface,
          scopeKind: row.scopeKind,
          scopeKey: row.scopeKey,
          scope: { kind: 'crew', crewId: 'integration-crew' },
        },
      }),
    ).rejects.toThrow();
  });
});
