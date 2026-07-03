import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CharacterKind,
  CharacterMediaStatus,
  CharacterStatus,
  MediaAssetKind,
} from '@prisma/client';
import type { AiObjectSchema } from '@repo/shared';
import {
  CharacterGenerationService,
  referenceSchemaFromModelInput,
  type CharacterReferenceSchemaByKind,
} from './character-generation.service';

const USER = { userId: 'caller-1' };
const WORKSPACE_ID = 'ws-1';

function mediaRow(
  id: string,
  mediaAssetId: string,
  mediaKind: MediaAssetKind,
  sortOrder: number,
  externalAssets: Array<Record<string, unknown>> = [],
) {
  return {
    id,
    characterId: 'char-1',
    mediaAssetId,
    mediaKind,
    sortOrder,
    status: CharacterMediaStatus.active,
    externalAssets,
    mediaAsset: {
      id: mediaAssetId,
      storageProvider: 'azure_blob',
      bucket: 'media',
      region: 'southeastasia',
      objectKey: `${mediaAssetId}.bin`,
      externalUrl: null,
      status: 'ready',
      moderationStatus: 'approved',
      deletedAt: null,
    },
  };
}

function characterFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char-1',
    workspaceId: WORKSPACE_ID,
    kind: CharacterKind.virtual,
    name: 'Hero',
    status: CharacterStatus.active,
    deletedAt: null,
    media: [
      mediaRow('cm-1', 'asset-img-1', MediaAssetKind.image, 0),
      mediaRow('cm-2', 'asset-img-2', MediaAssetKind.image, 1),
      mediaRow('cm-3', 'asset-aud-1', MediaAssetKind.audio, 2),
    ],
    ...overrides,
  };
}

interface PrismaMockOptions {
  characters?: Array<Record<string, unknown>>;
  workspaceMember?: { id: string } | null;
  castRows?: Array<{ characterId: string }>;
  realPersonEnabled?: boolean;
  /** v2: caller is an explicit ProjectMember editor+ of the job's project. */
  projectMemberEditor?: boolean;
  /** v2: character ids with an active per-project grant for the job's project. */
  grantedCharacterIds?: string[];
}

function makeService(options: PrismaMockOptions = {}) {
  const prisma = {
    studioCharacter: {
      findMany: jest
        .fn()
        .mockResolvedValue(options.characters ?? [characterFixture()]),
    },
    workspaceMember: {
      findFirst: jest
        .fn<Promise<{ id: string } | null>, [unknown]>()
        .mockResolvedValue(
          options.workspaceMember === undefined
            ? { id: 'member-1' }
            : options.workspaceMember,
        ),
    },
    characterProjectCast: {
      findMany: jest.fn().mockResolvedValue(options.castRows ?? []),
    },
    projectMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.projectMemberEditor ? { id: 'pm-1' } : null),
    },
    characterProjectGrant: {
      findMany: jest.fn().mockResolvedValue(
        (options.grantedCharacterIds ?? []).map((characterId) => ({
          characterId,
        })),
      ),
    },
  };
  const urls = {
    resolvePublicUrl: jest.fn(
      (asset: { id: string }) => `https://cdn.example.com/${asset.id}`,
    ),
  };
  const featureFlags = {
    config: {
      enabled: true,
      realPersonEnabled: options.realPersonEnabled ?? false,
    },
  };
  const service = new CharacterGenerationService(
    prisma as never,
    urls as never,
    featureFlags as never,
  );
  return { service, prisma };
}

const FULL_SCHEMA: CharacterReferenceSchemaByKind = {
  image: { maxItems: null },
  video: { maxItems: null },
  audio: { maxItems: null },
};

function characterBinding(refId = 'ref-1', characterId = 'char-1') {
  return { refId, role: 'character', characterId };
}

describe('CharacterGenerationService expansion authz', () => {
  it('expands for an active workspace member', async () => {
    const { service, prisma } = makeService();
    const result = await service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      referenceSchema: FULL_SCHEMA,
      bindings: [characterBinding()],
      input: {},
    });
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0].mediaAssetIds).toEqual([
      'asset-img-1',
      'asset-img-2',
      'asset-aud-1',
    ]);
    const memberQuery = prisma.workspaceMember.findFirst.mock.calls[0]?.[0] as {
      where?: Record<string, unknown>;
    };
    expect(memberQuery?.where).toMatchObject({
      workspaceId: WORKSPACE_ID,
      userId: USER.userId,
      removedAt: null,
    });
  });

  it('denies a non-member with no project cast (raw character id is not enough)', async () => {
    const { service } = makeService({ workspaceMember: null });
    const attempt = service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      referenceSchema: FULL_SCHEMA,
      bindings: [characterBinding()],
      input: {},
    });
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: 'CHARACTER_ACCESS_DENIED' },
    });
  });

  it('allows a project-only member when every character is cast into the job project', async () => {
    const { service, prisma } = makeService({
      workspaceMember: null,
      castRows: [{ characterId: 'char-1' }],
    });
    const result = await service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      projectId: 'proj-1',
      referenceSchema: FULL_SCHEMA,
      bindings: [characterBinding()],
      input: {},
    });
    expect(result.expansions).toHaveLength(1);
    expect(prisma.characterProjectCast.findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', characterId: { in: ['char-1'] } },
      select: { characterId: true },
    });
  });

  it('denies a project-only member when the character is not in the cast', async () => {
    const { service } = makeService({ workspaceMember: null, castRows: [] });
    await expect(
      service.expandCharacterBindings({
        user: USER,
        workspaceId: WORKSPACE_ID,
        projectId: 'proj-1',
        referenceSchema: FULL_SCHEMA,
        bindings: [characterBinding()],
        input: {},
      }),
    ).rejects.toMatchObject({
      response: { code: 'CHARACTER_ACCESS_DENIED' },
    });
  });
});

describe('CharacterGenerationService schema-aware expansion', () => {
  it('rejects character bindings when the model declares no reference fields', async () => {
    const { service } = makeService();
    const attempt = service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      referenceSchema: {},
      bindings: [characterBinding()],
      input: {},
    });
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: 'CHARACTER_REFERENCES_UNSUPPORTED' },
    });
  });

  it('drops member kinds the schema does not declare and records them', async () => {
    const { service } = makeService();
    const result = await service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      referenceSchema: { image: { maxItems: null } },
      bindings: [characterBinding()],
      input: {},
    });
    expect(result.expansions[0].mediaAssetIds).toEqual([
      'asset-img-1',
      'asset-img-2',
    ]);
    expect(result.expansions[0].dropped).toEqual([
      {
        mediaAssetId: 'asset-aud-1',
        kind: 'audio',
        reason: 'kind_unsupported',
      },
    ]);
    expect(result.input.referenceAudios).toBeUndefined();
    expect(result.bindings).toHaveLength(2);
  });

  it('truncates by sortOrder to fit maxItems, counting existing input entries first', async () => {
    const { service } = makeService();
    const result = await service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      referenceSchema: {
        image: { maxItems: 2 },
        audio: { maxItems: null },
      },
      bindings: [characterBinding()],
      input: {
        referenceImages: [{ url: 'https://cdn.example.com/manual-upload' }],
      },
    });
    // 1 existing entry + maxItems 2 → only the first image (by sortOrder) fits.
    expect(result.expansions[0].mediaAssetIds).toEqual([
      'asset-img-1',
      'asset-aud-1',
    ]);
    expect(result.expansions[0].dropped).toEqual([
      { mediaAssetId: 'asset-img-2', kind: 'image', reason: 'max_items' },
    ]);
    expect(result.input.referenceImages).toHaveLength(2);
  });

  it('keeps non-character bindings untouched', async () => {
    const { service } = makeService();
    const plain = {
      refId: 'upload-1',
      kind: 'image' as const,
      url: 'https://x',
    };
    const result = await service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      referenceSchema: FULL_SCHEMA,
      bindings: [plain, characterBinding()],
      input: {},
    });
    expect(result.bindings?.[0]).toBe(plain);
  });
});

describe('CharacterGenerationService real_person expansion', () => {
  const ACTIVE_MIRROR = {
    externalAssetId: 'asset-20260222234430-mxpgh',
    status: 'active',
    statusReason: null,
  };

  function realPersonFixture(
    mirror: Record<string, unknown> | null = ACTIVE_MIRROR,
  ) {
    return characterFixture({
      kind: CharacterKind.real_person,
      subjectUserId: USER.userId,
      media: [
        mediaRow('cm-1', 'asset-img-1', MediaAssetKind.image, 0, [
          ...(mirror ? [mirror] : []),
        ]),
      ],
    });
  }

  it('501s while the real-person flag is off', async () => {
    const { service } = makeService({
      characters: [realPersonFixture()],
      realPersonEnabled: false,
    });
    await expect(
      service.expandCharacterBindings({
        user: USER,
        workspaceId: WORKSPACE_ID,
        referenceSchema: FULL_SCHEMA,
        bindings: [characterBinding()],
        input: {},
      }),
    ).rejects.toMatchObject({
      response: { code: 'REAL_PERSON_NOT_AVAILABLE' },
    });
  });

  it('expands active mirrors to asset:// members and reports the kind', async () => {
    const { service } = makeService({
      characters: [realPersonFixture()],
      realPersonEnabled: true,
    });
    const result = await service.expandCharacterBindings({
      user: USER,
      workspaceId: WORKSPACE_ID,
      referenceSchema: FULL_SCHEMA,
      bindings: [characterBinding()],
      input: {},
    });
    expect(result.characterKinds).toEqual([CharacterKind.real_person]);
    expect(result.input.referenceImages).toEqual([
      expect.objectContaining({
        url: 'asset://asset-20260222234430-mxpgh',
        characterId: 'char-1',
      }),
    ]);
  });

  it('409s CHARACTER_ASSET_NOT_READY before any hold when a mirror is pending', async () => {
    const { service } = makeService({
      characters: [
        realPersonFixture({
          externalAssetId: null,
          status: 'pending',
          statusReason: null,
        }),
      ],
      realPersonEnabled: true,
    });
    await expect(
      service.expandCharacterBindings({
        user: USER,
        workspaceId: WORKSPACE_ID,
        referenceSchema: FULL_SCHEMA,
        bindings: [characterBinding()],
        input: {},
      }),
    ).rejects.toMatchObject({
      response: { code: 'CHARACTER_ASSET_NOT_READY' },
    });
  });

  it('surfaces the upstream verdict when a mirror failed', async () => {
    const { service } = makeService({
      characters: [
        realPersonFixture({
          externalAssetId: 'asset-x',
          status: 'failed',
          statusReason: 'face_mismatch',
        }),
      ],
      realPersonEnabled: true,
    });
    await expect(
      service.expandCharacterBindings({
        user: USER,
        workspaceId: WORKSPACE_ID,
        referenceSchema: FULL_SCHEMA,
        bindings: [characterBinding()],
        input: {},
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CHARACTER_ASSET_NOT_READY',
        message: expect.stringContaining('face_mismatch'),
      },
    });
  });

  /** A real_person owned by someone else (used via the grant path). */
  function othersRealPerson() {
    return characterFixture({
      kind: CharacterKind.real_person,
      subjectUserId: 'liz',
      workspaceId: 'ws-liz-personal',
      media: [
        mediaRow('cm-1', 'asset-img-1', MediaAssetKind.image, 0, [
          ACTIVE_MIRROR,
        ]),
      ],
    });
  }

  it('403s a non-subject with no project context (self-use fails, no grant)', async () => {
    const { service } = makeService({
      characters: [othersRealPerson()],
      realPersonEnabled: true,
    });
    await expect(
      service.expandCharacterBindings({
        user: USER, // not the subject (liz)
        workspaceId: WORKSPACE_ID,
        referenceSchema: FULL_SCHEMA,
        bindings: [characterBinding()],
        input: {}, // no projectId
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("⟦v2⟧ a granted project editor CAN use another person's likeness", async () => {
    const { service } = makeService({
      characters: [othersRealPerson()],
      realPersonEnabled: true,
      projectMemberEditor: true,
      grantedCharacterIds: ['char-1'],
    });
    const result = await service.expandCharacterBindings({
      user: USER, // director/editor, not liz
      workspaceId: 'ws-team',
      projectId: 'proj-a',
      referenceSchema: FULL_SCHEMA,
      bindings: [characterBinding()],
      input: {},
    });
    expect(result.input.referenceImages).toEqual([
      expect.objectContaining({ url: 'asset://asset-20260222234430-mxpgh' }),
    ]);
  });

  it('⟦v2⟧ 403s a project editor when the character is NOT granted to the project', async () => {
    const { service } = makeService({
      characters: [othersRealPerson()],
      realPersonEnabled: true,
      projectMemberEditor: true,
      grantedCharacterIds: [], // no grant
    });
    await expect(
      service.expandCharacterBindings({
        user: USER,
        workspaceId: 'ws-team',
        projectId: 'proj-a',
        referenceSchema: FULL_SCHEMA,
        bindings: [characterBinding()],
        input: {},
      }),
    ).rejects.toMatchObject({
      response: { code: 'CHARACTER_NOT_AUTHORIZED_FOR_PROJECT' },
    });
  });

  it('⟦v2⟧ 403s a granted user who is NOT a project editor', async () => {
    const { service } = makeService({
      characters: [othersRealPerson()],
      realPersonEnabled: true,
      projectMemberEditor: false, // not an editor
      grantedCharacterIds: ['char-1'],
    });
    await expect(
      service.expandCharacterBindings({
        user: USER,
        workspaceId: 'ws-team',
        projectId: 'proj-a',
        referenceSchema: FULL_SCHEMA,
        bindings: [characterBinding()],
        input: {},
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('referenceSchemaFromModelInput', () => {
  it('derives declared kinds and maxItems from the input schema', () => {
    const schema: AiObjectSchema = {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 4,
        },
        referenceAudios: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(referenceSchemaFromModelInput(schema)).toEqual({
      image: { maxItems: 4 },
      audio: { maxItems: null },
    });
  });

  it('returns an empty record when no reference fields are declared', () => {
    const schema: AiObjectSchema = {
      type: 'object',
      properties: { prompt: { type: 'string' } },
    };
    expect(referenceSchemaFromModelInput(schema)).toEqual({});
  });
});
