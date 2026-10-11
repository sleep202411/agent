import { z } from "zod";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { appEnv } from "@/config/app-env";
import { getStoredString, setStoredString, deleteStoredString } from "@/lib/persistent-storage";
const id = z.string().uuid();
const scope = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const indicesSchema = z
  .array(z.number().int().min(0).max(99))
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length);
const receipt = z.object({
  taskIds: z
    .array(id)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const pdfPreviewSchema = z
  .object({
    id,
    createdAt: z.string().datetime({ offset: true }),
    status: z.enum(["queued", "analyzing", "ready", "applied", "failed"]),
    failure: z.object({ code: z.string(), message: z.string() }).nullish(),
    tasks: z
      .array(
        z.object({
          title: z.string().min(1).max(180),
          description: z.string().min(1).max(4000),
          category: z.enum([
            "scripts",
            "characters",
            "scenes",
            "props",
            "art",
            "music",
            "production",
            "finalEditing",
          ]),
          evidence: z.string().min(8).max(1000),
        })
      )
      .max(100),
    taskIds: z
      .array(id)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .refine((v) => !["ready", "applied"].includes(v.status) || v.tasks.length > 0);
export type PdfPreview = z.infer<typeof pdfPreviewSchema>;
export type PdfFile = DocumentPicker.DocumentPickerAsset;
export const pdfRecoverySchema = z.object({ id, indices: indicesSchema.optional() });
export type PdfRecovery = z.infer<typeof pdfRecoverySchema>;
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || getAuthGeneration() !== generation)
    throw new Error("Document import session expired");
}
function base(crewId: string, requestId: string) {
  return `/crews/${scope.parse(crewId)}/pdf-task-imports/${id.parse(requestId)}`;
}
function recoveryKey(crewId: string, userId: string) {
  return `pdf-tasks.${appEnv.appRegion}.${scope.parse(crewId)}.${scope.parse(userId)}`;
}
export async function loadPdfRecovery(crewId: string, userId: string): Promise<PdfRecovery | null> {
  const raw = await getStoredString(recoveryKey(crewId, userId));
  if (!raw) return null;
  try {
    return pdfRecoverySchema.parse(JSON.parse(raw));
  } catch {
    await deleteStoredString(recoveryKey(crewId, userId));
    return null;
  }
}
export async function savePdfRecovery(crewId: string, userId: string, value: PdfRecovery | null) {
  const key = recoveryKey(crewId, userId);
  if (value) await setStoredString(key, JSON.stringify(pdfRecoverySchema.parse(value)));
  else await deleteStoredString(key);
}
export function validatePdfFile(file: PdfFile) {
  if (
    !/\.(pdf|doc|docx)$/i.test(file.name) ||
    /[\r\n/\\]/.test(file.name) ||
    !file.size ||
    !Number.isSafeInteger(file.size) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Choose a nonempty PDF, DOC or DOCX up to 20 MB.");
  return file;
}
export async function pickPdfFile(generation: number) {
  current(generation);
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    multiple: false,
    copyToCacheDirectory: true,
  });
  current(generation);
  return result.canceled ? null : validatePdfFile(result.assets[0]!);
}
function preview(value: unknown, requestId: string) {
  const result = pdfPreviewSchema.parse(value);
  if (result.id !== requestId) throw new Error("Document analysis receipt does not match");
  return result;
}
export async function analyzePdf(
  crewId: string,
  requestId: string,
  file: PdfFile,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  validatePdfFile(file);
  const form = new FormData();
  if (Platform.OS === "web") {
    if (!file.file || file.file.size !== file.size) throw new Error("Document bytes changed");
    form.append("file", file.file, file.name);
  } else
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? "application/octet-stream",
    } as unknown as Blob);
  const result = await api.postFormData(`${base(crewId, requestId)}/analyze`, form, {
    service: "aurora",
    signal,
    timeout: 120_000,
  });
  current(generation, signal);
  return preview(result, requestId);
}
export async function fetchPdfPreview(
  crewId: string,
  requestId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  const result = await api.get(base(crewId, requestId), {
    service: "aurora",
    signal,
    retry: false,
  });
  current(generation, signal);
  return preview(result, requestId);
}
export async function applyPdfTasks(
  crewId: string,
  requestId: string,
  indices: number[],
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  const selection = indicesSchema
    .parse(indices)
    .slice()
    .sort((a, b) => a - b);
  const result = receipt.parse(
    await api.post(`${base(crewId, requestId)}/apply`, {
      service: "aurora",
      signal,
      data: { indices: selection },
    })
  );
  current(generation, signal);
  if (result.taskIds.length !== selection.length)
    throw new Error("Task creation receipt does not match the selection");
  return result;
}
