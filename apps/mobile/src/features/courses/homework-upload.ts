import * as DocumentPicker from "expo-document-picker";
import { getAuthGeneration } from "@/auth/auth-store";
import { uploadMobileMediaFile } from "@/lib/media-upload";
export async function pickHomework(signal: AbortSignal) {
  const generation = getAuthGeneration();
  signal.throwIfAborted();
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/jpeg", "image/png"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Academy account changed");
  if (picked.canceled || !picked.assets[0]) return null;
  const file = picked.assets[0];
  const formats: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  const type = formats[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) throw new Error("Choose a PDF, JPG or PNG file.");
  const uploaded = await uploadMobileMediaFile(
    { uri: file.uri, name: file.name, type, size: file.size },
    {
      signal,
      kind: type.startsWith("image/") ? "agent_attachment_image" : "agent_attachment_document",
    }
  );
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Academy account changed");
  return { id: uploaded.mediaAssetId, name: file.name };
}
