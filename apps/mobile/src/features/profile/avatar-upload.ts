import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/lib/api-client";

export class AvatarValidationError extends Error {}
const MAX_BYTES = 5 * 1024 * 1024;
/** Upload commits immediately, as on Web; cancellation never submits a mutation. */
export async function pickAndUploadAvatar(current: () => boolean, signal: AbortSignal) {
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
  if (size !== undefined && size > MAX_BYTES) throw new AvatarValidationError();
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
    size > MAX_BYTES
  ) {
    throw new AvatarValidationError();
  }
  const form = new FormData();
  if (Platform.OS === "web") form.append("file", blob!, asset.name);
  else form.append("file", { uri: asset.uri, name: asset.name, type: mime } as unknown as Blob);
  await api.postFormData("/user/uploadAratar", form, { service: "content", signal });
  return true;
}
