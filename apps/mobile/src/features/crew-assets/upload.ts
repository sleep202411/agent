import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { uploadMobileMediaFile } from "@/lib/media-upload";
import { fetchCrewAssetContext } from "./api";
export type CrewUpload = { source: "upload"; mediaAssetId: string; name: string };
export async function discardCrewUpload(crewId: string, mediaAssetId: string) {
  await api.delete(
    `/crews/${encodeURIComponent(crewId)}/assets/uploads/${encodeURIComponent(z.string().uuid().parse(mediaAssetId))}`,
    { service: "aurora" }
  );
}
export async function pickAndUploadCrewFile(
  crewId: string,
  signal: AbortSignal
): Promise<CrewUpload | null> {
  const context = await fetchCrewAssetContext(crewId, signal);
  signal.throwIfAborted();
  if (!context.storageAvailable || !context.capabilities.upload)
    throw new Error("Crew file uploads are not available");
  const picked = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  signal.throwIfAborted();
  if (picked.canceled || !picked.assets[0]) return null;
  const file = picked.assets[0];
  const name = file.name.trim();
  if (!name || name.length > 256 || name === "." || name === ".." || name.includes("/"))
    throw new Error("Invalid file name");
  if (
    file.size !== undefined &&
    (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > context.maxUploadBytes)
  )
    throw new Error("Selected file exceeds the allowed size or is empty");
  const result = await uploadMobileMediaFile(
    { uri: file.uri, name, type: file.mimeType || "application/octet-stream", size: file.size },
    { kind: "crew_asset_file", scope: { crewId }, signal, maxBytes: context.maxUploadBytes }
  );
  return { source: "upload", mediaAssetId: z.string().uuid().parse(result.mediaAssetId), name };
}
