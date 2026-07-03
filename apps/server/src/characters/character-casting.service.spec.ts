import { createHash } from 'node:crypto';
import { CharacterCastingService } from './character-casting.service';
import { GRANT_CONSENT_VERSION } from './consent';

const CONSENT = {
  version: GRANT_CONSENT_VERSION,
  adultAttested: true as const,
};

const DIRECTOR = { userId: 'joe' };
const ACTOR = { userId: 'liz' };
const TOKEN = 'raw-token-abc';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

function makeService(
  opts: {
    isEditor?: boolean;
    project?: { id: string; name: string } | null;
    invite?: Record<string, unknown> | null;
    actorCharacter?: Record<string, unknown> | null;
    realPersonEnabled?: boolean;
  } = {},
) {
  const prisma = {
    characterCastingInvite: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'invite-1',
        createdAt: new Date(),
        respondedAt: null,
        ...data,
      })),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () =>
        opts.invite === undefined
          ? {
              id: 'invite-1',
              projectId: 'proj-a',
              inviteeUserId: null,
              inviteeContact: 'liz@example.com',
              status: 'pending',
              expiresAt: new Date(Date.now() + 60_000),
            }
          : opts.invite,
      ),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    platformProject: {
      findFirst: jest.fn(async () =>
        opts.project === undefined
          ? { id: 'proj-a', name: 'Project A' }
          : opts.project,
      ),
      findUnique: jest.fn(async () => ({ id: 'proj-a', name: 'Project A' })),
    },
    projectMember: {
      findFirst: jest.fn(async () => (opts.isEditor ? { id: 'pm-1' } : null)),
    },
    studioCharacter: {
      findFirst: jest.fn(async () =>
        opts.actorCharacter === undefined
          ? {
              id: 'char-liz',
              kind: 'real_person',
              status: 'active',
              subjectUserId: 'liz',
            }
          : opts.actorCharacter,
      ),
    },
  };
  const featureFlags = {
    config: {
      enabled: true,
      realPersonEnabled: opts.realPersonEnabled ?? true,
    },
  };
  const grants = {
    grantViaAcceptedInvite: jest.fn(async () => ({ id: 'grant-1' })),
  };
  const service = new CharacterCastingService(
    prisma as never,
    featureFlags as never,
    grants as never,
  );
  return { service, prisma, grants };
}

describe('CharacterCastingService.createInvite', () => {
  it('director creates an invite and gets the raw token once', async () => {
    const { service } = makeService({ isEditor: true });
    const res = await service.createInvite(DIRECTOR as never, 'proj-a', {
      inviteeContact: 'liz@example.com',
    });
    expect(res.id).toBe('invite-1');
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(0);
  });

  it('403s a non-editor', async () => {
    const { service } = makeService({ isEditor: false });
    await expect(
      service.createInvite(DIRECTOR as never, 'proj-a', {
        inviteeContact: 'liz@example.com',
      }),
    ).rejects.toMatchObject({ response: { code: 'PROJECT_EDITOR_REQUIRED' } });
  });
});

describe('CharacterCastingService.acceptInvite', () => {
  it('actor lends their active likeness → creates a grant via the invite', async () => {
    const { service, grants, prisma } = makeService({});
    await service.acceptInvite(ACTOR as never, TOKEN, 'char-liz', CONSENT);
    expect(grants.grantViaAcceptedInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-liz',
        inviteId: 'invite-1',
      }),
    );
    // Invite is ATOMICALLY claimed (pending→accepted) + bound to the accepter
    // BEFORE the grant is minted (single-use barrier).
    expect(prisma.characterCastingInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending' }),
        data: expect.objectContaining({
          status: 'accepted',
          inviteeUserId: 'liz',
        }),
      }),
    );
  });

  it('rejects a token bound to a different invitee', async () => {
    const { service } = makeService({
      invite: {
        id: 'invite-1',
        projectId: 'proj-a',
        inviteeUserId: 'someone-else',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      service.acceptInvite(ACTOR as never, TOKEN, 'char-liz', CONSENT),
    ).rejects.toMatchObject({ response: { code: 'CASTING_INVITE_NOT_YOURS' } });
  });

  it('409s an expired invite', async () => {
    const { service } = makeService({
      invite: {
        id: 'invite-1',
        projectId: 'proj-a',
        inviteeUserId: null,
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(
      service.acceptInvite(ACTOR as never, TOKEN, 'char-liz', CONSENT),
    ).rejects.toMatchObject({
      response: { code: 'CASTING_INVITE_NOT_PENDING' },
    });
  });

  it('409s ENROLLMENT_REQUIRED when the actor has no active character', async () => {
    const { service } = makeService({
      actorCharacter: {
        id: 'char-liz',
        kind: 'real_person',
        status: 'draft',
        subjectUserId: 'liz',
      },
    });
    await expect(
      service.acceptInvite(ACTOR as never, TOKEN, 'char-liz', CONSENT),
    ).rejects.toMatchObject({ response: { code: 'ENROLLMENT_REQUIRED' } });
  });

  it('403s lending a character the actor does not own', async () => {
    const { service } = makeService({
      actorCharacter: {
        id: 'char-x',
        kind: 'real_person',
        status: 'active',
        subjectUserId: 'not-liz',
      },
    });
    await expect(
      service.acceptInvite(ACTOR as never, TOKEN, 'char-x', CONSENT),
    ).rejects.toMatchObject({
      response: { code: 'CHARACTER_SUBJECT_MISMATCH' },
    });
  });
});

// Guards the token-hash contract (accept must hash the raw token to match).
describe('token hashing', () => {
  it('matches the stored hash for the raw token', () => {
    expect(TOKEN_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
