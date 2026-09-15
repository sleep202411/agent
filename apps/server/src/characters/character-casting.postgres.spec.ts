import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { MediaAssetProviderSyncService } from '../ai-generation/providers/byteplus/assets/media-asset-provider-sync.service';
import { CharacterProviderSyncService } from '../ai-generation/providers/byteplus/assets/character-provider-sync.service';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CharacterCastingService } from './character-casting.service';
import { REAL_PERSON_PROVIDER } from './character-generation.service';
import { CharacterEnrollmentService } from './character-enrollment.service';
import { encryptEnrollmentToken } from './consent';
import { CharactersService } from './characters.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { CharacterGrantService } from './character-grant.service';
import { GRANT_CONSENT_VERSION } from './consent';
const url =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const suite = url ? describe : describe.skip;
suite(
  'Character authorization and mutation transactions (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      workspaceId: string,
      projectId: string,
      characterId: string,
      inviteId: string,
      actor: string,
      token: string;
    let assets: string[];
    const consent = {
      version: GRANT_CONSENT_VERSION,
      adultAttested: true as const,
    };
    const flags = { config: { enabled: true, realPersonEnabled: true } };
    const grants = () =>
      new CharacterGrantService(
        db as never,
        flags as never,
        {
          get: () => ({ cancelJobsForCharacter: () => Promise.resolve(0) }),
        } as never,
      );
    const service = (grantService = grants()) =>
      new CharacterCastingService(db as never, flags as never, grantService);
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw new Error('Owned fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url,
          options: '-c timezone=UTC',
        }),
      });
      await db.$connect();
    });
    beforeEach(async () => {
      assets = [];
      workspaceId = randomUUID();
      projectId = randomUUID();
      characterId = randomUUID();
      inviteId = randomUUID();
      actor = randomUUID();
      token = randomUUID();
      await db.workspace.create({
        data: {
          id: workspaceId,
          name: 'Casting fixture',
          ownerUserId: actor,
          createdById: actor,
        },
      });
      await db.platformProject.create({
        data: {
          id: projectId,
          workspaceId,
          name: 'Casting fixture',
          createdById: actor,
        },
      });
      await db.studioCharacter.create({
        data: {
          id: characterId,
          workspaceId,
          name: 'Actor',
          kind: 'real_person',
          status: 'active',
          createdByUserId: actor,
          subjectUserId: actor,
        },
      });
      await db.characterCastingInvite.create({
        data: {
          id: inviteId,
          projectId,
          invitedByUserId: actor,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    });
    afterEach(async () => {
      await db.aiEventOutbox.deleteMany({ where: { userId: actor } });
      await db.characterProjectGrant.deleteMany({ where: { characterId } });
      await db.characterConsentRecord.deleteMany({ where: { characterId } });
      await db.workspace.delete({ where: { id: workspaceId } });
      await db.mediaAsset.deleteMany({ where: { id: { in: assets } } });
      await db.aiProviderMediaAssetGroup.deleteMany({
        where: { projectName: workspaceId },
      });
    });
    afterAll(async () => db.$disconnect());
    const accept = (instance = service(), supplied = consent) =>
      instance.acceptInvite(
        { userId: actor } as never,
        token,
        characterId,
        supplied,
      );
    async function empty() {
      expect(
        (
          await db.characterCastingInvite.findUniqueOrThrow({
            where: { id: inviteId },
          })
        ).status,
      ).toBe('pending');
      expect(
        await db.characterProjectGrant.count({ where: { characterId } }),
      ).toBe(0);
      expect(
        await db.characterConsentRecord.count({ where: { characterId } }),
      ).toBe(0);
    }
    it('rolls back invalid consent and permits corrected retry', async () => {
      await expect(
        accept(service(), { ...consent, version: 'stale' }),
      ).rejects.toMatchObject({ response: { code: 'CONSENT_REQUIRED' } });
      await empty();
      await accept();
      expect(
        await db.characterProjectGrant.count({ where: { characterId } }),
      ).toBe(1);
    });
    it('rolls back a failure after grant/consent persistence and retries without duplicates', async () => {
      const real = grants();
      const original = grants();
      jest
        .spyOn(real, 'grantViaAcceptedInvite')
        .mockImplementation(async (args) => {
          await original.grantViaAcceptedInvite(args);
          throw new Error('after persistence');
        });
      await expect(accept(service(real))).rejects.toThrow('after persistence');
      await empty();
      await accept();
      expect(
        await db.characterConsentRecord.count({ where: { characterId } }),
      ).toBe(1);
    });
    it('allows only one concurrent token acceptance', async () => {
      const results = await Promise.allSettled([accept(), accept()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await db.characterProjectGrant.count({ where: { characterId } }),
      ).toBe(1);
      expect(
        await db.characterConsentRecord.count({ where: { characterId } }),
      ).toBe(1);
    });
    async function withCharacterLock(
      run: (release: () => void, tx: Prisma.TransactionClient) => Promise<void>,
      projectLock = false,
      assetLock?: string,
    ) {
      let heldTx!: Prisma.TransactionClient;
      let locked!: () => void, release!: () => void;
      const entered = new Promise<void>((r) => {
        locked = r;
      });
      const held = new Promise<void>((r) => {
        release = r;
      });
      const blocker = db.$transaction(
        async (tx) => {
          if (assetLock)
            await tx.$queryRaw`SELECT id FROM media_assets WHERE id=${assetLock}::uuid FOR UPDATE`;
          else if (projectLock)
            await tx.$queryRaw`SELECT id FROM platform_projects WHERE id=${projectId}::uuid FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT id FROM studio_characters WHERE id=${characterId}::uuid FOR UPDATE`;
          heldTx = tx;
          locked();
          await held;
        },
        { timeout: 10000 },
      );
      await entered;
      try {
        await run(release, heldTx);
      } finally {
        release();
        await blocker;
      }
    }
    async function waitForLock(table = 'studio_characters') {
      for (let i = 0; i < 200; i++) {
        const rows = await db.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE ${'%SELECT id FROM ' + table + '%'}`;
        if (Number(rows[0].count) > 0) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('Acceptance did not reach character lock');
    }
    it('rechecks expiry after a character-lock wait without consuming the token', async () => {
      const expiresAt = new Date(Date.now() + 1000);
      await db.characterCastingInvite.update({
        where: { id: inviteId },
        data: { expiresAt },
      });
      await withCharacterLock(async (release) => {
        const pending = accept();
        const result = pending.then(
          () => null,
          (error) => error as Error,
        );
        await waitForLock();
        await new Promise((r) =>
          setTimeout(r, Math.max(0, expiresAt.getTime() - Date.now() + 30)),
        );
        release();
        expect(await result).toMatchObject({
          response: { code: 'CASTING_INVITE_NOT_PENDING' },
        });
      });
      await empty();
    });
    it('rechecks a likeness revoked during the character-lock wait', async () => {
      await withCharacterLock(async (release, tx) => {
        const pending = accept().then(
          () => null,
          (error) => error as Error,
        );
        await waitForLock();
        await tx.studioCharacter.update({
          where: { id: characterId },
          data: { status: 'revoked', revokedAt: new Date() },
        });
        release();
        expect(await pending).toMatchObject({
          response: { code: 'ENROLLMENT_REQUIRED' },
        });
      });
      await empty();
    });
    async function editor() {
      await db.projectMember.create({
        data: {
          projectId,
          userId: actor,
          grantedById: actor,
          role: 'editor',
          status: 'active',
        },
      });
    }
    it('rechecks direct-grant permission withdrawn during a character lock wait', async () => {
      await editor();
      await withCharacterLock(async (release, tx) => {
        const pending = grants()
          .grantProject(
            { userId: actor } as never,
            characterId,
            projectId,
            consent,
          )
          .then(
            () => null,
            (error) => error as Error,
          );
        await waitForLock();
        await tx.projectMember.updateMany({
          where: { projectId, userId: actor },
          data: { role: 'viewer' },
        });
        release();
        expect(await pending).toMatchObject({
          response: { code: 'PROJECT_EDITOR_REQUIRED' },
        });
      });
      await empty();
    });
    it('serializes direct grants without duplicate consent', async () => {
      await editor();
      const instance = grants();
      const results = await Promise.all([
        instance.grantProject(
          { userId: actor } as never,
          characterId,
          projectId,
          consent,
        ),
        instance.grantProject(
          { userId: actor } as never,
          characterId,
          projectId,
          consent,
        ),
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect(
        await db.characterConsentRecord.count({ where: { characterId } }),
      ).toBe(1);
    });
    it('records a single revocation for concurrent withdrawals', async () => {
      await accept();
      const instance = grants();
      await Promise.all([
        instance.revokeProjectGrant(
          { userId: actor } as never,
          characterId,
          projectId,
        ),
        instance.revokeProjectGrant(
          { userId: actor } as never,
          characterId,
          projectId,
        ),
      ]);
      expect(
        await db.characterConsentRecord.count({
          where: { characterId, type: 'revocation' },
        }),
      ).toBe(1);
      expect(
        await db.characterProjectGrant.count({
          where: { characterId, status: 'active' },
        }),
      ).toBe(0);
    });
    it.each(['create', 'revoke'])(
      'rejects invitation %s after editor permission is withdrawn during a project wait',
      async (action) => {
        await editor();
        await withCharacterLock(async (release, tx) => {
          const instance = service();
          const pending = (
            action === 'create'
              ? instance.createInvite({ userId: actor } as never, projectId, {
                  inviteeUserId: actor,
                })
              : instance.revokeInvite(
                  { userId: actor } as never,
                  projectId,
                  inviteId,
                )
          ).then(
            () => null,
            (error) => error as Error,
          );
          await waitForLock('platform_projects');
          await tx.projectMember.updateMany({
            where: { projectId, userId: actor },
            data: { role: 'viewer' },
          });
          release();
          expect(await pending).toMatchObject({
            response: { code: 'PROJECT_EDITOR_REQUIRED' },
          });
        }, true);
        await empty();
        expect(
          await db.characterCastingInvite.count({ where: { projectId } }),
        ).toBe(1);
      },
    );
    it('serializes invitation revocation with acceptance without leaving an unmatched grant', async () => {
      await editor();
      await Promise.allSettled([
        accept(),
        service().revokeInvite({ userId: actor } as never, projectId, inviteId),
      ]);
      const invite = await db.characterCastingInvite.findUniqueOrThrow({
        where: { id: inviteId },
      });
      expect(['accepted', 'revoked']).toContain(invite.status);
      expect(
        await db.characterProjectGrant.count({ where: { characterId } }),
      ).toBe(invite.status === 'accepted' ? 1 : 0);
    });
    const library = (
      enqueueCriticalTeardown: (args: {
        externalAssetIds: string[];
        externalGroupIds: string[];
      }) => Promise<void> = () => Promise.resolve(),
    ) =>
      new CharactersService(
        db as never,
        new WorkspacePermissionService(db as never),
        flags as never,
        {} as never,
        {
          ensureAigcGroup: () => Promise.resolve(null),
          enqueueCriticalTeardown,
        } as never,
      );
    async function workspaceEditor() {
      await db.workspaceMember.create({
        data: { workspaceId, userId: actor, role: 'editor', status: 'active' },
      });
    }
    async function asset() {
      const id = randomUUID();
      assets.push(id);
      return db.mediaAsset.create({
        data: {
          id,
          workspaceId,
          kind: 'image',
          createdByUserId: actor,
          storageProvider: 'external_url',
          externalUrl: `https://example.com/fixture-${id}.png`,
          contentType: 'image/png',
        },
      });
    }
    it.each(['metadata', 'order'])(
      'rejects %s after workspace permission is withdrawn during a row wait',
      async (action) => {
        await workspaceEditor();
        await withCharacterLock(async (release, tx) => {
          const instance = library();
          const pending = (
            action === 'metadata'
              ? instance.update({ userId: actor } as never, characterId, {
                  name: 'Changed',
                })
              : instance.reorderMedia({ userId: actor } as never, characterId, {
                  order: [],
                })
          ).then(
            () => null,
            (error) => error as Error,
          );
          await waitForLock();
          await tx.workspaceMember.updateMany({
            where: { workspaceId, userId: actor },
            data: { role: 'viewer' },
          });
          release();
          expect(await pending).toMatchObject({
            response: { code: 'WORKSPACE_PERMISSION_DENIED' },
          });
        });
        expect(
          (
            await db.studioCharacter.findUniqueOrThrow({
              where: { id: characterId },
            })
          ).name,
        ).toBe('Actor');
      },
    );
    it('rejects a cover removed while the update waits', async () => {
      await workspaceEditor();
      const image = await asset();
      const media = await db.characterMedia.create({
        data: { characterId, mediaAssetId: image.id, mediaKind: 'image' },
      });
      await withCharacterLock(async (release, tx) => {
        const pending = library()
          .update({ userId: actor } as never, characterId, {
            coverAssetId: image.id,
          })
          .then(
            () => null,
            (error) => error as Error,
          );
        await waitForLock();
        await tx.characterMedia.delete({ where: { id: media.id } });
        release();
        expect(await pending).toMatchObject({
          response: { code: 'CHARACTER_COVER_INVALID' },
        });
      });
      expect(
        (
          await db.studioCharacter.findUniqueOrThrow({
            where: { id: characterId },
          })
        ).coverAssetId,
      ).toBeNull();
    });
    it('revalidates complete media order after a concurrent attachment', async () => {
      await workspaceEditor();
      const image = await asset();
      await withCharacterLock(async (release, tx) => {
        const pending = library()
          .reorderMedia({ userId: actor } as never, characterId, { order: [] })
          .then(
            () => null,
            (error) => error as Error,
          );
        await waitForLock();
        await tx.characterMedia.create({
          data: { characterId, mediaAssetId: image.id, mediaKind: 'image' },
        });
        release();
        expect(await pending).toMatchObject({
          response: { code: 'CHARACTER_MEDIA_ORDER_INVALID' },
        });
      });
    });
    it('preserves permitted metadata and complete-order updates', async () => {
      await workspaceEditor();
      const instance = library();
      const updated = await instance.update(
        { userId: actor } as never,
        characterId,
        { name: 'Changed' },
      );
      expect(updated.name).toBe('Changed');
      const ordered = await instance.reorderMedia(
        { userId: actor } as never,
        characterId,
        { order: [] },
      );
      expect(ordered.id).toBe(characterId);
      expect(ordered.media).toEqual([]);
    });
    it.each(['attach', 'remove'])(
      'rolls back media %s after workspace authority is withdrawn',
      async (action) => {
        await workspaceEditor();
        await db.studioCharacter.update({
          where: { id: characterId },
          data: { kind: 'virtual', subjectUserId: null },
        });
        const image = await asset();
        const media =
          action === 'remove'
            ? await db.characterMedia.create({
                data: {
                  characterId,
                  mediaAssetId: image.id,
                  mediaKind: 'image',
                },
              })
            : null;
        await withCharacterLock(async (release, tx) => {
          const instance = library();
          const pending = (
            action === 'attach'
              ? instance.attachMedia({ userId: actor } as never, characterId, {
                  mediaAssetId: image.id,
                })
              : instance.removeMedia(
                  { userId: actor } as never,
                  characterId,
                  media!.id,
                )
          ).then(
            () => null,
            (error) => error as Error,
          );
          await waitForLock();
          await tx.workspaceMember.updateMany({
            where: { workspaceId, userId: actor },
            data: { role: 'viewer' },
          });
          release();
          expect(await pending).toMatchObject({
            response: { code: 'WORKSPACE_PERMISSION_DENIED' },
          });
        });
        expect(await db.characterMedia.count({ where: { characterId } })).toBe(
          action === 'remove' ? 1 : 0,
        );
      },
    );
    it('preserves a newer cover when an attachment waits', async () => {
      await workspaceEditor();
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'virtual', subjectUserId: null },
      });
      const image = await asset(),
        cover = await asset();
      await withCharacterLock(async (release, tx) => {
        const pending = library().attachMedia(
          { userId: actor } as never,
          characterId,
          { mediaAssetId: image.id },
        );
        await waitForLock();
        await tx.characterMedia.create({
          data: { characterId, mediaAssetId: cover.id, mediaKind: 'image' },
        });
        await tx.studioCharacter.update({
          where: { id: characterId },
          data: { coverAssetId: cover.id },
        });
        release();
        expect((await pending).coverAssetId).toBe(cover.id);
      });
    });
    it.each(['blocked', 'failed', 'owner'])(
      'rejects asset eligibility changed to %s during attachment wait',
      async (change) => {
        await workspaceEditor();
        await db.studioCharacter.update({
          where: { id: characterId },
          data: { kind: 'virtual', subjectUserId: null },
        });
        const image = await asset();
        await withCharacterLock(async (release, tx) => {
          const pending = library()
            .attachMedia({ userId: actor } as never, characterId, {
              mediaAssetId: image.id,
            })
            .then(
              () => null,
              (error) => error as Error,
            );
          await waitForLock();
          await tx.mediaAsset.update({
            where: { id: image.id },
            data:
              change === 'blocked'
                ? { moderationStatus: 'blocked' }
                : change === 'failed'
                  ? { status: 'failed' }
                  : { createdByUserId: 'other-owner' },
          });
          release();
          expect(await pending).toMatchObject({
            response: {
              code:
                change === 'blocked'
                  ? 'MEDIA_ASSET_BLOCKED'
                  : change === 'failed'
                    ? 'MEDIA_ASSET_NOT_READY'
                    : 'MEDIA_ASSET_NOT_OWNED',
            },
          });
        });
        expect(await db.characterMedia.count({ where: { characterId } })).toBe(
          0,
        );
        expect(
          await db.mediaAssetUsage.count({ where: { assetId: image.id } }),
        ).toBe(0);
      },
    );
    it('rejects a real-person group disabled during attachment wait', async () => {
      await workspaceEditor();
      const image = await asset();
      const group = await db.aiProviderAssetGroup.create({
        data: {
          characterId,
          provider: REAL_PERSON_PROVIDER,
          externalGroupId: randomUUID(),
          groupType: 'liveness_face',
          projectName: 'fixture',
          status: 'active',
        },
      });
      await withCharacterLock(async (release, tx) => {
        const pending = library()
          .attachMedia({ userId: actor } as never, characterId, {
            mediaAssetId: image.id,
          })
          .then(
            () => null,
            (error) => error as Error,
          );
        await waitForLock();
        await tx.aiProviderAssetGroup.update({
          where: { id: group.id },
          data: { status: 'disabled' },
        });
        release();
        expect(await pending).toMatchObject({
          response: { code: 'ENROLLMENT_REQUIRED' },
        });
      });
      expect(await db.characterMedia.count({ where: { characterId } })).toBe(0);
    });
    it.each(['cast', 'uncast'])(
      'rejects %s after project authority is withdrawn during a wait',
      async (action) => {
        await workspaceEditor();
        if (action === 'uncast')
          await db.characterProjectCast.create({
            data: { projectId, characterId, addedByUserId: actor },
          });
        await withCharacterLock(async (release, tx) => {
          const instance = library();
          const pending = (
            action === 'cast'
              ? instance.castCharacter(
                  { userId: actor } as never,
                  projectId,
                  characterId,
                )
              : instance.uncastCharacter(
                  { userId: actor } as never,
                  projectId,
                  characterId,
                )
          ).then(
            () => null,
            (error) => error as Error,
          );
          await waitForLock('platform_projects');
          await tx.workspaceMember.updateMany({
            where: { workspaceId, userId: actor },
            data: { role: 'viewer' },
          });
          release();
          expect(await pending).toMatchObject({
            response: { code: 'PROJECT_PERMISSION_DENIED' },
          });
        }, true);
        expect(
          await db.characterProjectCast.count({
            where: { characterId, projectId },
          }),
        ).toBe(action === 'uncast' ? 1 : 0);
      },
    );
    it('keeps concurrent casting and repeated uncasting idempotent', async () => {
      await workspaceEditor();
      const instance = library();
      const rows = await Promise.all([
        instance.castCharacter(
          { userId: actor } as never,
          projectId,
          characterId,
        ),
        instance.castCharacter(
          { userId: actor } as never,
          projectId,
          characterId,
        ),
      ]);
      expect(rows[0].id).toBe(rows[1].id);
      expect(
        await db.characterProjectCast.count({
          where: { characterId, projectId },
        }),
      ).toBe(1);
      await instance.uncastCharacter(
        { userId: actor } as never,
        projectId,
        characterId,
      );
      await instance.uncastCharacter(
        { userId: actor } as never,
        projectId,
        characterId,
      );
      expect(
        await db.characterProjectCast.count({
          where: { characterId, projectId },
        }),
      ).toBe(0);
    });
    it.each(['permission', 'project'])(
      'rejects character creation after %s changes during admission',
      async (change) => {
        await workspaceEditor();
        await withCharacterLock(async (release, tx) => {
          const pending = library()
            .create(
              { userId: actor } as never,
              {
                workspaceId,
                castProjectId: projectId,
                kind: 'virtual',
                name: 'New actor',
              } as never,
            )
            .then(
              () => null,
              (error: unknown) => error,
            );
          await waitForLock('platform_projects');
          if (change === 'permission') {
            await tx.workspaceMember.updateMany({
              where: { workspaceId, userId: actor },
              data: { role: 'viewer' },
            });
          } else {
            await tx.platformProject.update({
              where: { id: projectId },
              data: { deletedAt: new Date() },
            });
          }
          release();
          expect(await pending).toBeInstanceOf(Error);
        }, true);
        expect(
          await db.studioCharacter.count({
            where: { workspaceId, name: 'New actor' },
          }),
        ).toBe(0);
        expect(
          await db.characterProjectCast.count({ where: { projectId } }),
        ).toBe(0);
      },
    );
    it('creates a character and initial cast together with current authority', async () => {
      await workspaceEditor();
      const created = await library().create(
        { userId: actor } as never,
        {
          workspaceId,
          castProjectId: projectId,
          kind: 'virtual',
          name: 'New actor',
        } as never,
      );
      expect(
        await db.characterProjectCast.count({
          where: { projectId, characterId: created.id },
        }),
      ).toBe(1);
    });
    it('rejects deletion when creator editor access is withdrawn during the row wait', async () => {
      await workspaceEditor();
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'virtual' },
      });
      await withCharacterLock(async (release, tx) => {
        const pending = library()
          .remove({ userId: actor } as never, characterId)
          .then(
            () => null,
            (error: unknown) => error,
          );
        await waitForLock();
        await tx.workspaceMember.updateMany({
          where: { workspaceId, userId: actor },
          data: { role: 'viewer' },
        });
        release();
        expect(await pending).toBeInstanceOf(Error);
      });
      expect(
        (
          await db.studioCharacter.findUniqueOrThrow({
            where: { id: characterId },
          })
        ).deletedAt,
      ).toBeNull();
    });
    it('deletion releases media usage committed while it waited', async () => {
      await workspaceEditor();
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'virtual' },
      });
      const image = await asset();
      const idempotencyKey = `character-media:${characterId}:${image.id}`;
      await withCharacterLock(async (release, tx) => {
        const pending = library().remove(
          { userId: actor } as never,
          characterId,
        );
        await waitForLock();
        await tx.characterMedia.create({
          data: { characterId, mediaAssetId: image.id, mediaKind: 'image' },
        });
        await tx.mediaAssetUsage.create({
          data: {
            assetId: image.id,
            userId: actor,
            workspaceId,
            surface: 'ip_library',
            role: 'reference',
            sourceSurface: 'character_library',
            idempotencyKey,
          },
        });
        release();
        await pending;
      });
      expect(
        (
          await db.mediaAssetUsage.findUniqueOrThrow({
            where: { idempotencyKey },
          })
        ).deletedAt,
      ).not.toBeNull();
    });
    const enrollmentKey = Buffer.alloc(32, 7).toString('base64');
    function enrollment(provider: object) {
      return new CharacterEnrollmentService(
        db as never,
        flags as never,
        {
          config: { projectName: 'fixture', enrollmentTokenKey: enrollmentKey },
          enrollmentHardBlocked: () => false,
        } as never,
        provider as never,
        {
          reserveVisualValidateSlot: () => Promise.resolve(true),
        } as never,
        grants(),
      );
    }
    async function pendingEnrollment() {
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { status: 'pending_verification' },
      });
      return db.characterEnrollmentSession.create({
        data: {
          characterId,
          ownerUserId: actor,
          bytedTokenEnc: encryptEnrollmentToken('fixture-token', enrollmentKey),
          status: 'pending',
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    }
    it('does not publish a provider session after consent is revoked during the provider wait', async () => {
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { status: 'draft' },
      });
      const instance = enrollment({
        createVisualValidateSession: async () => {
          await db.studioCharacter.update({
            where: { id: characterId },
            data: { status: 'revoked' },
          });
          return {
            BytedToken: 'fixture-token',
            H5Link: 'https://example.com/fixture',
          };
        },
      });
      await expect(
        instance.createSession({ userId: actor } as never, characterId),
      ).rejects.toThrow();
      expect(
        await db.characterEnrollmentSession.count({ where: { characterId } }),
      ).toBe(0);
      expect(
        (
          await db.studioCharacter.findUniqueOrThrow({
            where: { id: characterId },
          })
        ).status,
      ).toBe('revoked');
    });
    it.each(['revoked', 'superseded', 'expired'])(
      'does not complete a %s enrollment after the provider responds',
      async (change) => {
        const session = await pendingEnrollment();
        const instance = enrollment({
          getVisualValidateResult: async () => {
            if (change === 'revoked')
              await db.studioCharacter.update({
                where: { id: characterId },
                data: { status: 'revoked' },
              });
            else
              await db.characterEnrollmentSession.update({
                where: { id: session.id },
                data:
                  change === 'expired'
                    ? { expiresAt: new Date(Date.now() - 1000) }
                    : { status: 'expired', bytedTokenEnc: null },
              });
            return { GroupId: 'fixture-group' };
          },
        });
        await expect(
          instance.complete({ userId: actor } as never, characterId),
        ).rejects.toThrow();
        expect(
          await db.aiProviderAssetGroup.count({ where: { characterId } }),
        ).toBe(0);
        expect(
          await db.characterConsentRecord.count({ where: { characterId } }),
        ).toBe(0);
        expect(
          (
            await db.studioCharacter.findUniqueOrThrow({
              where: { id: characterId },
            })
          ).status,
        ).not.toBe('active');
      },
    );
    it('records concurrent valid enrollment completion only once', async () => {
      await pendingEnrollment();
      const instance = enrollment({
        getVisualValidateResult: () =>
          Promise.resolve({ GroupId: 'fixture-group' }),
      });
      await Promise.all([
        instance.complete({ userId: actor } as never, characterId),
        instance.complete({ userId: actor } as never, characterId),
      ]);
      expect(
        await db.characterConsentRecord.count({
          where: { characterId, type: 'liveness_verification' },
        }),
      ).toBe(1);
      expect(
        (
          await db.studioCharacter.findUniqueOrThrow({
            where: { id: characterId },
          })
        ).status,
      ).toBe('active');
    });
    it('checks enrollment expiry after waiting for the character row', async () => {
      const session = await pendingEnrollment();
      const instance = enrollment({
        getVisualValidateResult: () =>
          Promise.resolve({ GroupId: 'fixture-group' }),
      });
      await withCharacterLock(async (release, tx) => {
        const pending = instance
          .complete({ userId: actor } as never, characterId)
          .then(
            () => null,
            (error: unknown) => error,
          );
        await waitForLock();
        await tx.characterEnrollmentSession.update({
          where: { id: session.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        release();
        expect(await pending).toBeInstanceOf(Error);
      });
      expect(
        await db.aiProviderAssetGroup.count({ where: { characterId } }),
      ).toBe(0);
      expect(await db.aiEventOutbox.count({ where: { userId: actor } })).toBe(
        0,
      );
    });
    it.each(['workspace', 'receipt'])(
      'rejects a character attachment with a mismatched %s boundary',
      async (boundary) => {
        await workspaceEditor();
        await db.studioCharacter.update({
          where: { id: characterId },
          data: { kind: 'virtual' },
        });
        const image = await asset();
        await db.mediaAsset.update({
          where: { id: image.id },
          data:
            boundary === 'workspace'
              ? { workspaceId: null }
              : { metadata: { uploadKind: 'crew_expense_receipt' } },
        });
        await expect(
          library().attachMedia({ userId: actor } as never, characterId, {
            mediaAssetId: image.id,
          }),
        ).rejects.toThrow();
        expect(await db.characterMedia.count({ where: { characterId } })).toBe(
          0,
        );
      },
    );
    it.each(['workspace', 'receipt'])(
      'rechecks the %s boundary after attachment waits',
      async (boundary) => {
        await workspaceEditor();
        await db.studioCharacter.update({
          where: { id: characterId },
          data: { kind: 'virtual' },
        });
        const image = await asset();
        await withCharacterLock(async (release, tx) => {
          const pending = library()
            .attachMedia({ userId: actor } as never, characterId, {
              mediaAssetId: image.id,
            })
            .then(
              () => null,
              (error: unknown) => error,
            );
          await waitForLock();
          await tx.mediaAsset.update({
            where: { id: image.id },
            data:
              boundary === 'workspace'
                ? { workspaceId: null }
                : { metadata: { uploadKind: 'crew_expense_receipt' } },
          });
          release();
          expect(await pending).toBeInstanceOf(Error);
        });
        expect(await db.characterMedia.count({ where: { characterId } })).toBe(
          0,
        );
        expect(
          await db.mediaAssetUsage.count({ where: { assetId: image.id } }),
        ).toBe(0);
      },
    );
    function providerSync(createAssetGroup: () => Promise<{ Id: string }>) {
      const instance = new CharacterProviderSyncService(
        db as never,
        {
          config: { aigcRegistrationEnabled: true, projectName: 'fixture' },
        } as never,
        { createAssetGroup } as never,
        {} as never,
      );
      const teardown = jest
        .spyOn(instance, 'enqueueCriticalTeardown')
        .mockResolvedValue();
      return { instance, teardown };
    }
    it('discards an AIGC group returned after character deletion', async () => {
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'virtual' },
      });
      const { instance, teardown } = providerSync(async () => {
        await db.studioCharacter.update({
          where: { id: characterId },
          data: { deletedAt: new Date() },
        });
        return { Id: 'orphan-fixture' };
      });
      expect(await instance.ensureAigcGroup(characterId)).toBeNull();
      expect(
        await db.aiProviderAssetGroup.count({ where: { characterId } }),
      ).toBe(0);
      expect(teardown).toHaveBeenCalledWith({
        externalAssetIds: [],
        externalGroupIds: ['orphan-fixture'],
      });
    });
    it('does not reuse a group disabled while provider creation was underway', async () => {
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'virtual' },
      });
      const { instance, teardown } = providerSync(async () => {
        await db.aiProviderAssetGroup.create({
          data: {
            characterId,
            provider: REAL_PERSON_PROVIDER,
            externalGroupId: 'disabled-fixture',
            groupType: 'aigc',
            projectName: 'fixture',
            status: 'disabled',
          },
        });
        return { Id: 'orphan-fixture' };
      });
      expect(await instance.ensureAigcGroup(characterId)).toBeNull();
      expect(teardown).toHaveBeenCalledTimes(1);
      expect(
        (
          await db.aiProviderAssetGroup.findFirstOrThrow({
            where: { characterId },
          })
        ).status,
      ).toBe('disabled');
    });
    it('reuses a valid AIGC group without another provider request', async () => {
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'virtual' },
      });
      const create = jest.fn(() => Promise.resolve({ Id: 'active-fixture' }));
      const { instance, teardown } = providerSync(create);
      const id = await instance.ensureAigcGroup(characterId);
      expect(id).not.toBeNull();
      expect(await instance.ensureAigcGroup(characterId)).toBe(id);
      expect(create).toHaveBeenCalledTimes(1);
      expect(teardown).not.toHaveBeenCalled();
    });
    async function mediaRegistration() {
      const group = await db.aiProviderMediaAssetGroup.create({
        data: {
          provider: REAL_PERSON_PROVIDER,
          externalGroupId: randomUUID(),
          groupType: 'aigc',
          projectName: workspaceId,
          status: 'active',
        },
      });
      const instance = new MediaAssetProviderSyncService(
        db as never,
        {
          config: {
            mediaAssetRegistrationEnabled: true,
            projectName: workspaceId,
          },
        } as never,
        {} as never,
        {} as never,
      );
      const add = jest.fn().mockResolvedValue({});
      Reflect.set(instance, 'assetsQueue', { add });
      return { instance, group, add };
    }
    it('concurrent first registrations create one mirror and enqueue once', async () => {
      const image = await asset();
      const { instance, add } = await mediaRegistration();
      const ids = await Promise.all([
        instance.enqueueAssetRegistration(image.id),
        instance.enqueueAssetRegistration(image.id),
      ]);
      expect(ids[0]).not.toBeNull();
      expect(ids[0]).toBe(ids[1]);
      expect(add).toHaveBeenCalledTimes(1);
      expect(
        await db.aiProviderMediaAssetMirror.count({
          where: { mediaAssetId: image.id },
        }),
      ).toBe(1);
    });
    it.each(['blocked', 'deleted', 'group'])(
      'rejects registration after %s eligibility changes during admission',
      async (change) => {
        const image = await asset();
        const { instance, group, add } = await mediaRegistration();
        await withCharacterLock(
          async (release, tx) => {
            const pending = instance.enqueueAssetRegistration(image.id);
            await waitForLock('media_assets');
            if (change === 'group')
              await tx.aiProviderMediaAssetGroup.update({
                where: { id: group.id },
                data: { status: 'disabled' },
              });
            else
              await tx.mediaAsset.update({
                where: { id: image.id },
                data:
                  change === 'blocked'
                    ? { moderationStatus: 'blocked' }
                    : { deletedAt: new Date() },
              });
            release();
            expect(await pending).toBeNull();
          },
          false,
          image.id,
        );
        expect(add).not.toHaveBeenCalled();
        expect(
          await db.aiProviderMediaAssetMirror.count({
            where: { mediaAssetId: image.id },
          }),
        ).toBe(0);
      },
    );
    it('does not register private expense evidence as provider media', async () => {
      const image = await asset();
      const { instance, add } = await mediaRegistration();
      await db.mediaAsset.update({
        where: { id: image.id },
        data: { metadata: { uploadKind: 'crew_expense_receipt' } },
      });
      await expect(instance.enqueueAssetRegistration(image.id)).rejects.toThrow(
        'expense claim',
      );
      await expect(instance.requestAssetRegistration(image.id)).rejects.toThrow(
        'expense claim',
      );
      expect(add).not.toHaveBeenCalled();
    });
    it.each(['blocked', 'group', 'completed', 'provider-id'])(
      'uses current registration retry state after %s changes during a wait',
      async (change) => {
        const image = await asset();
        const { instance, group, add } = await mediaRegistration();
        const mirror = await db.aiProviderMediaAssetMirror.create({
          data: {
            mediaAssetId: image.id,
            providerAssetGroupId: group.id,
            status: 'failed',
            statusReason: 'fixture-failure',
          },
        });
        await withCharacterLock(
          async (release, tx) => {
            const pending = instance.requestAssetRegistration(image.id);
            await waitForLock('media_assets');
            if (change === 'blocked')
              await tx.mediaAsset.update({
                where: { id: image.id },
                data: { moderationStatus: 'blocked' },
              });
            else if (change === 'group')
              await tx.aiProviderMediaAssetGroup.update({
                where: { id: group.id },
                data: { status: 'disabled' },
              });
            else
              await tx.aiProviderMediaAssetMirror.update({
                where: { id: mirror.id },
                data:
                  change === 'completed'
                    ? { status: 'active' }
                    : { externalAssetId: 'late-provider-id' },
              });
            release();
            const result = await pending;
            if (change === 'blocked' || change === 'group')
              expect(result).toBeNull();
            else
              expect(result?.status).toBe(
                change === 'completed' ? 'active' : 'processing',
              );
          },
          false,
          image.id,
        );
        const current = await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
          where: { id: mirror.id },
        });
        if (change === 'provider-id') {
          expect(current.externalAssetId).toBe('late-provider-id');
          expect(add).toHaveBeenCalledWith(
            'poll',
            expect.any(Object),
            expect.any(Object),
          );
        } else {
          expect(add).not.toHaveBeenCalled();
          expect(current.status).toBe(
            change === 'completed' ? 'active' : 'failed',
          );
          expect(
            await db.aiEventOutbox.count({ where: { userId: actor } }),
          ).toBe(0);
        }
      },
    );
    it.each([false, true])(
      'requests cleanup after character group publication fails (queue failure=%s)',
      async (queueFailure) => {
        await db.studioCharacter.update({
          where: { id: characterId },
          data: { kind: 'virtual' },
        });
        const { instance, teardown } = providerSync(() =>
          Promise.resolve({ Id: 'orphan-after-db-failure' }),
        );
        if (queueFailure)
          teardown.mockRejectedValueOnce(
            new Error('fixture queue unavailable'),
          );
        const failure = new Error('fixture database unavailable');
        const transaction = jest
          .spyOn(db, '$transaction')
          .mockRejectedValueOnce(failure);
        try {
          await expect(instance.ensureAigcGroup(characterId)).rejects.toBe(
            failure,
          );
          expect(teardown).toHaveBeenCalledWith({
            externalAssetIds: [],
            externalGroupIds: ['orphan-after-db-failure'],
          });
        } finally {
          transaction.mockRestore();
        }
      },
    );
    it.each([false, true])(
      'requests cleanup after media group publication fails (queue failure=%s)',
      async (queueFailure) => {
        const image = await asset();
        const addBulk = jest.fn().mockResolvedValue([]);
        if (queueFailure)
          addBulk.mockRejectedValueOnce(new Error('fixture queue unavailable'));
        const instance = new MediaAssetProviderSyncService(
          db as never,
          {
            config: {
              mediaAssetRegistrationEnabled: true,
              projectName: workspaceId,
            },
          } as never,
          {
            createAssetGroup: () =>
              Promise.resolve({ Id: 'orphan-media-group' }),
          } as never,
          {} as never,
        );
        Reflect.set(instance, 'criticalQueue', { addBulk });
        const failure = new Error('fixture database unavailable');
        const upsert = jest
          .spyOn(db.aiProviderMediaAssetGroup, 'upsert')
          .mockRejectedValueOnce(failure);
        try {
          await expect(
            instance.enqueueAssetRegistration(image.id),
          ).rejects.toBe(failure);
          expect(addBulk).toHaveBeenCalledWith([
            expect.objectContaining({
              data: {
                op: 'delete_group',
                externalGroupId: 'orphan-media-group',
              },
            }),
          ]);
          expect(
            await db.aiProviderMediaAssetGroup.count({
              where: { projectName: workspaceId },
            }),
          ).toBe(0);
        } finally {
          upsert.mockRestore();
        }
      },
    );
    async function characterMirror(
      status: 'processing' | 'deleted' = 'processing',
    ) {
      await workspaceEditor();
      await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'virtual' },
      });
      const image = await asset();
      const media = await db.characterMedia.create({
        data: { characterId, mediaAssetId: image.id, mediaKind: 'image' },
      });
      const group = await db.aiProviderAssetGroup.create({
        data: {
          characterId,
          provider: REAL_PERSON_PROVIDER,
          externalGroupId: randomUUID(),
          groupType: 'aigc',
          projectName: 'fixture',
          status: status === 'deleted' ? 'deleted' : 'active',
        },
      });
      const mirror = await db.aiProviderExternalAsset.create({
        data: {
          providerAssetGroupId: group.id,
          characterMediaId: media.id,
          externalAssetId: randomUUID(),
          status,
        },
      });
      return { group, mirror, media };
    }
    it.each([false, true])(
      'disables provider planes on virtual deletion (queue unavailable=%s)',
      async (queueFailure) => {
        const { group, mirror } = await characterMirror();
        const teardown = jest.fn().mockResolvedValue(undefined);
        if (queueFailure)
          teardown.mockRejectedValueOnce(
            new Error('fixture queue unavailable'),
          );
        await expect(
          library(teardown).remove({ userId: actor } as never, characterId),
        ).resolves.toBeUndefined();
        expect(
          (
            await db.aiProviderAssetGroup.findUniqueOrThrow({
              where: { id: group.id },
            })
          ).status,
        ).toBe('disabled');
        expect(
          (
            await db.aiProviderExternalAsset.findUniqueOrThrow({
              where: { id: mirror.id },
            })
          ).status,
        ).toBe('disabled');
        expect(teardown).toHaveBeenCalledWith({
          externalAssetIds: [mirror.externalAssetId],
          externalGroupIds: [group.externalGroupId],
        });
      },
    );
    it('preserves already deleted provider state during character deletion', async () => {
      const { group, mirror } = await characterMirror('deleted');
      const teardown = jest.fn().mockResolvedValue(undefined);
      await library(teardown).remove({ userId: actor } as never, characterId);
      expect(
        (
          await db.aiProviderAssetGroup.findUniqueOrThrow({
            where: { id: group.id },
          })
        ).status,
      ).toBe('deleted');
      expect(
        (
          await db.aiProviderExternalAsset.findUniqueOrThrow({
            where: { id: mirror.id },
          })
        ).status,
      ).toBe('deleted');
      expect(teardown).not.toHaveBeenCalled();
    });
    it('keeps media removal successful and its disabled mirror recoverable when enqueue fails', async () => {
      const { mirror, media } = await characterMirror();
      const teardown = jest
        .fn()
        .mockRejectedValue(new Error('fixture queue unavailable'));
      await expect(
        library(teardown).removeMedia(
          { userId: actor } as never,
          characterId,
          media.id,
        ),
      ).resolves.toBeDefined();
      expect(
        await db.characterMedia.findUnique({ where: { id: media.id } }),
      ).toBeNull();
      const current = await db.aiProviderExternalAsset.findUniqueOrThrow({
        where: { id: mirror.id },
      });
      expect(current.status).toBe('disabled');
      expect(current.externalAssetId).toBe(mirror.externalAssetId);
    });
    it('does not revive an already deleted provider mirror during detachment', async () => {
      const { mirror, media } = await characterMirror('deleted');
      await library().removeMedia(
        { userId: actor } as never,
        characterId,
        media.id,
      );
      expect(
        (
          await db.aiProviderExternalAsset.findUniqueOrThrow({
            where: { id: mirror.id },
          })
        ).status,
      ).toBe('deleted');
    });

    function withdrawal(failQueue = false) {
      const grantService = grants();
      const cancel = jest
        .spyOn(grantService, 'cancelJobsForCharacterAllProjects')
        .mockResolvedValue(undefined);
      const enqueue = jest.fn(() =>
        failQueue
          ? Promise.reject(new Error('queue unavailable'))
          : Promise.resolve(),
      );
      const instance = new CharacterEnrollmentService(
        db as never,
        { config: { enabled: false, realPersonEnabled: false } } as never,
        {} as never,
        {} as never,
        { enqueueCriticalTeardown: enqueue } as never,
        grantService,
      );
      return { instance, cancel, enqueue };
    }
    it('serializes duplicate global withdrawals with one consent event and cancellation', async () => {
      const current = await db.studioCharacter.findUniqueOrThrow({
        where: { id: characterId },
      });
      const { instance, cancel, enqueue } = withdrawal();
      await Promise.all([
        instance.revoke({ userId: actor } as never, current),
        instance.revoke({ userId: actor } as never, current),
      ]);
      expect(
        await db.characterConsentRecord.count({
          where: { characterId, type: 'revocation' },
        }),
      ).toBe(1);
      expect(await db.aiEventOutbox.count({ where: { userId: actor } })).toBe(
        1,
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledTimes(1);
    });
    it('expires pending tokens and still cancels jobs when withdrawal cleanup queuing fails', async () => {
      const session = await pendingEnrollment();
      const current = await db.studioCharacter.findUniqueOrThrow({
        where: { id: characterId },
      });
      const { instance, cancel } = withdrawal(true);
      await expect(
        instance.revoke({ userId: actor } as never, current),
      ).resolves.toBeUndefined();
      expect(
        await db.characterEnrollmentSession.findUniqueOrThrow({
          where: { id: session.id },
        }),
      ).toMatchObject({
        status: 'expired',
        statusReason: 'character_revoked',
        bytedTokenEnc: null,
      });
      expect(
        await db.studioCharacter.findUniqueOrThrow({
          where: { id: characterId },
        }),
      ).toMatchObject({ status: 'revoked' });
      expect(cancel).toHaveBeenCalledWith(characterId, 'character_revoked');
    });
    it('rechecks the current subject after the withdrawal row wait', async () => {
      const current = await db.studioCharacter.findUniqueOrThrow({
        where: { id: characterId },
      });
      const { instance, cancel, enqueue } = withdrawal();
      await withCharacterLock(async (release, tx) => {
        const pending = instance.revoke({ userId: actor } as never, current);
        const assertion = expect(pending).rejects.toMatchObject({
          response: { code: 'CHARACTER_SUBJECT_MISMATCH' },
        });
        await waitForLock();
        await tx.studioCharacter.update({
          where: { id: characterId },
          data: { subjectUserId: randomUUID() },
        });
        release();
        await assertion;
      });
      expect(
        await db.characterConsentRecord.count({ where: { characterId } }),
      ).toBe(0);
      expect(cancel).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('preserves deleted provider records during real-person withdrawal', async () => {
      const { group, mirror } = await characterMirror('deleted');
      const current = await db.studioCharacter.update({
        where: { id: characterId },
        data: { kind: 'real_person', subjectUserId: actor },
      });
      const { instance, enqueue } = withdrawal();
      await instance.revoke({ userId: actor } as never, current);
      expect(
        await db.aiProviderAssetGroup.findUniqueOrThrow({
          where: { id: group.id },
        }),
      ).toMatchObject({ status: 'deleted' });
      expect(
        await db.aiProviderExternalAsset.findUniqueOrThrow({
          where: { id: mirror.id },
        }),
      ).toMatchObject({ status: 'deleted' });
      expect(enqueue).toHaveBeenCalledWith({
        externalAssetIds: [],
        externalGroupIds: [],
      });
    });

    it.each(['character', 'media'] as const)(
      '%s provider results preserve replacement attempts',
      async (kind) => {
        let instance:
          | CharacterProviderSyncService
          | MediaAssetProviderSyncService;
        let snapshot: unknown;
        let id: string;
        if (kind === 'character') {
          const { mirror } = await characterMirror();
          id = mirror.id;
          snapshot = await db.aiProviderExternalAsset.findUniqueOrThrow({
            where: { id },
            include: {
              assetGroup: { include: { character: true } },
              characterMedia: { include: { mediaAsset: true } },
            },
          });
          instance = providerSync(() =>
            Promise.resolve({ Id: 'unused' }),
          ).instance;
          await db.aiProviderExternalAsset.update({
            where: { id },
            data: {
              externalAssetId: 'replacement',
              updatedAt: new Date(Date.now() + 1000),
            },
          });
        } else {
          const image = await asset();
          const fixture = await mediaRegistration();
          instance = fixture.instance;
          const mirror = await db.aiProviderMediaAssetMirror.create({
            data: {
              providerAssetGroupId: fixture.group.id,
              mediaAssetId: image.id,
              status: 'processing',
              externalAssetId: 'original',
            },
          });
          id = mirror.id;
          snapshot = await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
            where: { id },
            include: { assetGroup: true, mediaAsset: true },
          });
          await db.aiProviderMediaAssetMirror.update({
            where: { id },
            data: {
              externalAssetId: 'replacement',
              updatedAt: new Date(Date.now() + 1000),
            },
          });
        }
        const worker = instance as unknown as {
          transition(
            row: unknown,
            status: 'active' | 'failed',
            patch: object,
          ): Promise<void>;
        };
        await worker.transition(snapshot, 'active', {});
        await worker.transition(snapshot, 'failed', {
          statusReason: 'old_failure',
        });
        const current =
          kind === 'character'
            ? await db.aiProviderExternalAsset.findUniqueOrThrow({
                where: { id },
              })
            : await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
                where: { id },
              });
        expect(current).toMatchObject({
          status: 'processing',
          externalAssetId: 'replacement',
          statusReason: null,
        });
        expect(await db.aiEventOutbox.count({ where: { userId: actor } })).toBe(
          0,
        );
        const fresh =
          kind === 'character'
            ? await db.aiProviderExternalAsset.findUniqueOrThrow({
                where: { id },
                include: {
                  assetGroup: { include: { character: true } },
                  characterMedia: { include: { mediaAsset: true } },
                },
              })
            : await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
                where: { id },
                include: { assetGroup: true, mediaAsset: true },
              });
        await worker.transition(fresh, 'active', {});
        expect(await db.aiEventOutbox.count({ where: { userId: actor } })).toBe(
          1,
        );
      },
    );

    it.each(['character', 'media'] as const)(
      '%s discards a created provider asset after the pending attempt is replaced',
      async (kind) => {
        let snapshot: unknown;
        let id: string;
        if (kind === 'character') {
          const { mirror } = await characterMirror();
          id = mirror.id;
          await db.aiProviderExternalAsset.update({
            where: { id },
            data: { status: 'pending', externalAssetId: null },
          });
          snapshot = await db.aiProviderExternalAsset.findUniqueOrThrow({
            where: { id },
            include: {
              assetGroup: { include: { character: true } },
              characterMedia: { include: { mediaAsset: true } },
            },
          });
        } else {
          const image = await asset();
          const { group } = await mediaRegistration();
          const mirror = await db.aiProviderMediaAssetMirror.create({
            data: {
              providerAssetGroupId: group.id,
              mediaAssetId: image.id,
              status: 'pending',
            },
          });
          id = mirror.id;
          snapshot = await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
            where: { id },
            include: { assetGroup: true, mediaAsset: true },
          });
        }
        const createAsset = async () => {
          const data = { updatedAt: new Date(Date.now() + 1000) };
          if (kind === 'character')
            await db.aiProviderExternalAsset.update({ where: { id }, data });
          else
            await db.aiProviderMediaAssetMirror.update({ where: { id }, data });
          return { Id: 'abandoned-created-asset' };
        };
        const args = [
          db as never,
          {} as never,
          { createAsset } as never,
          { resolvePublicUrl: () => 'https://example.com/image' } as never,
        ] as const;
        const instance =
          kind === 'character'
            ? new CharacterProviderSyncService(...args)
            : new MediaAssetProviderSyncService(...args);
        const teardown = jest
          .spyOn(
            instance as unknown as {
              enqueueCriticalTeardown(args: {
                externalAssetIds: string[];
                externalGroupIds: string[];
              }): Promise<void>;
            },
            'enqueueCriticalTeardown',
          )
          .mockResolvedValue();
        await (
          instance as unknown as { register(row: unknown): Promise<void> }
        ).register(snapshot);
        expect(teardown).toHaveBeenCalledWith({
          externalAssetIds: ['abandoned-created-asset'],
          externalGroupIds: [],
        });
        const current =
          kind === 'character'
            ? await db.aiProviderExternalAsset.findUniqueOrThrow({
                where: { id },
              })
            : await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
                where: { id },
              });
        expect(current).toMatchObject({
          status: 'pending',
          externalAssetId: null,
        });
        expect(await db.aiEventOutbox.count({ where: { userId: actor } })).toBe(
          0,
        );
      },
    );
    it.each([
      ['character', false],
      ['character', true],
      ['media', false],
      ['media', true],
    ] as const)(
      '%s cleans up after publication failure (queue failure=%s)',
      async (kind, queueFailure) => {
        let snapshot: unknown;
        let id: string;
        if (kind === 'character') {
          const { mirror } = await characterMirror();
          id = mirror.id;
          await db.aiProviderExternalAsset.update({
            where: { id },
            data: { status: 'pending', externalAssetId: null },
          });
          snapshot = await db.aiProviderExternalAsset.findUniqueOrThrow({
            where: { id },
            include: {
              assetGroup: { include: { character: true } },
              characterMedia: { include: { mediaAsset: true } },
            },
          });
        } else {
          const image = await asset();
          const { group } = await mediaRegistration();
          const mirror = await db.aiProviderMediaAssetMirror.create({
            data: {
              providerAssetGroupId: group.id,
              mediaAssetId: image.id,
              status: 'pending',
            },
          });
          id = mirror.id;
          snapshot = await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
            where: { id },
            include: { assetGroup: true, mediaAsset: true },
          });
        }

        const failure = new Error('publication unavailable');
        const args = [
          db as never,
          {} as never,
          {
            createAsset: () => Promise.resolve({ Id: 'unpublished-asset' }),
          } as never,
          { resolvePublicUrl: () => 'https://example.com/image' } as never,
        ] as const;
        const instance =
          kind === 'character'
            ? new CharacterProviderSyncService(...args)
            : new MediaAssetProviderSyncService(...args);
        const worker = instance as unknown as {
          register(row: unknown): Promise<void>;
          enqueueCriticalTeardown(args: {
            externalAssetIds: string[];
            externalGroupIds: string[];
          }): Promise<void>;
        };
        const teardown = jest.spyOn(worker, 'enqueueCriticalTeardown');
        if (queueFailure)
          teardown.mockRejectedValue(new Error('queue unavailable'));
        else teardown.mockResolvedValue();
        const persistence = jest
          .spyOn(db, '$transaction')
          .mockRejectedValueOnce(failure);
        try {
          await expect(worker.register(snapshot)).rejects.toBe(failure);
        } finally {
          persistence.mockRestore();
        }
        expect(teardown).toHaveBeenCalledWith({
          externalAssetIds: ['unpublished-asset'],
          externalGroupIds: [],
        });
        const current =
          kind === 'character'
            ? await db.aiProviderExternalAsset.findUniqueOrThrow({
                where: { id },
              })
            : await db.aiProviderMediaAssetMirror.findUniqueOrThrow({
                where: { id },
              });
        expect(current).toMatchObject({
          status: 'pending',
          externalAssetId: null,
        });
        expect(await db.aiEventOutbox.count({ where: { userId: actor } })).toBe(
          0,
        );
      },
    );
  },
);
