import { z } from "zod";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { EPISODE_SOURCE_MAX_BYTES } from "@repo/shared";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecordKey } from "@/lib/durable-record-key";
import { fetchAuthorEpisodes } from "./episodes-api";
export type EpisodeVideoSource = {
  name: string;
  size: number;
  contentType: "video/mp4" | "video/quicktime" | "video/webm";
  read: (offset: number, length: number) => Promise<Uint8Array>;
};
const uuid = z.string().uuid();
const size = z.number().int().positive().max(EPISODE_SOURCE_MAX_BYTES);
export const episodeUploadCheckpointSchema = z
  .object({
    version: z.literal(1),
    id: uuid,
    scope: z.string(),
    fileName: z.string().trim().min(1).max(256),
    sizeBytes: size,
    contentType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
    partSize: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 ** 2)
      .optional(),
    hashes: z.record(z.string().regex(/^[1-9]\d*$/), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict();
export type EpisodeUploadCheckpoint = z.infer<typeof episodeUploadCheckpointSchema>;
const sessionSchema = z.object({
  id: uuid,
  partSize: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 ** 2),
  sizeBytes: size,
  expiresAt: z.string().datetime({ offset: true }),
  uploaded: z.boolean(),
  parts: z.array(
    z.object({ number: z.number().int().positive(), sizeBytes: z.number().int().positive() })
  ),
});
const secureUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "Invalid upload URL");
const uploadResult = z.object({
  mediaAssetId: uuid,
  storageKey: z.string().min(1),
  url: secureUrl.nullable(),
});
export type EpisodeUploadResult = z.infer<typeof uploadResult>;
export function createEpisodeUploadCheckpoint(
  id: string,
  ipId: string,
  userId: string,
  source: EpisodeVideoSource
): EpisodeUploadCheckpoint {
  uuid.parse(ipId);
  if (!userId) throw new Error("Sign in to upload a episode video");
  return episodeUploadCheckpointSchema.parse({
    version: 1,
    id,
    scope: durableRecordKey("ip-episode-upload", userId, ipId),
    fileName: source.name,
    sizeBytes: source.size,
    contentType: source.contentType,
    hashes: {},
  });
}
/** Persist before each network mutation. Server-confirmed parts are skipped only after verifying their saved hash against the reselected file. */
export async function uploadEpisodeVideo(
  source: EpisodeVideoSource,
  options: {
    ipId: string;
    userId: string;
    generation: number;
    checkpoint: EpisodeUploadCheckpoint;
    signal: AbortSignal;
    persist: (checkpoint: EpisodeUploadCheckpoint) => Promise<void>;
    onProgress?: (percent: number) => void;
  }
): Promise<EpisodeUploadResult> {
  const { ipId, userId, generation, signal, persist } = options;
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Episode upload session expired");
  };
  current();
  let checkpoint = episodeUploadCheckpointSchema.parse(options.checkpoint);
  const expected = createEpisodeUploadCheckpoint(checkpoint.id, ipId, userId, source);
  if (
    checkpoint.scope !== expected.scope ||
    checkpoint.fileName !== expected.fileName ||
    checkpoint.sizeBytes !== expected.sizeBytes ||
    checkpoint.contentType !== expected.contentType
  )
    throw new Error("Select the original video in its original account and IP");
  await fetchAuthorEpisodes(ipId, generation, signal);
  current();
  const config = {
    service: "aurora" as const,
    signal,
    retry: false,
    timeout: 180_000,
  };
  await persist(checkpoint);
  current();
  const session = sessionSchema.parse(
    await api.post("/media/episode-uploads", {
      ...config,
      data: {
        id: checkpoint.id,
        fileName: checkpoint.fileName,
        contentType: checkpoint.contentType,
        sizeBytes: checkpoint.sizeBytes,
        kind: "episode_source_video",
      },
    })
  );
  current();
  const count = Math.ceil(source.size / session.partSize);
  if (
    session.id !== checkpoint.id ||
    session.sizeBytes !== source.size ||
    (checkpoint.partSize !== undefined && checkpoint.partSize !== session.partSize) ||
    new Set(session.parts.map((p) => p.number)).size !== session.parts.length ||
    session.parts.some(
      (p) =>
        p.number > count ||
        p.sizeBytes !== Math.min(session.partSize, source.size - (p.number - 1) * session.partSize)
    ) ||
    Object.keys(checkpoint.hashes).some((n) => Number(n) > count)
  )
    throw new Error("Invalid episode upload session");
  // Expiry and completed-session recovery are decided by the authenticated Server.
  checkpoint = { ...checkpoint, partSize: session.partSize };
  await persist(checkpoint);
  current();
  const stored = new Map(session.parts.map((p) => [p.number, p.sizeBytes]));
  let completedBytes = 0;
  options.onProgress?.(0);
  for (let number = 1; number <= count; number++) {
    current();
    const offset = (number - 1) * session.partSize,
      length = Math.min(session.partSize, source.size - offset);
    const bytes = await source.read(offset, length);
    current();
    if (bytes.length !== length) throw new Error("Selected video changed or could not be read");
    const digest = bytesToHex(sha256(bytes)),
      previous = checkpoint.hashes[number];
    if ((previous && previous !== digest) || (session.uploaded && !previous))
      throw new Error("Cannot verify the original video. Select the original file to resume");
    checkpoint = { ...checkpoint, hashes: { ...checkpoint.hashes, [number]: digest } };
    await persist(checkpoint);
    current();
    if (!session.uploaded && !(previous === digest && stored.get(number) === length)) {
      const signed = z
        .object({ url: secureUrl, headers: z.record(z.string(), z.string()) })
        .parse(await api.post(`/media/episode-uploads/${checkpoint.id}/parts/${number}`, config));
      current();
      if (
        Object.keys(signed.headers).some((name) =>
          /^(authorization|proxy-authorization|cookie|satoken)$/i.test(name)
        )
      )
        throw new Error("Unsafe upload headers");
      await putEpisodePart(signed, bytes, signal);
      current();
    }
    completedBytes += length;
    options.onProgress?.(Math.floor((completedBytes / source.size) * 100));
  }
  current();
  const result = uploadResult.parse(
    await api.post(`/media/episode-uploads/${checkpoint.id}/complete`, config)
  );
  current();
  return result;
}
export async function putEpisodePart(
  signed: { url: string; headers: Record<string, string> },
  bytes: Uint8Array,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15 * 60_000);
  try {
    const response = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: new Uint8Array(bytes).buffer,
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`Video part upload failed (HTTP ${response.status})`);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
