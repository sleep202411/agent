import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { CanvasWriteScope } from "./story-canvas-update";
import type { CanvasLibraryAsset } from "../lib/story-canvas-overview";
import { readStoryCanvasDocument } from "./story-canvas-document";
function mediaUrl(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw Error("Invalid canvas media URL.");
  return url.href;
}
/** Call with the asset from a freshly materialized document, not a cached row. */
export async function loadCanvasMediaAccess(
  scope: CanvasWriteScope,
  asset: CanvasLibraryAsset,
  signal: AbortSignal
): Promise<{ url: string; expiresAt: string | null }> {
  const current = () => {
    signal.throwIfAborted();
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  current();
  await readStoryCanvasDocument(scope, scope.documentId, signal);
  current();
  if (!asset.mediaAssetId) return { url: mediaUrl(asset.url), expiresAt: null };
  const id = z.string().uuid().parse(asset.mediaAssetId);
  const access = z
    .object({
      assetId: z.literal(id),
      variantKey: z.literal("original"),
      url: z.string().url(),
      expiresAt: z.string().datetime({ offset: true }).nullable(),
    })
    .parse(
      await api.get(`/media/assets/${id}/access`, {
        service: "aurora",
        signal,
        retry: false,
        params: { variantKey: "original", documentId: scope.documentId },
      })
    );
  current();
  if (access.expiresAt && Date.parse(access.expiresAt) <= Date.now())
    throw Error("Media access has expired; retry to refresh it.");
  return { url: mediaUrl(access.url), expiresAt: access.expiresAt };
}
