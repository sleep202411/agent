import * as DocumentPicker from "expo-document-picker";
import { getAuthGeneration } from "@/auth/auth-store";
import { uploadMobileMediaFile } from "@/lib/media-upload";
import { workspaceUploadedIcon } from "./workspace-icons";
const types = ["image/png", "image/jpeg", "image/webp"];
export async function pickWorkspaceIcon(generation: number, signal: AbortSignal) {
  const current = () => {
    signal.throwIfAborted();
    if (generation !== getAuthGeneration()) throw new Error("Workspace upload account changed.");
  };
  current();
  const result = await DocumentPicker.getDocumentAsync({
    type: types,
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  current();
  if (result.canceled) return null;
  if (result.assets.length !== 1) throw new Error("Select one workspace icon.");
  const asset = result.assets[0]!;
  const type = asset.file?.type || asset.mimeType || "";
  const size = asset.file?.size ?? asset.size;
  if (
    !types.includes(type) ||
    (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > 5 * 1024 * 1024))
  )
    throw new Error("Select a PNG, JPEG or WebP image up to 5 MB.");
  const uploaded = await uploadMobileMediaFile(
    { uri: asset.uri, name: asset.name, type, size },
    { kind: "workspace_icon", maxBytes: 5 * 1024 * 1024, signal }
  );
  current();
  return workspaceUploadedIcon.parse(uploaded.url);
}
