import { Injectable } from '@nestjs/common';
import {
  AiProviderAssetGroupStatus,
  AiProviderAssetGroupType,
  AiProviderExternalAssetStatus,
  CharacterKind,
  CharacterProjectGrantStatus,
  CharacterStatus,
  MediaAssetModerationStatus,
  MediaAssetStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import { ReferencePreparationError } from '../../provider-adapter';

const REFERENCE_FIELDS = [
  'referenceImages',
  'referenceVideos',
  'referenceAudios',
] as const;

/** Single-value frame fields also forwarded to the mapper. */
const FRAME_FIELDS = ['startFrame', 'endFrame'] as const;

const ASSET_SCHEME = 'asset://';
const PROVIDER_KEY = 'byteplus-modelark';

/**
 * Worker-side reference preparation (design §3.4), byteplus-only. Two jobs,
 * both run right before provider submit on every attempt:
 *
 *  1. VALIDATE existing `asset://` references (real_person likenesses): the
 *     submit-time readiness pre-check can go stale in queue (consent
 *     revocation, upstream deletion). Character status is re-read directly
 *     (revocation source of truth). Failures are TERMINAL — the worker
 *     releases the billing hold and never requeues.
 *
 *  2. UPGRADE provider-registered IMAGE references from their plain CDN URL
 *     to `asset://<externalAssetId>` when an ACTIVE AIGC mirror exists. This
 *     is what lets Seedance use the private asset library instead of treating
 *     the same image as an unregistered public URL. Best-effort and
 *     provider-scoped: only byteplus jobs reach this hook, an unregistered /
 *     still-processing image keeps its plain URL, and the rewrite is
 *     ephemeral (never persisted — retry re-derives it, and client-facing job
 *     payloads keep the plain URL).
 */
@Injectable()
export class BytePlusReferencePreparerService {
  constructor(private readonly prisma: PrismaService) {}

  async prepareReferences(
    input: Record<string, unknown>,
    jobUserId: string,
    projectId: string | null,
    jobWorkspaceId: string | null,
  ): Promise<Record<string, unknown>> {
    await this.validateAssetReferences(
      input,
      jobUserId,
      projectId,
      jobWorkspaceId,
    );
    return this.upgradeAigcImageReferences(input);
  }

  /** Pass 1 — validate real_person `asset://` references (terminal on fail). */
  private async validateAssetReferences(
    input: Record<string, unknown>,
    jobUserId: string,
    projectId: string | null,
    jobWorkspaceId: string | null,
  ): Promise<void> {
    const externalIds = collectAssetReferenceIds(input);
    if (externalIds.length === 0) return;

    const mirrors = await this.prisma.aiProviderExternalAsset.findMany({
      where: { externalAssetId: { in: externalIds } },
      include: {
        assetGroup: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
                kind: true,
                status: true,
                deletedAt: true,
                subjectUserId: true,
                workspaceId: true,
              },
            },
          },
        },
      },
    });
    const byExternalId = new Map(
      mirrors.map((mirror) => [mirror.externalAssetId, mirror]),
    );
    const mediaMirrors = await this.prisma.aiProviderMediaAssetMirror.findMany({
      where: { externalAssetId: { in: externalIds } },
      include: {
        assetGroup: true,
        mediaAsset: {
          select: {
            id: true,
            status: true,
            moderationStatus: true,
            deletedAt: true,
          },
        },
      },
    });
    const mediaByExternalId = new Map(
      mediaMirrors.map((mirror) => [mirror.externalAssetId, mirror]),
    );

    // ⟦v2⟧ Which real_person characters is THIS job authorized for? A per-
    // project revoke leaves character/group active, so the GRANT is the only
    // signal — re-checked here at the seam (design §4). Self-use (caller is
    // the subject) needs no grant. A generation that isn't self-use and has no
    // active grant for (characterId, job.projectId) is a withdrawn/never-
    // granted likeness → terminal CHARACTER_REVOKED.
    const realPersonCharacterIds = [
      ...new Set(
        mirrors.flatMap((mirror) => {
          const character = mirror.assetGroup.character;
          return character?.kind === CharacterKind.real_person
            ? [character.id]
            : [];
        }),
      ),
    ];
    const grantedCharacterIds = new Set<string>();
    if (realPersonCharacterIds.length > 0 && projectId) {
      const grants = await this.prisma.characterProjectGrant.findMany({
        where: {
          projectId,
          status: CharacterProjectGrantStatus.active,
          characterId: { in: realPersonCharacterIds },
        },
        select: { characterId: true },
      });
      for (const g of grants) grantedCharacterIds.add(g.characterId);
    }

    const now = new Date().toISOString();
    for (const externalId of externalIds) {
      const mirror = byExternalId.get(externalId);
      const mediaMirror = mediaByExternalId.get(externalId);
      if (!mirror && mediaMirror) {
        if (
          mediaMirror.status !== AiProviderExternalAssetStatus.active ||
          mediaMirror.assetGroup.status !== AiProviderAssetGroupStatus.active ||
          mediaMirror.mediaAsset.status !== MediaAssetStatus.ready ||
          mediaMirror.mediaAsset.deletedAt ||
          mediaMirror.mediaAsset.moderationStatus ===
            MediaAssetModerationStatus.blocked
        ) {
          throw new ReferencePreparationError({
            code: 'MEDIA_ASSET_NOT_READY',
            message: `Provider asset ${externalId} is no longer available.`,
            userMessage:
              'A referenced asset is not ready on the provider. Retry once it shows active again.',
            retryable: false,
            createdAt: now,
          });
        }
        continue;
      }
      const character = mirror?.assetGroup.character;
      if (
        character &&
        (character.status === CharacterStatus.revoked || character.deletedAt)
      ) {
        throw new ReferencePreparationError({
          code: 'CHARACTER_REVOKED',
          message: `Character "${character.name}" was revoked after this job was submitted.`,
          userMessage:
            'A referenced character has been revoked. The job was cancelled and your points released.',
          retryable: false,
          createdAt: now,
        });
      }
      // ⟦v2⟧ Authorization backstop: the job must be self-use (owner is the
      // subject) OR covered by an active per-project grant. A granted teammate
      // is NOT the subject, so the old subjectUserId===jobUserId check would
      // wrongly reject them; a withdrawn grant must still hard-fail here.
      if (character && character.kind === CharacterKind.real_person) {
        // Self-use matches submit-time exactly: the subject generating in
        // their OWN home workspace. A subject generating in a TEAM project is
        // NOT self-use — it needs an active grant, re-checked here.
        const selfUse =
          character.subjectUserId === jobUserId &&
          character.workspaceId === jobWorkspaceId;
        if (!selfUse && !grantedCharacterIds.has(character.id)) {
          throw new ReferencePreparationError({
            code: 'CHARACTER_REVOKED',
            message: `The authorization to use "${character.name}" in this project was withdrawn.`,
            userMessage:
              'Authorization to use this character in this project has been withdrawn. The job was cancelled and your points released.',
            retryable: false,
            createdAt: now,
          });
        }
      }
      if (
        !mirror ||
        !character ||
        character.status !== CharacterStatus.active ||
        mirror.status !== AiProviderExternalAssetStatus.active ||
        mirror.assetGroup.status !== AiProviderAssetGroupStatus.active
      ) {
        throw new ReferencePreparationError({
          code: 'CHARACTER_ASSET_NOT_READY',
          message: `Provider asset ${externalId} is no longer available.`,
          userMessage:
            'A referenced character asset is not ready on the provider. Retry once the character shows active again.',
          retryable: false,
          createdAt: now,
        });
      }
    }
  }

  /** Pass 2 — opportunistically upgrade provider-registered image refs to `asset://`. */
  private async upgradeAigcImageReferences(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const imagesValue = input.referenceImages;
    if (!Array.isArray(imagesValue)) return input;
    const images: unknown[] = imagesValue;

    // Any MediaAsset-stamped image reference still on a plain URL is an
    // upgrade candidate. Canvas references carry assetId directly; old
    // character-expanded entries carry both characterId and assetId.
    const candidates = images.filter(
      (e): e is { characterId?: string; assetId: string; url?: unknown } =>
        isRecord(e) &&
        typeof e.assetId === 'string' &&
        !(typeof e.url === 'string' && e.url.startsWith(ASSET_SCHEME)),
    );
    if (candidates.length === 0) return input;

    const mediaRows = await this.prisma.aiProviderMediaAssetMirror.findMany({
      where: {
        status: AiProviderExternalAssetStatus.active,
        externalAssetId: { not: null },
        mediaAssetId: { in: [...new Set(candidates.map((c) => c.assetId))] },
        assetGroup: {
          provider: PROVIDER_KEY,
          groupType: AiProviderAssetGroupType.aigc,
          status: AiProviderAssetGroupStatus.active,
        },
      },
      select: {
        mediaAssetId: true,
        externalAssetId: true,
      },
    });
    const byAssetId = new Map<string, string>();
    for (const row of mediaRows) {
      if (row.externalAssetId)
        byAssetId.set(row.mediaAssetId, row.externalAssetId);
    }

    const rows = await this.prisma.aiProviderExternalAsset.findMany({
      where: {
        status: AiProviderExternalAssetStatus.active,
        externalAssetId: { not: null },
        assetGroup: {
          provider: PROVIDER_KEY,
          groupType: AiProviderAssetGroupType.aigc,
          status: AiProviderAssetGroupStatus.active,
        },
        characterMedia: {
          characterId: {
            in: [
              ...new Set(
                candidates
                  .map((c) => c.characterId)
                  .filter((id): id is string => Boolean(id)),
              ),
            ],
          },
          mediaAssetId: { in: [...new Set(candidates.map((c) => c.assetId))] },
        },
      },
      select: {
        externalAssetId: true,
        characterMedia: { select: { characterId: true, mediaAssetId: true } },
      },
    });

    const byCharacterAssetKey = new Map<string, string>();
    for (const row of rows) {
      if (row.characterMedia && row.externalAssetId) {
        byCharacterAssetKey.set(
          `${row.characterMedia.characterId}:${row.characterMedia.mediaAssetId}`,
          row.externalAssetId,
        );
      }
    }
    if (byAssetId.size === 0 && byCharacterAssetKey.size === 0) return input;

    const upgraded = images.map((entry) => {
      if (!isRecord(entry)) return entry;
      const assetId = stringValue(entry.assetId);
      const characterId = stringValue(entry.characterId);
      const externalId =
        assetId != null
          ? (byAssetId.get(assetId) ??
            (characterId != null
              ? byCharacterAssetKey.get(`${characterId}:${assetId}`)
              : undefined))
          : undefined;
      return externalId
        ? { ...entry, url: `${ASSET_SCHEME}${externalId}` }
        : entry;
    });
    return { ...input, referenceImages: upgraded };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Unique `asset://` external ids across the reference arrays + frames. */
function collectAssetReferenceIds(input: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const scan = (entry: unknown): void => {
    const url =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? (entry as { url?: unknown }).url
          : undefined;
    if (typeof url === 'string' && url.startsWith(ASSET_SCHEME)) {
      const id = url.slice(ASSET_SCHEME.length).trim();
      if (id) ids.add(id);
    }
  };
  for (const field of REFERENCE_FIELDS) {
    const value = input[field];
    if (Array.isArray(value)) value.forEach(scan);
  }
  for (const field of FRAME_FIELDS) {
    if (input[field] != null) scan(input[field]);
  }
  return [...ids];
}
