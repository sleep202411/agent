/**
 * DTOs for the direct-to-storage upload pipeline.
 *
 * Two steps:
 *   1. `POST /aurora/media/upload-url` — generic uploads remain stateless.
 *      Server-verified images receive a disposable staging key; confirm
 *      promotes it to an unsigned final object before byte inspection. Story clips are
 *      the durable exception and create a project-scoped upload session.
 *   2. `POST /aurora/media/confirm`    — after the PUT lands, the server
 *      verifies the bytes and only then writes an `active` MediaAsset. AI
 *      verified images are streamed back, hashed, format-probed, and fully
 *      decoded from immutable final storage before they become active.
 *
 * `kind` is a CLOSED enum — every upload entry point the product offers
 * is named here, and each maps (server-side) to a content-type allowlist,
 * a byte cap, and a MediaAsset kind. Adding a feature = add a `kind` here
 * + a row in UPLOAD_KIND_POLICY (media-upload.service). The client never
 * picks the storage key, the content-type allowlist, or the cap.
 */
import {
  MEDIA_ASSET_READINESS_CAPABILITIES,
  type MediaAssetReadinessResult,
} from '@repo/shared';
import { z } from 'zod';

import { UploadKindSchema } from '@repo/shared/media-upload';
export { UploadKindSchema, type UploadKind } from '@repo/shared/media-upload';

export const CreateUploadUrlSchema = z.object({
  kind: UploadKindSchema,
  /** Validated against the per-kind allowlist server-side. */
  contentType: z.string().trim().min(1).max(128),
  /** ADVISORY ONLY — used for its extension + audit, never the key. */
  fileName: z.string().trim().min(1).max(256),
  /** Declared size; pre-checked against the per-kind cap before minting. */
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** Story/Crew scopes authorize uploads; legacy feature IDs are audit-only. */
  scope: z
    .object({
      projectId: z.union([z.string(), z.number()]).optional(),
      episodeId: z.union([z.string(), z.number()]).optional(),
      crewId: z.string().trim().min(1).max(64).optional(),
      storyProjectId: z.string().uuid().optional(),
    })
    .optional(),
});
export type CreateUploadUrlInputDto = z.infer<typeof CreateUploadUrlSchema>;

export interface CreateUploadUrlResponseDto {
  /** Fully-signed write URL the browser PUTs bytes to. */
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  /**
   * Server-decided object key. Verified images and Story clips receive a
   * staging key; other generic uploads receive their permanent key. The client
   * echoes it verbatim to confirm and derives nothing from `uploadUrl`.
   */
  storageKey: string;
  provider: 'azure_blob' | 'aliyun_oss' | 's3_compatible';
  /** ISO; client re-requests a fresh URL if it'll lapse mid-upload. */
  expiresAt: string;
}

/**
 * `POST /aurora/media/confirm` — called AFTER the direct PUT lands. The
 * server verifies (never trusts) the bytes. Generic flows then mint the
 * MediaAsset row; Story flows confirm the durable staging ledger and leave it
 * non-ready for async promotion/probing. The client sends back the exact `storageKey` it was
 * issued; `kind` re-asserts which feature this was (used to re-derive the
 * ownership scope + asset kind). `contentType` is never trusted as byte truth:
 * generic uploads use storage metadata, while reference-image finalization
 * requires the detected byte format to match it.
 */
export const ConfirmUploadSchema = z.object({
  /** The exact key issued by upload-url; ownership + existence are verified. */
  storageKey: z.string().trim().min(1).max(1024),
  kind: UploadKindSchema,
  /** Re-asserted against storage metadata and, for verified images, bytes. */
  contentType: z.string().trim().min(1).max(128),
  /** Display metadata only; never used to derive the storage identity. */
  fileName: z.string().min(1).max(256).optional(),
  scope: z
    .object({
      crewId: z.string().trim().min(1).max(64).optional(),
      storyProjectId: z.string().uuid().optional(),
    })
    .optional(),
});
export type ConfirmUploadInputDto = z.infer<typeof ConfirmUploadSchema>;

export interface ConfirmUploadResponseDto {
  /** The active MediaAsset row — this is what the save call references. */
  mediaAssetId: string;
  /**
   * Exact immutable original variant created for a generic confirmed upload.
   * Story video staging has no ready variant until asynchronous finalization,
   * so that flow returns null explicitly.
   */
  variantId: string | null;
  /** Final immutable key for verified images; otherwise the issued key. */
  storageKey: string;
  provider: 'azure_blob' | 'aliyun_oss' | 's3_compatible';
  /** Story staging assets are intentionally unreadable until async finalize. */
  url: string | null;
}

const MediaAssetReadinessCapabilitySchema = z.enum(
  MEDIA_ASSET_READINESS_CAPABILITIES,
);

export const MediaAssetReadinessStatusRequestSchema = z.object({
  capability: MediaAssetReadinessCapabilitySchema,
  documentId: z.string().uuid().optional(),
  assetIds: z.array(z.string().uuid()).max(100),
});
export type MediaAssetReadinessStatusRequestDto = z.infer<
  typeof MediaAssetReadinessStatusRequestSchema
>;

export interface MediaAssetReadinessStatusResponseDto {
  assets: MediaAssetReadinessResult[];
}

export const MediaAssetReadinessCheckRequestSchema = z.object({
  capability: MediaAssetReadinessCapabilitySchema,
  documentId: z.string().uuid().optional(),
});
export type MediaAssetReadinessCheckRequestDto = z.infer<
  typeof MediaAssetReadinessCheckRequestSchema
>;

export interface MediaAssetReadinessCheckResponseDto {
  asset: MediaAssetReadinessResult;
}

export const MediaAssetAccessParamsSchema = z.object({
  assetId: z.string().uuid(),
});
export type MediaAssetAccessParamsDto = z.infer<
  typeof MediaAssetAccessParamsSchema
>;

export const MediaAssetAccessQuerySchema = z.object({
  variantKey: z.string().trim().min(1).max(80).default('original'),
  placementId: z.string().uuid().optional(),
  /** Canvas context: when the viewer can read this Studio document and the
   *  asset is referenced on it, read access follows the document. */
  documentId: z.string().uuid().optional(),
});
export type MediaAssetAccessQueryDto = z.infer<
  typeof MediaAssetAccessQuerySchema
>;

export interface MediaAssetAccessResponseDto {
  assetId: string;
  variantKey: string;
  placementId?: string;
  url: string;
  expiresAt: string | null;
}

export type MediaVideoPosterResponseDto =
  | { status: 'ready'; url: string; expiresAt: string | null }
  | { status: 'pending' }
  | { status: 'failed'; message: string };
