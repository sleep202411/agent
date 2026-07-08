/**
 * DTOs for the direct-to-storage upload pipeline (stateless + confirm).
 *
 * Two steps:
 *   1. `POST /aurora/media/upload-url` — STATELESS. Server decides the
 *      permanent key + mints a signed write URL. NO MediaAsset is created,
 *      so an abandoned/cancelled/re-picked upload leaves ZERO DB residue.
 *   2. `POST /aurora/media/confirm`    — after the PUT lands, the server
 *      VERIFIES the bytes (ownership + HEAD) and only then writes an
 *      `active` MediaAsset. Storage is the source of truth; the DB only
 *      ever records real, referenced assets.
 *
 * `kind` is a CLOSED enum — every upload entry point the product offers
 * is named here, and each maps (server-side) to a content-type allowlist,
 * a byte cap, and a MediaAsset kind. Adding a feature = add a `kind` here
 * + a row in UPLOAD_KIND_POLICY (media-upload.service). The client never
 * picks the storage key, the content-type allowlist, or the cap.
 */
import { z } from 'zod';

export const UploadKindSchema = z.enum([
  'episode_video',
  'episode_cover',
  'ip_banner',
  'news_cover',
  'ai_reference_image',
  'ai_reference_video',
  'ai_reference_audio',
]);
export type UploadKind = z.infer<typeof UploadKindSchema>;

export const CreateUploadUrlSchema = z.object({
  kind: UploadKindSchema,
  /** Validated against the per-kind allowlist server-side. */
  contentType: z.string().trim().min(1).max(128),
  /** ADVISORY ONLY — used for its extension + audit, never the key. */
  fileName: z.string().trim().min(1).max(256),
  /** Declared size; pre-checked against the per-kind cap before minting. */
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** Optional feature linkage, audit-only at issue time. */
  scope: z
    .object({
      projectId: z.union([z.string(), z.number()]).optional(),
      episodeId: z.union([z.string(), z.number()]).optional(),
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
   * Server-decided PERMANENT object key. The client echoes this verbatim
   * to `POST /aurora/media/confirm` after the PUT lands — it is NOT a DB
   * id (issuing a URL is stateless; no MediaAsset exists yet). The client
   * derives nothing from `uploadUrl`.
   */
  storageKey: string;
  provider: 'azure_blob' | 'aliyun_oss' | 's3_compatible';
  /** ISO; client re-requests a fresh URL if it'll lapse mid-upload. */
  expiresAt: string;
}

/**
 * `POST /aurora/media/confirm` — called AFTER the direct PUT lands. The
 * server verifies (never trusts) the bytes and only then mints the
 * MediaAsset row. The client sends back the exact `storageKey` it was
 * issued; `kind` re-asserts which feature this was (used to re-derive the
 * ownership scope + asset kind), and `contentType` is advisory only — the
 * persisted content-type is read from the storage HEAD, never this field.
 */
export const ConfirmUploadSchema = z.object({
  /** The exact key issued by upload-url; ownership + existence are verified. */
  storageKey: z.string().trim().min(1).max(1024),
  kind: UploadKindSchema,
  /** ADVISORY ONLY — the stored content-type comes from the HEAD, not this. */
  contentType: z.string().trim().min(1).max(128),
});
export type ConfirmUploadInputDto = z.infer<typeof ConfirmUploadSchema>;

export interface ConfirmUploadResponseDto {
  /** The active MediaAsset row — this is what the save call references. */
  mediaAssetId: string;
  /** Echoed back for the client's bookkeeping / debugging. */
  storageKey: string;
  provider: 'azure_blob' | 'aliyun_oss' | 's3_compatible';
  /** Browser/provider-fetchable URL resolved from the durable MediaAsset row. */
  url: string;
}

export const MediaProviderAssetStatusRequestSchema = z.object({
  assetIds: z.array(z.string().uuid()).max(100),
});
export type MediaProviderAssetStatusRequestDto = z.infer<
  typeof MediaProviderAssetStatusRequestSchema
>;

export interface MediaProviderAssetStatusDto {
  assetId: string;
  status: string;
  statusReason?: string | null;
  updatedAt: string;
}

export interface MediaProviderAssetStatusResponseDto {
  assets: MediaProviderAssetStatusDto[];
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
