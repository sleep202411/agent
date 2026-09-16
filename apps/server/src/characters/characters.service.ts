import { requireNonReceiptAsset } from '../media/media-receipt-policy';
/**
 * Character library (角色库) domain service.
 *
 * Ownership model (docs/character-library-real-person-portraits-design-v1.md):
 *  - a character is owned by its home WORKSPACE (演员池) — createdByUserId is
 *    attribution/audit only, never ownership (same posture as MediaAsset);
 *  - a project sees only its CAST (演员表): CharacterProjectCast rows are pure
 *    visibility, created by the explicit act of casting; they never cross
 *    workspaces;
 *  - real-person enrollment is feature-, region- and consent-gated;
 *    withdrawal remains available when new enrollment is disabled.
 *
 * Media: CharacterMedia joins onto confirmed MediaAssets (storage source of
 * truth). Attaching writes an idempotent MediaAssetUsage row
 * (role=reference) so the person→assets dependency graph that revocation /
 * takedown fan-out needs exists from day one.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  AiProviderAssetGroupStatus,
  AiProviderExternalAssetStatus,
  CharacterKind,
  CharacterProjectGrantStatus,
  CharacterMediaStatus,
  CharacterStatus,
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetUsageRole,
  MediaAssetUsageSurface,
  PlatformProjectStatus,
  Prisma,
  ProjectMemberRole,
  WorkspaceMemberRole,
  type MediaAsset,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { CharacterProviderSyncService } from '../ai-generation/providers/byteplus/assets/character-provider-sync.service';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces';
import {
  CharacterEnrollmentService,
  type ConsentRequestContext,
} from './character-enrollment.service';
import { REAL_PERSON_PROVIDER } from './character-generation.service';
import { CharactersConfigService } from './characters-config.service';
import {
  CHARACTER_MEDIA_CAPS,
  type AttachCharacterMediaInput,
  type CastEntryDto,
  type CharacterDetailDto,
  type CharacterMediaKindDto,
  type CharacterSummaryDto,
  type CreateCharacterInput,
  type ReorderCharacterMediaInput,
  type UpdateCharacterInput,
} from './dto';

/**
 * VISIBLE = readable in the library. Soft-deleted rows are gone; a REVOKED
 * row is still visible (as a tombstone) so the UI can show the withdrawn
 * state and offer a plain delete — matching design §4 ("revoked characters
 * tombstone in history").
 */
const VISIBLE_CHARACTER_WHERE = {
  deletedAt: null,
} satisfies Prisma.StudioCharacterWhereInput;

/**
 * USABLE = eligible for mutation / casting / generation. Excludes revoked on
 * top of soft-deleted — a withdrawn likeness can never be edited, re-cast, or
 * generated with (the generation path additionally hard-fails CHARACTER_REVOKED).
 */
const USABLE_CHARACTER_WHERE = {
  deletedAt: null,
  status: { not: CharacterStatus.revoked },
} satisfies Prisma.StudioCharacterWhereInput;

const ACTIVE_MEDIA_INCLUDE = {
  media: {
    where: { status: CharacterMediaStatus.active },
    orderBy: { sortOrder: 'asc' },
    include: {
      // Provider-mirror readiness for real_person media (leave-and-notify
      // UI): empty for virtual characters, at most one row per media here
      // (one group per provider).
      externalAssets: {
        where: { assetGroup: { provider: REAL_PERSON_PROVIDER } },
        select: { status: true, statusReason: true, externalAssetId: true },
      },
    },
  },
} satisfies Prisma.StudioCharacterInclude;

type CharacterWithMedia = Prisma.StudioCharacterGetPayload<{
  include: typeof ACTIVE_MEDIA_INCLUDE;
}>;

const MEDIA_KIND_BY_ASSET_KIND: Partial<
  Record<MediaAssetKind, CharacterMediaKindDto>
> = {
  [MediaAssetKind.image]: 'image',
  [MediaAssetKind.video]: 'video',
  [MediaAssetKind.audio]: 'audio',
};

function usageIdempotencyKey(characterId: string, mediaAssetId: string) {
  return `character-media:${characterId}:${mediaAssetId}`;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: WorkspacePermissionService,
    private readonly featureFlags: CharactersConfigService,
    private readonly enrollment: CharacterEnrollmentService,
    private readonly sync: CharacterProviderSyncService,
  ) {}

  // ─── Library (workspace 演员池) ─────────────────────────

  async create(
    user: AuthUser,
    input: CreateCharacterInput,
    context: ConsentRequestContext = {},
  ): Promise<CharacterDetailDto> {
    await this.permissions.requireWorkspaceRole(
      user.userId,
      input.workspaceId,
      WorkspaceMemberRole.editor,
    );
    const realPerson = input.kind === 'real_person';
    // real_person gates (§2.1a-c): flag, CN cell, ACR window, consent —
    // validated BEFORE any row exists; the returned evidence is appended in
    // the same transaction as the character (ledger-before-session).
    const consentRecord = realPerson
      ? this.enrollment.requireRealPersonCreateAllowed({
          consent: input.consent,
          context,
        })
      : null;
    if (realPerson) {
      // ⟦R5⟧ a likeness lives ONLY in the subject's default workspace (v1).
      await this.enrollment.requireDefaultWorkspace(user, input.workspaceId);
    }

    if (input.castProjectId) {
      const project = await this.prisma.platformProject.findFirst({
        where: {
          id: input.castProjectId,
          status: PlatformProjectStatus.active,
          deletedAt: null,
        },
        select: { workspaceId: true },
      });
      if (!project || project.workspaceId !== input.workspaceId) {
        throw new BadRequestException({
          code: 'CHARACTER_WORKSPACE_MISMATCH',
          message: 'The cast target project does not belong to this workspace.',
        });
      }
    }

    try {
      const character = await this.prisma.$transaction(async (tx) => {
        // Preserve the project-first ordering used by cast and grant writes.
        if (input.castProjectId) {
          await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${input.castProjectId}::uuid FOR UPDATE`;
        }
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${input.workspaceId}::uuid FOR UPDATE`;
        const recheck = async () => {
          await this.permissions.requireWorkspaceRole(
            user.userId,
            input.workspaceId,
            WorkspaceMemberRole.editor,
            tx,
          );
          if (realPerson) {
            await this.enrollment.requireDefaultWorkspace(
              user,
              input.workspaceId,
              tx,
            );
          }
          if (input.castProjectId) {
            const project = await tx.platformProject.findFirst({
              where: {
                id: input.castProjectId,
                workspaceId: input.workspaceId,
                status: PlatformProjectStatus.active,
                deletedAt: null,
              },
              select: { id: true },
            });
            if (!project)
              throw new BadRequestException({
                code: 'CHARACTER_WORKSPACE_MISMATCH',
                message:
                  'The cast target project does not belong to this workspace.',
              });
          }
        };
        await recheck();
        const created = await tx.studioCharacter.create({
          data: {
            workspaceId: input.workspaceId,
            kind: realPerson
              ? CharacterKind.real_person
              : CharacterKind.virtual,
            name: input.name,
            description: input.description || null,
            // Virtual characters need no verification — born active.
            // real_person starts draft and earns `active` through the
            // liveness enrollment flow.
            status: realPerson ? CharacterStatus.draft : CharacterStatus.active,
            createdByUserId: user.userId,
            subjectUserId: realPerson ? user.userId : null,
          },
        });
        if (consentRecord) {
          await tx.characterConsentRecord.create({
            data: { ...consentRecord, characterId: created.id },
          });
        }
        if (input.castProjectId) {
          await tx.characterProjectCast.create({
            data: {
              projectId: input.castProjectId,
              characterId: created.id,
              addedByUserId: user.userId,
            },
          });
        }
        await recheck();
        return created;
      });
      return this.toDetail({ ...character, media: [] });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'CHARACTER_NAME_TAKEN',
          message: 'A character with this name already exists in the library.',
        });
      }
      throw err;
    }
  }

  async list(
    user: AuthUser,
    workspaceId: string,
  ): Promise<{ items: CharacterSummaryDto[] }> {
    await this.permissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
    );
    const characters = await this.prisma.studioCharacter.findMany({
      where: { workspaceId, ...VISIBLE_CHARACTER_WHERE },
      include: ACTIVE_MEDIA_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return { items: characters.map((c) => this.toSummary(c)) };
  }

  async get(user: AuthUser, characterId: string): Promise<CharacterDetailDto> {
    const character = await this.requireVisibleCharacter(characterId);
    await this.permissions.requireWorkspaceRole(
      user.userId,
      character.workspaceId,
      WorkspaceMemberRole.viewer,
    );
    return this.toDetail(character);
  }

  async update(
    user: AuthUser,
    characterId: string,
    input: UpdateCharacterInput,
  ): Promise<CharacterDetailDto> {
    const character = await this.requireUsableCharacter(characterId);
    await this.permissions.requireWorkspaceRole(
      user.userId,
      character.workspaceId,
      WorkspaceMemberRole.editor,
    );
    this.requireRealPersonWritable(character, user);

    const data: Prisma.StudioCharacterUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) {
      data.description = input.description || null;
    }
    if (input.coverAssetId !== undefined) {
      data.coverAssetId = input.coverAssetId;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const character = await this.requireWritableInTx(tx, user, characterId);
        if (input.coverAssetId !== undefined && input.coverAssetId !== null) {
          const owned = character.media.some(
            (m) => m.mediaAssetId === input.coverAssetId,
          );
          if (!owned) {
            throw new BadRequestException({
              code: 'CHARACTER_COVER_INVALID',
              message: "Cover must be one of the character's attached media.",
            });
          }
        }

        const updated = await tx.studioCharacter.update({
          where: { id: characterId },
          data,
          include: ACTIVE_MEDIA_INCLUDE,
        });
        await this.permissions.requireWorkspaceRole(
          user.userId,
          character.workspaceId,
          WorkspaceMemberRole.editor,
          tx,
        );
        return this.toDetail(updated);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'CHARACTER_NAME_TAKEN',
          message: 'A character with this name already exists in the library.',
        });
      }
      throw err;
    }
  }

  async remove(user: AuthUser, characterId: string): Promise<void> {
    const character = await this.requireVisibleCharacter(characterId);
    await this.requireRemovalAuthority(user, character);

    // real_person DELETE means REVOKE (design §5.1) — consent withdrawal, not
    // tidy-up — UNLESS the row is already a revoked tombstone, in which case
    // this is the plain "clear the tombstone" delete. Only the subject may
    // act on their own likeness; the kill-switch must NOT trap a subject who
    // wants to withdraw consent, so the flag gate is deliberately skipped
    // here (it still gates create/edit/attach/generation).
    if (
      character.kind === CharacterKind.real_person &&
      character.status !== CharacterStatus.revoked
    ) {
      if (character.subjectUserId !== user.userId) {
        throw new ForbiddenException({
          code: 'CHARACTER_SUBJECT_MISMATCH',
          message: 'Only the enrolled person can revoke this character.',
        });
      }
      await this.enrollment.revoke(user, character);
      return;
    }

    const teardown = await this.prisma.$transaction(async (tx) => {
      await this.acquireCharacterLock(tx, characterId);
      await tx.$queryRaw`SELECT id FROM studio_characters WHERE id = ${characterId}::uuid FOR UPDATE`;
      const current = await this.requireVisibleCharacter(characterId, tx);
      await this.requireRemovalAuthority(user, current, tx);
      await tx.studioCharacter.update({
        where: { id: characterId },
        data: {
          deletedAt: new Date(),
          // Keep a revoked tombstone's terminal status on the ledger; a
          // plain virtual delete disables the row.
          status:
            current.status === CharacterStatus.revoked
              ? CharacterStatus.revoked
              : CharacterStatus.disabled,
        },
      });
      // Cast rows are pure visibility — hard delete is correct.
      await tx.characterProjectCast.deleteMany({ where: { characterId } });
      // Release the reference-usage claims on the underlying assets.
      await tx.mediaAssetUsage.updateMany({
        where: {
          idempotencyKey: {
            in: current.media.map((m) =>
              usageIdempotencyKey(characterId, m.mediaAssetId),
            ),
          },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      const groups = await tx.aiProviderAssetGroup.findMany({
        where: {
          characterId,
          status: { not: AiProviderAssetGroupStatus.deleted },
        },
        include: {
          externalAssets: {
            where: { status: { not: AiProviderExternalAssetStatus.deleted } },
            select: { externalAssetId: true },
          },
        },
      });
      await tx.aiProviderAssetGroup.updateMany({
        where: {
          characterId,
          status: { not: AiProviderAssetGroupStatus.deleted },
        },
        data: { status: AiProviderAssetGroupStatus.disabled },
      });
      await tx.aiProviderExternalAsset.updateMany({
        where: {
          providerAssetGroupId: { in: groups.map((group) => group.id) },
          status: { not: AiProviderExternalAssetStatus.deleted },
        },
        data: { status: AiProviderExternalAssetStatus.disabled },
      });
      await this.requireRemovalAuthority(user, current, tx);
      return {
        externalAssetIds: groups
          .flatMap((group) =>
            group.externalAssets.map((asset) => asset.externalAssetId),
          )
          .filter((id): id is string => Boolean(id)),
        externalGroupIds: groups.map((group) => group.externalGroupId),
      };
    });
    await this.requestProviderTeardown(teardown);
  }

  // ─── Character media ────────────────────────────────────

  async attachMedia(
    user: AuthUser,
    characterId: string,
    input: AttachCharacterMediaInput,
  ): Promise<CharacterDetailDto> {
    const character = await this.requireUsableCharacter(characterId);
    await this.permissions.requireWorkspaceRole(
      user.userId,
      character.workspaceId,
      WorkspaceMemberRole.editor,
    );
    this.requireRealPersonWritable(character, user);

    const { mediaKind } = await this.requireAttachableAsset(
      user,
      input.mediaAssetId,
      character.workspaceId,
    );

    // Provider-mirror group resolution (§2.2 eager registration):
    //  - real_person: the verified LivenessFace group MUST already exist
    //    (enrollment complete) — the upstream face-consistency check runs
    //    against it.
    //  - virtual: an AIGC digital-human group is provisioned on demand so the
    //    image is registered and can generate video on Seedance without the
    //    real-person risk-control rejecting it. Only images are registered
    //    (video/audio aren't subject to the face filter); a failure to
    //    provision leaves the character URL-only (best effort, never blocks
    //    the attach).
    let mirrorGroupId: string | null = null;
    if (character.kind === CharacterKind.real_person) {
      const group = await this.prisma.aiProviderAssetGroup.findFirst({
        where: {
          characterId,
          provider: REAL_PERSON_PROVIDER,
          status: AiProviderAssetGroupStatus.active,
        },
        select: { id: true },
      });
      if (!group) {
        throw new ConflictException({
          code: 'ENROLLMENT_REQUIRED',
          message: 'Complete identity verification before adding media.',
        });
      }
      mirrorGroupId = group.id;
    } else if (mediaKind === 'image') {
      mirrorGroupId = await this.sync.ensureAigcGroup(characterId);
    }

    let mirrorRowId: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const character = await this.requireWritableInTx(tx, user, characterId);
        await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${input.mediaAssetId}::uuid FOR UPDATE`;
        const { asset, mediaKind } = await this.requireAttachableAsset(
          user,
          input.mediaAssetId,
          character.workspaceId,
          tx,
        );
        let currentMirrorGroupId =
          character.kind === CharacterKind.real_person || mediaKind === 'image'
            ? mirrorGroupId
            : null;
        if (currentMirrorGroupId) {
          await tx.$queryRaw`SELECT id FROM ai_provider_asset_groups WHERE id = ${currentMirrorGroupId}::uuid FOR SHARE`;
          const group = await tx.aiProviderAssetGroup.findFirst({
            where: {
              id: currentMirrorGroupId,
              characterId,
              status: AiProviderAssetGroupStatus.active,
            },
          });
          if (!group) {
            if (character.kind === CharacterKind.real_person)
              throw new ConflictException({
                code: 'ENROLLMENT_REQUIRED',
                message: 'Complete identity verification before adding media.',
              });
            currentMirrorGroupId = null;
          }
        }
        const kindCount = await tx.characterMedia.count({
          where: {
            characterId,
            status: CharacterMediaStatus.active,
            mediaKind: asset.kind,
          },
        });
        if (kindCount >= CHARACTER_MEDIA_CAPS[mediaKind]) {
          throw new ConflictException({
            code: 'CHARACTER_MEDIA_LIMIT',
            message: `A character holds at most ${CHARACTER_MEDIA_CAPS[mediaKind]} ${mediaKind} references.`,
          });
        }
        const maxSort = await tx.characterMedia.aggregate({
          where: { characterId },
          _max: { sortOrder: true },
        });
        const mediaRow = await tx.characterMedia.create({
          data: {
            characterId,
            mediaAssetId: asset.id,
            mediaKind: asset.kind,
            sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
            status: CharacterMediaStatus.active,
          },
        });
        if (currentMirrorGroupId) {
          const mirror = await this.sync.createPendingMirror(tx, {
            characterMediaId: mediaRow.id,
            providerAssetGroupId: currentMirrorGroupId,
          });
          mirrorRowId = mirror.id;
        }
        if (!character.coverAssetId && mediaKind === 'image') {
          await tx.studioCharacter.update({
            where: { id: characterId },
            data: { coverAssetId: asset.id },
          });
        }
        await this.recordAttachUsage(tx, character, asset, user.userId);
        await this.permissions.requireWorkspaceRole(
          user.userId,
          character.workspaceId,
          WorkspaceMemberRole.editor,
          tx,
        );
      });
      // Eager registration AFTER commit (the queue job re-reads the row).
      if (mirrorRowId) await this.sync.enqueueRegister(mirrorRowId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'CHARACTER_MEDIA_DUPLICATE',
          message: 'This media asset is already attached to the character.',
        });
      }
      throw err;
    }

    return this.toDetail(await this.requireUsableCharacter(characterId));
  }

  async removeMedia(
    user: AuthUser,
    characterId: string,
    characterMediaId: string,
  ): Promise<CharacterDetailDto> {
    const character = await this.requireUsableCharacter(characterId);
    await this.permissions.requireWorkspaceRole(
      user.userId,
      character.workspaceId,
      WorkspaceMemberRole.editor,
    );
    this.requireRealPersonWritable(character, user);

    const orphanedExternalAssetIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const character = await this.requireWritableInTx(tx, user, characterId);
      // Fresh reads under the lock — the pre-transaction snapshot may be
      // stale against a concurrent attach/remove/reorder on this character.
      const row = await tx.characterMedia.findFirst({
        where: {
          id: characterMediaId,
          characterId,
          status: CharacterMediaStatus.active,
        },
        include: {
          externalAssets: { select: { externalAssetId: true } },
        },
      });
      if (!row) {
        throw new NotFoundException({
          code: 'CHARACTER_MEDIA_NOT_FOUND',
          message: 'Character media not found.',
        });
      }
      // Durable teardown ledger: flip the mirror rows to `disabled` FIRST,
      // then delete the media — SetNull detaches them (characterMediaId=null)
      // as surviving disabled rows. If the post-commit enqueue below is lost
      // to a crash, the reconciliation sweep finds these detached disabled
      // rows and re-drives the upstream delete. Never orphan face bytes.
      orphanedExternalAssetIds.push(
        ...row.externalAssets
          .map((mirror) => mirror.externalAssetId)
          .filter((id): id is string => Boolean(id)),
      );
      await tx.aiProviderExternalAsset.updateMany({
        where: {
          characterMediaId: row.id,
          status: { not: AiProviderExternalAssetStatus.deleted },
        },
        data: { status: AiProviderExternalAssetStatus.disabled },
      });
      await tx.characterMedia.delete({ where: { id: row.id } });
      await tx.mediaAssetUsage.updateMany({
        where: {
          idempotencyKey: usageIdempotencyKey(characterId, row.mediaAssetId),
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      const fresh = await tx.studioCharacter.findFirst({
        where: { id: characterId },
        select: { coverAssetId: true },
      });
      if (fresh?.coverAssetId === row.mediaAssetId) {
        // Rotate the cover to the first remaining active image, else clear
        // it — decided on a post-delete read, never the stale snapshot.
        const nextCover = await tx.characterMedia.findFirst({
          where: {
            characterId,
            status: CharacterMediaStatus.active,
            mediaKind: MediaAssetKind.image,
          },
          orderBy: { sortOrder: 'asc' },
        });
        await tx.studioCharacter.update({
          where: { id: characterId },
          data: { coverAssetId: nextCover?.mediaAssetId ?? null },
        });
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        character.workspaceId,
        WorkspaceMemberRole.editor,
        tx,
      );
    });
    if (orphanedExternalAssetIds.length > 0) {
      await this.requestProviderTeardown({
        externalAssetIds: orphanedExternalAssetIds,
        externalGroupIds: [],
      });
    }

    return this.toDetail(await this.requireUsableCharacter(characterId));
  }

  async reorderMedia(
    user: AuthUser,
    characterId: string,
    input: ReorderCharacterMediaInput,
  ): Promise<CharacterDetailDto> {
    const character = await this.requireUsableCharacter(characterId);
    await this.permissions.requireWorkspaceRole(
      user.userId,
      character.workspaceId,
      WorkspaceMemberRole.editor,
    );
    this.requireRealPersonWritable(character, user);

    return this.prisma.$transaction(async (tx) => {
      const character = await this.requireWritableInTx(tx, user, characterId);
      const currentIds = new Set(character.media.map((m) => m.id));
      const orderedIds = new Set(input.order);
      const exactCover =
        input.order.length === character.media.length &&
        orderedIds.size === input.order.length &&
        character.media.every((m) => orderedIds.has(m.id));
      if (!exactCover) {
        throw new BadRequestException({
          code: 'CHARACTER_MEDIA_ORDER_INVALID',
          message: `Order must list each of the character's ${currentIds.size} media ids exactly once.`,
        });
      }

      for (const [index, id] of input.order.entries()) {
        await tx.characterMedia.update({
          where: { id },
          data: { sortOrder: index },
        });
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        character.workspaceId,
        WorkspaceMemberRole.editor,
        tx,
      );
      return this.toDetail(await this.requireUsableCharacter(characterId, tx));
    });
  }

  // ─── Cast (project 演员表) ──────────────────────────────

  async listCast(
    user: AuthUser,
    projectId: string,
  ): Promise<{ items: CastEntryDto[] }> {
    // Project-scoped read — WORKS for project-only members by design: the
    // cast is exactly the slice of the library this project may see.
    await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.viewer,
    );
    const rows = await this.prisma.characterProjectCast.findMany({
      where: { projectId, character: USABLE_CHARACTER_WHERE },
      include: { character: { include: ACTIVE_MEDIA_INCLUDE } },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map((row) => this.toCastEntry(row)) };
  }

  /**
   * ⟦v2⟧ real_person likenesses AUTHORIZED (granted) to this project — the
   * cast picker unions these with the cast (a granted real_person has no cast
   * row and can't get one; the grant is its project visibility carrier).
   * Project-scoped read (viewer+), like listCast.
   */
  async listGrantedCharacters(
    user: AuthUser,
    projectId: string,
  ): Promise<{ items: CharacterSummaryDto[] }> {
    await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.viewer,
    );
    const grants = await this.prisma.characterProjectGrant.findMany({
      where: {
        projectId,
        status: CharacterProjectGrantStatus.active,
        character: USABLE_CHARACTER_WHERE,
      },
      include: { character: { include: ACTIVE_MEDIA_INCLUDE } },
      orderBy: { createdAt: 'asc' },
    });
    return { items: grants.map((g) => this.toSummary(g.character)) };
  }

  async castCharacter(
    user: AuthUser,
    projectId: string,
    characterId: string,
  ): Promise<CastEntryDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      await this.acquireCharacterLock(tx, characterId);
      await tx.$queryRaw`SELECT id FROM studio_characters WHERE id = ${characterId}::uuid FOR UPDATE`;
      const project = await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      // Project-only access still does not grant access to the workspace library.
      await this.permissions.requireWorkspaceRole(
        user.userId,
        project.workspaceId,
        WorkspaceMemberRole.viewer,
        tx,
      );
      const character = await this.requireUsableCharacter(characterId, tx);
      if (character.workspaceId !== project.workspaceId)
        throw new BadRequestException({
          code: 'CHARACTER_WORKSPACE_MISMATCH',
          message: 'Characters can only be cast within their home workspace.',
        });
      const existing = await tx.characterProjectCast.findFirst({
        where: { projectId, characterId },
      });
      const row =
        existing ??
        (await tx.characterProjectCast.create({
          data: { projectId, characterId, addedByUserId: user.userId },
        }));
      await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      await this.permissions.requireWorkspaceRole(
        user.userId,
        project.workspaceId,
        WorkspaceMemberRole.viewer,
        tx,
      );
      return this.toCastEntry({ ...row, character });
    });
  }

  async uncastCharacter(
    user: AuthUser,
    projectId: string,
    characterId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      await this.acquireCharacterLock(tx, characterId);
      await tx.$queryRaw`SELECT id FROM studio_characters WHERE id = ${characterId}::uuid FOR UPDATE`;
      await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
      // Idempotent even when the character is no longer usable or already absent.
      await tx.characterProjectCast.deleteMany({
        where: { projectId, characterId },
      });
      await this.permissions.requireProjectRole(
        user.userId,
        projectId,
        ProjectMemberRole.editor,
        tx,
      );
    });
  }

  // ─── Internals ──────────────────────────────────────────

  /**
   * Per-character mutation serializer (seat-guard pattern): taken FIRST in
   * every media-mutating transaction (attach/remove/reorder) so concurrent
   * writers on one character queue up instead of interleaving — the kind-cap
   * count, sortOrder allocation, and cover rotation all read fresh state
   * under the lock. Transaction-scoped: released automatically on
   * commit/rollback.
   */
  private async acquireCharacterLock(
    tx: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`character:${characterId}`})::bigint)`;
  }

  private async requireAttachableAsset(
    user: AuthUser,
    mediaAssetId: string,
    workspaceId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const asset = await client.mediaAsset.findFirst({
      where: { id: mediaAssetId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_ASSET_NOT_FOUND',
        message: 'Media asset not found.',
      });
    }
    if (asset.status !== MediaAssetStatus.ready) {
      throw new BadRequestException({
        code: 'MEDIA_ASSET_NOT_READY',
        message: 'Media asset is not ready.',
      });
    }
    if (asset.moderationStatus === MediaAssetModerationStatus.blocked) {
      throw new BadRequestException({
        code: 'MEDIA_ASSET_BLOCKED',
        message: 'Media asset was blocked by moderation.',
      });
    }
    requireNonReceiptAsset(asset.metadata);
    if (asset.workspaceId !== workspaceId) {
      throw new ForbiddenException({
        code: 'CHARACTER_ASSET_WORKSPACE_MISMATCH',
        message: 'Character media must belong to the character workspace.',
      });
    }
    // Anti-leak: you can only enroll media you uploaded yourself — attaching
    // is what makes an asset reachable by every workspace/cast member.
    if (asset.createdByUserId !== user.userId) {
      throw new ForbiddenException({
        code: 'MEDIA_ASSET_NOT_OWNED',
        message: 'You can only attach media you uploaded yourself.',
      });
    }
    const mediaKind = MEDIA_KIND_BY_ASSET_KIND[asset.kind];
    if (!mediaKind) {
      throw new BadRequestException({
        code: 'CHARACTER_MEDIA_KIND_INVALID',
        message: 'Character media must be an image, video, or audio asset.',
      });
    }

    return { asset, mediaKind };
  }

  private async requireWritableInTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    characterId: string,
  ): Promise<CharacterWithMedia> {
    await this.acquireCharacterLock(tx, characterId);
    await tx.$queryRaw`SELECT id FROM studio_characters WHERE id = ${characterId}::uuid FOR UPDATE`;
    const character = await this.requireUsableCharacter(characterId, tx);
    await this.permissions.requireWorkspaceRole(
      user.userId,
      character.workspaceId,
      WorkspaceMemberRole.editor,
      tx,
    );
    this.requireRealPersonWritable(character, user);
    return character;
  }

  private async requestProviderTeardown(teardown: {
    externalAssetIds: string[];
    externalGroupIds: string[];
  }): Promise<void> {
    if (!teardown.externalAssetIds.length && !teardown.externalGroupIds.length)
      return;
    try {
      await this.sync.enqueueCriticalTeardown(teardown);
    } catch {
      // Disabled rows remain durable reconciliation candidates. The library
      // mutation has committed; a queue outage must not report it as rejected.
      this.logger.warn(
        'Character provider cleanup deferred to reconciliation.',
      );
    }
  }

  private async requireRemovalAuthority(
    user: AuthUser,
    character: CharacterWithMedia,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    // Workspace admins may delete anything; the creator may delete their own
    // character with plain editor rights (attribution grants cleanup, not
    // ownership).
    try {
      await this.permissions.requireWorkspaceRole(
        user.userId,
        character.workspaceId,
        WorkspaceMemberRole.admin,
        client,
      );
    } catch (err) {
      if (
        !(err instanceof ForbiddenException) ||
        character.createdByUserId !== user.userId
      ) {
        throw err;
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        character.workspaceId,
        WorkspaceMemberRole.editor,
        client,
      );
    }
  }

  /** Readable row (revoked tombstone included) — for get()/remove(). */
  private async requireVisibleCharacter(
    characterId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<CharacterWithMedia> {
    const character = await client.studioCharacter.findFirst({
      where: { id: characterId, ...VISIBLE_CHARACTER_WHERE },
      include: ACTIVE_MEDIA_INCLUDE,
    });
    if (!character) {
      throw new NotFoundException({
        code: 'CHARACTER_NOT_FOUND',
        message: 'Character not found.',
      });
    }
    return character;
  }

  /** Mutable row (revoked excluded) — for every edit/media/cast path. */
  private async requireUsableCharacter(
    characterId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<CharacterWithMedia> {
    const character = await client.studioCharacter.findFirst({
      where: { id: characterId, ...USABLE_CHARACTER_WHERE },
      include: ACTIVE_MEDIA_INCLUDE,
    });
    if (!character) {
      throw new NotFoundException({
        code: 'CHARACTER_NOT_FOUND',
        message: 'Character not found.',
      });
    }
    return character;
  }

  /**
   * real_person write gate: feature flag + the v1 self-only rule — every
   * mutation of a likeness (rename, media, deletion) belongs exclusively to
   * the enrolled subject, on top of the workspace-role checks (defense in
   * depth; personal-workspace membership already implies it).
   */
  private requireRealPersonWritable(
    character: { kind: CharacterKind; subjectUserId: string | null },
    user: AuthUser,
  ) {
    if (character.kind !== CharacterKind.real_person) return;
    if (!this.featureFlags.config.realPersonEnabled) {
      throw new NotImplementedException({
        code: 'REAL_PERSON_NOT_AVAILABLE',
        message: 'Real-person characters are not available yet.',
      });
    }
    if (character.subjectUserId !== user.userId) {
      throw new ForbiddenException({
        code: 'CHARACTER_SUBJECT_MISMATCH',
        message: 'Only the enrolled person can manage this character.',
      });
    }
  }

  /**
   * Reference-usage ledger (P0): every attach claims the asset with an
   * idempotent MediaAssetUsage row so revocation/takedown can fan out over
   * the person→assets graph. `ip_library` is the closest existing surface
   * for a workspace-level reference library (adding enum values is out of
   * scope); `sourceSurface` carries the precise origin.
   */
  private async recordAttachUsage(
    tx: Prisma.TransactionClient,
    character: CharacterWithMedia,
    asset: MediaAsset,
    userId: string,
  ): Promise<void> {
    const idempotencyKey = usageIdempotencyKey(character.id, asset.id);
    await tx.mediaAssetUsage.upsert({
      where: { idempotencyKey },
      create: {
        assetId: asset.id,
        userId,
        workspaceId: character.workspaceId,
        surface: MediaAssetUsageSurface.ip_library,
        sourceSurface: 'character_library',
        role: MediaAssetUsageRole.reference,
        idempotencyKey,
        metadata: {
          characterId: character.id,
          characterKind: character.kind,
        } satisfies Prisma.InputJsonObject,
      },
      update: { lastObservedAt: new Date(), deletedAt: null },
    });
  }

  private toSummary(character: CharacterWithMedia): CharacterSummaryDto {
    const mediaCounts = { image: 0, video: 0, audio: 0 };
    for (const row of character.media) {
      const kind = MEDIA_KIND_BY_ASSET_KIND[row.mediaKind];
      if (kind) mediaCounts[kind] += 1;
    }
    return {
      id: character.id,
      workspaceId: character.workspaceId,
      kind: character.kind,
      name: character.name,
      description: character.description,
      coverAssetId: character.coverAssetId,
      status: character.status,
      createdByUserId: character.createdByUserId,
      mediaCounts,
      createdAt: character.createdAt.toISOString(),
      updatedAt: character.updatedAt.toISOString(),
    };
  }

  private toDetail(character: CharacterWithMedia): CharacterDetailDto {
    return {
      ...this.toSummary(character),
      media: character.media.flatMap((row) => {
        const mediaKind = MEDIA_KIND_BY_ASSET_KIND[row.mediaKind];
        // document/other can never be attached — defensive narrow only.
        if (!mediaKind) return [];
        // A mirror row exists ⇔ this media is provider-registered — either a
        // real_person LivenessFace asset or a virtual AIGC digital-human
        // asset. Its presence drives the "审核中/已认证/被拒" chip; media with
        // no mirror (un-registered virtual video/audio, or a plain-URL
        // character created while AIGC was off) simply omits it.
        const mirror = row.externalAssets[0];
        return [
          {
            id: row.id,
            mediaAssetId: row.mediaAssetId,
            mediaKind,
            sortOrder: row.sortOrder,
            ...(mirror
              ? {
                  mirror: {
                    status: mirror.status,
                    statusReason: mirror.statusReason ?? null,
                  },
                }
              : {}),
          },
        ];
      }),
    };
  }

  private toCastEntry(row: {
    id: string;
    characterId: string;
    addedByUserId: string;
    createdAt: Date;
    character: CharacterWithMedia;
  }): CastEntryDto {
    return {
      id: row.id,
      characterId: row.characterId,
      addedByUserId: row.addedByUserId,
      createdAt: row.createdAt.toISOString(),
      character: this.toSummary(row.character),
    };
  }
}
