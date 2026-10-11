import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const maxBytes = 10 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  md: "text/markdown",
};
export async function analyzeIpDocument(generation: number, signal: AbortSignal) {
  const current = () => {
    signal.throwIfAborted();
    if (generation !== getAuthGeneration()) throw new Error("IP analysis session expired.");
  };
  current();
  const picked = await DocumentPicker.getDocumentAsync({
    type: Object.values(mimeTypes),
    multiple: false,
    copyToCacheDirectory: true,
  });
  current();
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (picked.assets.length !== 1 || !asset?.uri) throw new Error("Select one document.");
  const type = mimeTypes[asset.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) throw new Error("Select a PDF, DOCX, DOC, TXT or MD document.");
  let size = asset.file?.size ?? asset.size;
  let blob: Blob | undefined = asset.file;
  if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes))
    throw new Error("Select a non-empty document no larger than 10 MiB.");
  if (Platform.OS === "web" || size === undefined) {
    blob ??= await (await fetch(asset.uri, { signal })).blob();
    size = blob.size;
  }
  current();
  if (!Number.isSafeInteger(size) || !size || size > maxBytes)
    throw new Error("Select a non-empty document no larger than 10 MiB.");
  const form = new FormData();
  if (Platform.OS === "web") form.append("file", blob!, asset.name);
  else form.append("file", { uri: asset.uri, name: asset.name, type } as unknown as Blob);
  const draft = z.object({ name: z.string().optional(), description: z.string().optional() }).parse(
    await api.postFormData("/spark/analyze", form, {
      service: "aurora",
      signal,
      retry: false,
      timeout: 300_000,
    })
  );
  current();
  return { ...draft, fileName: asset.name };
}
