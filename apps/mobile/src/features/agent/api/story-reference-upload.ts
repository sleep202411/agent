import * as DocumentPicker from "expo-document-picker";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import {
  confirmMobileMediaUpload,
  uploadMobileMediaFile,
  type MediaConfirmation,
  type MobileUploadFile,
} from "@/lib/media-upload";
import { storyReferences, type ReferenceScope } from "./story-references-api";

const mime = ["image/jpeg", "image/png", "image/webp"] as const;
const id = z.string().uuid();
const checkpointSchema = z
  .object({
    clientKey: id,
    slotId: id,
    expectedSlotVersion: z.number().int().nonnegative(),
    name: z.string().min(1),
    confirmation: z
      .object({
        storageKey: z.string().min(1),
        kind: z.literal("ai_reference_image"),
        contentType: z.enum(mime),
        scope: z.object({ storyProjectId: id }).strict(),
      })
      .strict(),
  })
  .strict();
export type ReferenceUploadCheckpoint = z.infer<typeof checkpointSchema>;

/** Persist the uploaded object before confirmation; retry never uploads its bytes again. */
export function referenceUpload(
  scope: ReferenceScope,
  userId: string,
  storage: DurableRecord = durableRecord("story-reference-upload", userId, scope.projectId)
) {
  const schema = checkpointSchema.refine(
    (v) => v.confirmation.scope.storyProjectId === scope.projectId
  );
  const pending = pendingRequest(schema, scope.generation, storage);
  const references = storyReferences(scope);
  let busy = false;
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (getAuthGeneration() !== scope.generation) throw Error("Reference upload session expired.");
  };
  const owned = async <T>(signal: AbortSignal, action: () => Promise<T>) => {
    current(signal);
    if (busy) throw Error("A reference upload is already running.");
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  };
  const register = async (
    saved: ReferenceUploadCheckpoint,
    receipt: unknown,
    signal: AbortSignal
  ) => {
    current(signal);
    schema.parse(saved);
    const media = z.object({ mediaAssetId: id, variantId: id }).parse(receipt);
    const result = await references.addVersion(
      saved.slotId,
      {
        expectedSlotVersion: saved.expectedSlotVersion,
        assetId: media.mediaAssetId,
        variantId: media.variantId,
        source: "upload",
      },
      saved.clientKey,
      signal
    );
    current(signal);
    pending.clear(saved.clientKey);
    return result;
  };
  const upload = async (
    slotId: string,
    expectedSlotVersion: number,
    file: MobileUploadFile,
    signal: AbortSignal
  ) => {
    current(signal);
    if (pending.read())
      throw Error("Finish the pending reference upload before selecting another image.");
    id.parse(slotId);
    z.number().int().nonnegative().parse(expectedSlotVersion);
    const type = z.enum(mime).parse(file.type.toLowerCase());
    const name = file.name.trim();
    if (!name || !file.uri) throw Error("Selected image is unavailable.");
    const maxBytes = 30 * 1024 * 1024;
    if (
      file.size !== undefined &&
      (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maxBytes)
    )
      throw Error("Select a non-empty image no larger than 30 MiB.");
    const clientKey = uuid.v4();
    let saved: ReferenceUploadCheckpoint | undefined;
    const receipt = await uploadMobileMediaFile(
      { ...file, name, type },
      {
        kind: "ai_reference_image",
        maxBytes,
        signal,
        scope: { storyProjectId: scope.projectId },
        beforeConfirm: (confirmation: MediaConfirmation) => {
          current(signal);
          saved = schema.parse({ clientKey, slotId, expectedSlotVersion, name, confirmation });
          pending.save(saved);
        },
      }
    );
    if (!saved) throw Error("Reference upload recovery was not saved.");
    return register(saved, receipt, signal);
  };
  return {
    read: pending.read,
    clear: (key: string) => {
      if (busy) throw Error("Wait for the reference upload to finish.");
      pending.clear(key);
    },
    upload: (slotId: string, version: number, file: MobileUploadFile, signal: AbortSignal) =>
      owned(signal, () => upload(slotId, version, file, signal)),
    resume: (signal: AbortSignal) =>
      owned(signal, async () => {
        const saved = pending.read();
        if (!saved) throw Error("No reference upload is pending.");
        return register(saved, await confirmMobileMediaUpload(saved.confirmation, signal), signal);
      }),
    pick: (slotId: string, version: number, signal: AbortSignal) =>
      owned(signal, async () => {
        if (pending.read())
          throw Error("Finish the pending reference upload before selecting another image.");
        const picked = await DocumentPicker.getDocumentAsync({
          type: [...mime],
          multiple: false,
          copyToCacheDirectory: true,
          base64: false,
        });
        current(signal);
        if (picked.canceled) return null;
        if (picked.assets.length !== 1) throw Error("Select one image at a time.");
        const asset = picked.assets[0]!;
        return upload(
          slotId,
          version,
          {
            uri: asset.uri,
            name: asset.name,
            type: asset.file?.type || asset.mimeType || "",
            size: asset.file?.size ?? asset.size,
          },
          signal
        );
      }),
  };
}
