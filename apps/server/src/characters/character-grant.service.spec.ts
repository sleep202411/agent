import { CharacterGrantService } from './character-grant.service';
import { GRANT_CONSENT_VERSION } from './consent';

const CONSENT = {
  version: GRANT_CONSENT_VERSION,
  adultAttested: true as const,
};

const SUBJECT = { userId: 'liz' };
const CHARACTER = {
  id: 'char-1',
  kind: 'real_person',
  status: 'active',
  subjectUserId: 'liz',
};

function makeService(
  opts: {
    character?: Record<string, unknown> | null;
    project?: { id: string; name: string } | null;
    isEditor?: boolean;
    existingGrant?: Record<string, unknown> | null;
    activeGrantsForCharacter?: Array<{ id: string; projectId: string }>;
    realPersonEnabled?: boolean;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    characterConsentRecord: {
      create: jest.fn(() => Promise.resolve({ id: 'consent-1' })),
    },
    characterProjectGrant: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'grant-1',
          status: 'active',
          createdAt: new Date('2026-07-02T00:00:00Z'),
          revokedAt: null,
          ...data,
        }),
      ),
      findMany: jest.fn(() =>
        Promise.resolve(opts.activeGrantsForCharacter ?? []),
      ),
      findFirst: jest.fn(() =>
        Promise.resolve(
          opts.existingGrant ??
            (opts.activeGrantsForCharacter ?? [])[0] ??
            null,
        ),
      ),
      update: jest.fn(() => Promise.resolve({})),
    },
  };
  const prisma = {
    studioCharacter: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          opts.character === undefined ? CHARACTER : opts.character,
        ),
      ),
    },
    platformProject: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          opts.project === undefined
            ? { id: 'proj-a', name: 'Project A' }
            : opts.project,
        ),
      ),
    },
    projectMember: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts.isEditor ? { id: 'pm-1' } : null),
      ),
    },
    characterProjectGrant: {
      findFirst: jest.fn(() => Promise.resolve(opts.existingGrant ?? null)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) =>
      Promise.resolve().then(() => fn(tx)),
    ),
  };
  Object.assign(tx, {
    studioCharacter: prisma.studioCharacter,
    platformProject: prisma.platformProject,
    projectMember: prisma.projectMember,
  });
  const featureFlags = {
    config: {
      enabled: true,
      realPersonEnabled: opts.realPersonEnabled ?? true,
    },
  };
  const jobCanceller = {
    cancelJobsForCharacter: jest.fn(() => Promise.resolve(0)),
  };
  const likenessOutputs = {
    listForCharacter: jest.fn(() => Promise.resolve([])),
    takedownForCharacter: jest.fn(() => Promise.resolve(0)),
  };
  // The service resolves both ports lazily via ModuleRef.get(token); route by
  // the token's description so each getter gets the right stub.
  const moduleRef = {
    get: jest.fn((token: symbol) =>
      String(token).includes('OUTPUTS') ? likenessOutputs : jobCanceller,
    ),
  };
  const service = new CharacterGrantService(
    prisma as never,
    featureFlags as never,
    moduleRef as never,
  );
  return { service, prisma, tx, jobCanceller, likenessOutputs };
}

describe('CharacterGrantService.grantProject', () => {
  it('creates a grant + a scoped consent record for the project editor subject', async () => {
    const { service, tx } = makeService({ isEditor: true });
    const dto = await service.grantProject(
      SUBJECT as never,
      'char-1',
      'proj-a',
      CONSENT,
    );
    expect(dto.projectId).toBe('proj-a');
    expect(dto.status).toBe('active');
    // A fresh scoped consent record anchors the grant.
    expect(tx.characterConsentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'consent_granted',
          scopeProjectId: 'proj-a',
        }) as unknown,
      }),
    );
  });

  it('is idempotent — returns an existing active grant without a new consent', async () => {
    const { service, tx } = makeService({
      isEditor: true,
      existingGrant: {
        id: 'grant-existing',
        projectId: 'proj-a',
        status: 'active',
        createdAt: new Date(),
        revokedAt: null,
      },
    });
    await service.grantProject(SUBJECT as never, 'char-1', 'proj-a', CONSENT);
    expect(tx.characterConsentRecord.create).not.toHaveBeenCalled();
  });

  it('403s a subject who is not a project editor', async () => {
    const { service } = makeService({ isEditor: false });
    await expect(
      service.grantProject(SUBJECT as never, 'char-1', 'proj-a', CONSENT),
    ).rejects.toMatchObject({ response: { code: 'PROJECT_EDITOR_REQUIRED' } });
  });

  it('403s a caller who is not the subject', async () => {
    const { service } = makeService({ isEditor: true });
    await expect(
      service.grantProject(
        { userId: 'not-liz' } as never,
        'char-1',
        'proj-a',
        CONSENT,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CHARACTER_SUBJECT_MISMATCH' },
    });
  });

  it('404s an unknown / non-active project', async () => {
    const { service } = makeService({ isEditor: true, project: null });
    await expect(
      service.grantProject(SUBJECT as never, 'char-1', 'proj-gone', CONSENT),
    ).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_FOUND' } });
  });
});

describe('CharacterGrantService.revokeProjectGrant', () => {
  it('flips the grant, appends a scoped revocation, and cancels project jobs', async () => {
    const { service, tx, jobCanceller } = makeService({
      activeGrantsForCharacter: [{ id: 'grant-1', projectId: 'proj-a' }],
    });
    await service.revokeProjectGrant(SUBJECT as never, 'char-1', 'proj-a');
    expect(tx.characterProjectGrant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'revoked' }) as unknown,
      }),
    );
    expect(tx.characterConsentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'revocation',
          scopeProjectId: 'proj-a',
        }) as unknown,
      }),
    );
    // Prompt cleanup — scoped to the project.
    expect(jobCanceller.cancelJobsForCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', projectId: 'proj-a' }),
    );
  });

  it('is idempotent when there is no active grant (no cancel, no throw)', async () => {
    const { service, tx } = makeService({ activeGrantsForCharacter: [] });
    await service.revokeProjectGrant(SUBJECT as never, 'char-1', 'proj-a');
    expect(tx.characterProjectGrant.update).not.toHaveBeenCalled();
  });
});

describe('CharacterGrantService likeness outputs (§6)', () => {
  it('lists outputs only for the owning subject', async () => {
    const { service, likenessOutputs } = makeService({});
    await service.listLikenessOutputs(SUBJECT as never, 'char-1', 'proj-a');
    expect(likenessOutputs.listForCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', projectId: 'proj-a' }),
    );
  });

  it("403s a non-subject listing another person's likeness outputs", async () => {
    const { service } = makeService({});
    await expect(
      service.listLikenessOutputs({ userId: 'intruder' } as never, 'char-1'),
    ).rejects.toMatchObject({
      response: { code: 'CHARACTER_SUBJECT_MISMATCH' },
    });
  });

  it("takes down the subject's likeness outputs and reports the count", async () => {
    const { service, likenessOutputs } = makeService({});
    likenessOutputs.takedownForCharacter.mockResolvedValueOnce(3);
    const res = await service.takedownLikenessOutputs(
      SUBJECT as never,
      'char-1',
      {
        projectId: 'proj-a',
      },
    );
    expect(res.blocked).toBe(3);
    expect(likenessOutputs.takedownForCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', byUserId: 'liz' }),
    );
  });
});
