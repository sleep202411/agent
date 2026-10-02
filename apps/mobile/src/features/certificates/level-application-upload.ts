import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";

const formats: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  pdf: "application/pdf",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
/** The same attachment formats as the active Web certification application. */
export async function pickLevelApplicationAttachment(generation: number, signal: AbortSignal) {
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Certification attachment session expired or request cancelled.");
  };
  current();
  const result = await DocumentPicker.getDocumentAsync({
    type: [...new Set(Object.values(formats))],
    multiple: false,
    copyToCacheDirectory: true,
  });
  current();
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error("No attachment was selected.");
  const expected = formats[asset.name.split(".").pop()?.toLowerCase() ?? ""];
  const reported = asset.file?.type || asset.mimeType;
  const size = asset.file?.size ?? asset.size;
  if (
    !expected ||
    (reported && reported !== "application/octet-stream" && reported !== expected) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0
  )
    throw new Error("Choose a JPG, PNG, GIF, PDF, ZIP, DOC or DOCX attachment with a valid size.");
  const form = new FormData();
  if (Platform.OS === "web") {
    if (!asset.file) throw new Error("Missing browser attachment.");
    form.append("file", asset.file, asset.name);
  } else {
    if (!/^(file|content):\/\//.test(asset.uri)) throw new Error("Invalid local attachment.");
    form.append("file", { uri: asset.uri, name: asset.name, type: expected } as unknown as Blob);
  }
  const path = await api.postFormData("/user/levels/apply/upload", form, {
    service: "content",
    signal,
    retry: false,
  });
  current();
  return { name: asset.name, path: z.string().trim().min(1).parse(path) };
}
