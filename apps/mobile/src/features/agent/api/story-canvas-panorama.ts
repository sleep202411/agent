import { z } from "zod";
import { api, type ApiBinaryResponse } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { readStoryCanvasDocument } from "./story-canvas-document";
import type { CanvasWriteScope } from "./story-canvas-update";
export type CanvasPanoramaSource = { url?: string; mediaAssetId?: string; title: string };
const limit = 32 * 1024 * 1024;
/** The isolated viewer receives image bytes only, never API tokens or cookies. */
export async function loadCanvasPanorama(
  scope: CanvasWriteScope,
  source: CanvasPanoramaSource,
  signal: AbortSignal
) {
  const current = () => {
    signal.throwIfAborted();
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  current();
  await readStoryCanvasDocument(scope, scope.documentId, signal);
  current();
  let binary: ApiBinaryResponse;
  if (source.mediaAssetId) {
    const id = z.string().uuid().parse(source.mediaAssetId);
    binary = await api.get<ApiBinaryResponse>(`/media/assets/${id}/content`, {
      service: "aurora",
      responseType: "binary",
      signal,
      retry: false,
    });
  } else {
    const url = new URL(z.string().url().parse(source.url));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw Error("Invalid panorama URL.");
    const response = await fetch(url.toString(), {
      signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw Error(`Panorama image request failed (${response.status}).`);
    if (Number(response.headers.get("content-length")) > limit)
      throw Error("Panorama image exceeds 32 MB.");
    binary = {
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") ?? "",
      disposition: null,
    };
  }
  current();
  const type = binary.contentType.split(";")[0]!.trim().toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type))
    throw Error("Panorama requires a JPEG, PNG or WebP image.");
  if (binary.bytes.byteLength > limit || !binary.bytes.byteLength)
    throw Error("Panorama image is empty or exceeds 32 MB.");
  const bytes = new Uint8Array(binary.bytes);
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return `data:${type};base64,${btoa(text)}`;
}
