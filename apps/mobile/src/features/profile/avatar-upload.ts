import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/lib/api-client";

export class AvatarValidationError extends Error {}
export type ProfileImageKind = "avatar" | "banner";
/** Upload commits immediately, as on Web; cancellation never submits a mutation. */
export async function pickAndUploadProfileImage(
  current: () => boolean,
  signal: AbortSignal,
  kind: ProfileImageKind = "avatar"
) {
  const maxBytes = (kind === "banner" ? 10 : 5) * 1024 * 1024;
  const result = await DocumentPicker.getDocumentAsync({
    type: "image/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (!current() || signal.aborted || result.canceled) return false;
  const asset = result.assets[0];
  if (!asset) return false;
  let mime = asset.file?.type || asset.mimeType || "";
  let size = asset.file?.size ?? asset.size;
  let blob = asset.file as Blob | undefined;
  if (size !== undefined && size > maxBytes) throw new AvatarValidationError();
  if (Platform.OS === "web" || size === undefined || !mime) {
    blob ??= await (await fetch(asset.uri, { signal })).blob();
    size = blob.size;
    mime = blob.type || mime;
  }
  if (!current() || signal.aborted) return false;
  if (
    !mime.startsWith("image/") ||
    !Number.isFinite(size) ||
    !size ||
    size < 0 ||
    size > maxBytes
  ) {
    throw new AvatarValidationError();
  }
  const form = new FormData();
  if (Platform.OS === "web") form.append("file", blob!, asset.name);
  else form.append("file", { uri: asset.uri, name: asset.name, type: mime } as unknown as Blob);
  const path = await api.postFormData<string>(
    kind === "banner" ? "/project/uploadBanner" : "/user/uploadAratar",
    form,
    { service: "content", signal }
  );
  if (kind === "banner") {
    if (!current() || signal.aborted) return false;
    if (typeof path !== "string" || !path.trim()) throw new Error("Invalid banner upload response");
    await api.post("/user/update/user/info", {
      service: "content",
      signal,
      data: { banner: path },
    });
  }
  return true;
}
