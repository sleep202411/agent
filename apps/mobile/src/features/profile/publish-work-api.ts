import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/lib/api-client";
export type WorkTag = { id: number; name: string };
export async function getWorkTags(signal?: AbortSignal): Promise<WorkTag[]> {
  const raw = await api.get<{ all?: Record<string, unknown> }>("/vedio/type/tag/list", {
    service: "content",
    raw: true,
    signal,
  });
  if (!raw?.all || typeof raw.all !== "object" || Array.isArray(raw.all))
    throw new Error("Invalid tag list");
  return Object.entries(raw.all).flatMap(([key, name]) => {
    const id = Number(key);
    return Number.isSafeInteger(id) && id > 0 && typeof name === "string" && name.trim()
      ? [{ id, name }]
      : [];
  });
}
export async function createWork(
  input: { title: string; description: string; tagIds: number[] },
  signal?: AbortSignal
): Promise<string> {
  if (
    !input.title.trim() ||
    !input.description.trim() ||
    !input.tagIds.length ||
    input.tagIds.length > 5 ||
    input.tagIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error("Incomplete work information");
  const result = await api.post<{ id?: unknown }>("/vedio/create/personal/video", {
    service: "content",
    signal,
    data: {
      title: input.title.trim(),
      introduction: input.description.trim(),
      tags: [...new Set(input.tagIds)],
      viewStatus: 1,
    },
  });
  if (
    !result ||
    (typeof result.id !== "number" && typeof result.id !== "string") ||
    !String(result.id).trim()
  )
    throw new Error("Invalid created work ID");
  return String(result.id);
}
export class WorkFileError extends Error {}
export async function pickWorkFile(kind: "cover" | "video") {
  const result = await DocumentPicker.getDocumentAsync({
    type: kind === "cover" ? "image/*" : "video/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const mime = asset.file?.type || asset.mimeType || "";
  const size = asset.file?.size ?? asset.size;
  const max = kind === "cover" ? 10 * 1024 * 1024 : 5 * 1024 * 1024 * 1024;
  if (
    !mime.startsWith(kind === "cover" ? "image/" : "video/") ||
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > max
  )
    throw new WorkFileError("Invalid file type or size");
  return { ...asset, mimeType: mime };
}
export async function uploadWorkFile(
  id: string,
  kind: "cover" | "video",
  asset: NonNullable<Awaited<ReturnType<typeof pickWorkFile>>>,
  token: string,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const form = new FormData();
  form.append("id", id);
  if (Platform.OS === "web") {
    if (!asset.file) throw new WorkFileError("Missing browser file");
    form.append("file", asset.file, asset.name);
  } else
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType,
    } as unknown as Blob);
  // Legacy Java video handler still requires this body field in addition to normal auth.
  if (kind === "video") {
    if (!token) throw new Error("Authentication required");
    form.append("token", token);
  }
  await api.postFormData(
    kind === "cover" ? "/vedio/personal/uploadBanner" : "/vedio/upload/personal/video/backup",
    form,
    { service: "content", signal, timeout: 30 * 60 * 1000 }
  );
}

/** Preserve visibility and tags; this endpoint only edits the supplied fields. */
export async function updateWork(
  id: string,
  title: string,
  description: string,
  signal?: AbortSignal
) {
  if (!id.trim() || !title.trim() || !description.trim())
    throw new Error("Incomplete work information");
  await api.postForm(
    "/vedio/update/personal/video",
    { id, title: title.trim(), introduction: description.trim() },
    { service: "content", signal }
  );
}
