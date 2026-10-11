import { z } from "zod";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { selectedMedia } from "@/features/ip-author/selected-media";
import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
import {
  loadAgentWorkspaces,
  canCreateStudioProject,
} from "@/features/agent/api/studio-projects-api";
import { generationSession } from "./jobs-api";
import { loadLibraryCharacter, libraryDetail, type LibraryDetail } from "./character-library-api";
const id = z.string().uuid();
export const mediaKind = z.enum(["image", "video", "audio"]);
export type CharacterMediaKind = z.infer<typeof mediaKind>;
export const CHARACTER_MEDIA_CAPS = { image: 9, video: 3, audio: 3 };
const formats = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/x-wav"],
};
const limits = { image: 30 * 1024 ** 2, video: 2 * 1024 ** 3, audio: 15 * 1024 ** 2 };
const scope = { workspaceId: id, characterId: id };
const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cover"), assetId: id.nullable() }),
  z.object({ kind: z.literal("remove"), mediaId: id }),
  z.object({ kind: z.literal("order"), order: z.array(id).min(1).max(15) }),
  z.object({ kind: z.literal("attach"), assetId: id, mediaKind }),
]);
export type CharacterMediaAction = z.infer<typeof action>;
const snapshot = (detail: LibraryDetail) => ({
  status: detail.status,
  coverAssetId: detail.coverAssetId,
  media: detail.media
    .map(({ id, mediaAssetId, mediaKind, sortOrder }) => ({
      id,
      mediaAssetId,
      mediaKind,
      sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
});
const snapshotSchema = z.object({
  status: libraryDetail.shape.status,
  coverAssetId: id.nullable(),
  media: z.array(z.object({ id, mediaAssetId: id, mediaKind, sortOrder: z.number().int() })),
});
const command = z.object({ ...scope, clientKey: id, before: snapshotSchema, action });
export type CharacterMediaCommand = z.infer<typeof command>;
export const characterMediaBox = (user: string, generation: number, characterId: string) =>
  pendingRequest(
    command,
    generation,
    durableRecord("character-media", user, id.parse(characterId))
  );
export function prepareCharacterMedia(
  detail: LibraryDetail,
  change: CharacterMediaAction,
  clientKey: string
) {
  const before = snapshot(detail),
    a = action.parse(change);
  if (
    a.kind === "cover" &&
    a.assetId !== null &&
    !before.media.some((m) => m.mediaAssetId === a.assetId && m.mediaKind === "image")
  )
    throw Error("Select an attached image as the cover.");
  if (a.kind === "remove" && !before.media.some((m) => m.id === a.mediaId))
    throw Error("This media is no longer attached.");
  if (
    a.kind === "order" &&
    (new Set(a.order).size !== before.media.length ||
      a.order.length !== before.media.length ||
      a.order.some((i) => !before.media.some((m) => m.id === i)))
  )
    throw Error("Reordering requires the complete media list.");
  if (
    a.kind === "attach" &&
    (before.media.some((m) => m.mediaAssetId === a.assetId) ||
      before.media.filter((m) => m.mediaKind === a.mediaKind).length >=
        CHARACTER_MEDIA_CAPS[a.mediaKind])
  )
    throw Error("This media is already attached or its reference limit is reached.");
  return command.parse({
    workspaceId: detail.workspaceId,
    characterId: detail.id,
    clientKey,
    before,
    action: a,
  });
}
async function editable(
  workspaceId: string,
  characterId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const w = (await loadAgentWorkspaces(signal)).find((w) => w.id === workspaceId);
  generationSession(generation, signal);
  if (!w || !canCreateStudioProject(w)) throw Error("Workspace editor permission is required.");
  const d = await loadLibraryCharacter(workspaceId, characterId, generation, signal);
  if (["disabled", "revoked"].includes(d.status)) throw Error("This character cannot be modified.");
  return d;
}
function matches(d: LibraryDetail, a: CharacterMediaAction) {
  if (a.kind === "cover") return d.coverAssetId === a.assetId;
  if (a.kind === "remove") return !d.media.some((m) => m.id === a.mediaId);
  if (a.kind === "attach")
    return d.media.some((m) => m.mediaAssetId === a.assetId && m.mediaKind === a.mediaKind);
  return JSON.stringify(snapshot(d).media.map((m) => m.id)) === JSON.stringify(a.order);
}
export async function submitCharacterMedia(
  value: CharacterMediaCommand,
  user: string,
  generation: number,
  signal: AbortSignal
) {
  const intent = command.parse(value),
    box = characterMediaBox(user, generation, intent.characterId);
  generationSession(generation, signal);
  if (box.read()) throw Error("Review the original media change before making another request.");
  const fresh = await editable(intent.workspaceId, intent.characterId, generation, signal);
  if (JSON.stringify(snapshot(fresh)) !== JSON.stringify(intent.before))
    throw Error("The media changed. Refresh and confirm again.");
  prepareCharacterMedia(fresh, intent.action, intent.clientKey);
  box.save(intent);
  const base = `/characters/${intent.characterId}`,
    options = { service: "aurora" as const, signal, retry: false },
    a = intent.action;
  const raw =
    a.kind === "cover"
      ? await api.patch(base, { ...options, data: { coverAssetId: a.assetId } })
      : a.kind === "order"
        ? await api.patch(`${base}/media`, { ...options, data: { order: a.order } })
        : a.kind === "remove"
          ? await api.delete(`${base}/media/${a.mediaId}`, options)
          : await api.post(`${base}/media`, { ...options, data: { mediaAssetId: a.assetId } });
  const receipt = libraryDetail.parse(raw);
  generationSession(generation, signal);
  if (
    receipt.id !== intent.characterId ||
    receipt.workspaceId !== intent.workspaceId ||
    !matches(receipt, a)
  )
    throw Error("The media receipt does not match your request. Review current media.");
  box.clear(intent.clientKey);
  return receipt;
}
/** Read-only reconciliation proves current desired state, not which client caused it. */
export async function reconcileCharacterMedia(
  user: string,
  generation: number,
  characterId: string,
  signal: AbortSignal
) {
  const box = characterMediaBox(user, generation, characterId),
    intent = box.read();
  if (!intent) return null;
  const d = await loadLibraryCharacter(intent.workspaceId, characterId, generation, signal);
  if (!matches(d, intent.action))
    throw Error(
      "The media result is still uncertain. Review the current library before clearing the local record."
    );
  box.clear(intent.clientKey);
  return d;
}
const uploaded = z.object({
  ...scope,
  clientKey: id,
  kind: mediaKind,
  fileName: z.string().min(1),
  storageKey: z.string().min(1),
  contentType: z.string(),
  assetId: id.optional(),
});
export type CharacterUpload = z.infer<typeof uploaded>;
export function characterUploadStore(user: string, generation: number, characterId: string) {
  const record = durableRecord("character-media-upload", user, id.parse(characterId));
  const guard = () => generationSession(generation, new AbortController().signal);
  const read = () => {
    guard();
    const raw = record.read();
    return raw === null
      ? null
      : z.object({ version: z.literal(1), upload: uploaded.nullable() }).parse(JSON.parse(raw))
          .upload;
  };
  return {
    read,
    save: (value: CharacterUpload) => {
      guard();
      const v = uploaded.parse(value),
        old = read();
      if (
        v.characterId !== characterId ||
        (old && (old.clientKey !== v.clientKey || old.storageKey !== v.storageKey))
      )
        throw Error("Another character upload needs review.");
      record.write(JSON.stringify({ version: 1, upload: v }));
    },
    clear: (key: string) => {
      guard();
      const old = read();
      if (old && old.clientKey !== key) throw Error("Another character upload needs review.");
      record.write(JSON.stringify({ version: 1, upload: null }));
    },
  };
}
const https = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password;
  });
export async function uploadCharacterMedia(
  workspaceId: string,
  characterId: string,
  kind: CharacterMediaKind,
  user: string,
  generation: number,
  clientKey: string,
  signal: AbortSignal
) {
  mediaKind.parse(kind);
  const store = characterUploadStore(user, generation, characterId);
  if (store.read() || characterMediaBox(user, generation, characterId).read())
    throw Error("Review the pending media request first.");
  const fresh = await editable(workspaceId, characterId, generation, signal);
  if (fresh.kind === "real_person" && fresh.status !== "active")
    throw Error("Complete identity verification before adding media.");
  if (fresh.media.filter((m) => m.mediaKind === kind).length >= CHARACTER_MEDIA_CAPS[kind])
    throw Error("The character reference limit is reached.");
  const picked = await DocumentPicker.getDocumentAsync({
    type: formats[kind],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  generationSession(generation, signal);
  if (picked.canceled) return null;
  const file = picked.assets[0];
  if (picked.assets.length !== 1 || !file?.uri || !file.name.trim())
    throw Error("Select one media file.");
  const reported = (file.file?.type || file.mimeType)?.toLowerCase(),
    fallback: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      mp3: "audio/mpeg",
      wav: "audio/wav",
    };
  const contentType =
    reported && reported !== "application/octet-stream"
      ? (({ "audio/mp3": "audio/mpeg", "audio/wave": "audio/wav" } as Record<string, string>)[
          reported
        ] ?? reported)
      : fallback[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!formats[kind].includes(contentType)) throw Error("Unsupported character media format.");
  const media = await selectedMedia(file.uri, signal);
  generationSession(generation, signal);
  if (!Number.isSafeInteger(media.size) || media.size <= 0 || media.size > limits[kind])
    throw Error(`Choose a non-empty ${kind} file up to ${limits[kind] / 1024 ** 2} MiB.`);
  // Picking may take time: recheck permission and target before starting storage work.
  await editable(workspaceId, characterId, generation, signal);
  const signed = z
    .object({
      uploadUrl: https,
      method: z.literal("PUT"),
      headers: z.record(z.string(), z.string()),
      storageKey: z.string().min(1),
    })
    .parse(
      await api.post("/media/upload-url", {
        service: "aurora",
        signal,
        retry: false,
        headers: { "x-fizz-workspace-id": workspaceId },
        data: {
          kind: `ai_reference_${kind}`,
          contentType,
          fileName: file.name,
          sizeBytes: media.size,
        },
      })
    );
  generationSession(generation, signal);
  if (
    Object.keys(signed.headers).some((k) => /^(authorization|cookie|proxy-authorization)$/i.test(k))
  )
    throw Error("Storage upload must not include login credentials.");
  const result = await media.put(
    signed.uploadUrl,
    { "Content-Type": contentType, ...signed.headers },
    signal
  );
  generationSession(generation, signal);
  if (!result.ok) throw Error(`Character upload failed: HTTP ${result.status}`);
  const checkpoint = uploaded.parse({
    workspaceId,
    characterId,
    kind,
    clientKey,
    fileName: file.name,
    storageKey: signed.storageKey,
    contentType,
  });
  store.save(checkpoint);
  return checkpoint;
}
export async function finishCharacterUpload(
  user: string,
  generation: number,
  characterId: string,
  signal: AbortSignal
) {
  const store = characterUploadStore(user, generation, characterId);
  let checkpoint = store.read();
  if (!checkpoint) throw Error("No uploaded media to resume.");
  await editable(checkpoint.workspaceId, characterId, generation, signal);
  if (!checkpoint.assetId) {
    const receipt = z.object({ mediaAssetId: id, storageKey: z.string().min(1) }).parse(
      await api.post("/media/confirm", {
        service: "aurora",
        signal,
        retry: false,
        headers: { "x-fizz-workspace-id": checkpoint.workspaceId },
        data: {
          storageKey: checkpoint.storageKey,
          kind: `ai_reference_${checkpoint.kind}`,
          contentType: checkpoint.contentType,
        },
      })
    );
    generationSession(generation, signal);
    if (checkpoint.kind !== "image" && receipt.storageKey !== checkpoint.storageKey)
      throw Error("Media confirmation scope mismatch.");
    checkpoint = { ...checkpoint, assetId: receipt.mediaAssetId };
    store.save(checkpoint);
  }
  const box = characterMediaBox(user, generation, characterId),
    pending = box.read();
  if (pending) {
    if (pending.action.kind !== "attach" || pending.action.assetId !== checkpoint.assetId)
      throw Error("Another media change needs review.");
    const d = await reconcileCharacterMedia(user, generation, characterId, signal);
    store.clear(checkpoint.clientKey);
    return d;
  }
  const fresh = await editable(checkpoint.workspaceId, characterId, generation, signal);
  if (
    fresh.media.some(
      (m) => m.mediaAssetId === checkpoint.assetId && m.mediaKind === checkpoint.kind
    )
  ) {
    store.clear(checkpoint.clientKey);
    return fresh;
  }
  const d = await submitCharacterMedia(
    prepareCharacterMedia(
      fresh,
      { kind: "attach", assetId: checkpoint.assetId!, mediaKind: checkpoint.kind },
      checkpoint.clientKey
    ),
    user,
    generation,
    signal
  );
  store.clear(checkpoint.clientKey);
  return d;
}
export async function previewCharacterMedia(
  workspaceId: string,
  characterId: string,
  mediaId: string,
  generation: number,
  signal: AbortSignal
) {
  const d = await loadLibraryCharacter(workspaceId, characterId, generation, signal),
    m = d.media.find((m) => m.id === mediaId);
  if (!m) throw Error("This media is no longer attached.");
  const access = await fetchCrewAssetAccess(m.mediaAssetId, signal);
  generationSession(generation, signal);
  return { url: access.url, kind: m.mediaKind };
}
