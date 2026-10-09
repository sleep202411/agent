import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid(),
  version = z.number().int().nonnegative();
export const templateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  modelId: z.string().trim().min(1).max(120),
  promptPrefix: z.string().trim().max(2000),
  promptSuffix: z.string().trim().max(2000),
  requireReferenceImage: z.boolean(),
  referenceImageHint: z.string().trim().max(200),
  outputAspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
  logoAssetId: id.nullable(),
  enabled: z.boolean(),
  order: z.number().int(),
});
export type GenerationTemplate = z.infer<typeof templateSchema>;
const unique = (items: { id: string }[]) => new Set(items.map((t) => t.id)).size === items.length;
const templates = z.array(templateSchema).max(50).refine(unique, "Template IDs must be unique.");
const snapshotSchema = z.object({ version, templates });
export type TemplatesSnapshot = z.infer<typeof snapshotSchema>;
export const templatesCommand = z.object({ clientKey: id, expectedVersion: version, templates });
export type TemplatesCommand = z.infer<typeof templatesCommand>;
export const logoCheckpoint = z.object({
  templateId: id,
  fileName: z.string().min(1),
  storageKey: z.string().min(1),
  kind: z.literal("ip_banner"),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
export type LogoCheckpoint = z.infer<typeof logoCheckpoint>;
const draftSchema = z
  .object({
    version,
    templates: z
      .array(
        templateSchema.extend({
          name: z.string().max(120),
          description: z.string().max(500),
          promptPrefix: z.string().max(2000),
          promptSuffix: z.string().max(2000),
          referenceImageHint: z.string().max(200),
        })
      )
      .max(50)
      .refine(unique),
    logo: logoCheckpoint.nullable(),
  })
  .refine(
    (value) => !value.logo || value.templates.some((t) => t.id === value.logo!.templateId),
    "Logo target is missing."
  );
export type TemplatesDraft = z.infer<typeof draftSchema>;
export function templateSession(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Template session expired.");
}
export function templatesDraft(ipId: string, userId: string, generation: number) {
  const storage = durableRecord("ip-generation-draft", userId, id.parse(ipId));
  return {
    read() {
      templateSession(generation);
      const raw = storage.read();
      return raw && raw !== "null" ? draftSchema.parse(JSON.parse(raw)) : null;
    },
    save(value: TemplatesDraft) {
      templateSession(generation);
      storage.write(JSON.stringify(draftSchema.parse(value)));
    },
    clear() {
      templateSession(generation);
      storage.write("null");
    },
  };
}
export function templatesOutbox(ipId: string, userId: string, generation: number) {
  return pendingRequest(
    templatesCommand,
    generation,
    durableRecord("ip-generation-save", userId, id.parse(ipId))
  );
}
const path = (ipId: string) => `/ip-commerce/me/ips/${id.parse(ipId)}/generation-templates`;
export async function fetchTemplates(ipId: string, generation: number, signal: AbortSignal) {
  templateSession(generation, signal);
  const result = snapshotSchema.parse(
    await api.get(path(ipId), { service: "aurora", signal, retry: false })
  );
  templateSession(generation, signal);
  return result;
}
export async function fetchTemplateModels(generation: number, signal: AbortSignal) {
  templateSession(generation, signal);
  // Fetch each session; model access/catalogs differ by account and region.
  const result = z
    .object({
      models: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string(),
          type: z.string(),
          enabled: z.boolean().optional(),
          access: z.object({ allowed: z.boolean().optional() }).optional(),
        })
      ),
    })
    .parse(await api.get("/ai/models", { service: "aurora", signal, retry: false }));
  templateSession(generation, signal);
  return result.models.filter(
    (m) => ["image", "video"].includes(m.type) && m.enabled !== false && m.access?.allowed !== false
  );
}
export type TemplateModel = Awaited<ReturnType<typeof fetchTemplateModels>>[number];
export async function saveTemplates(
  ipId: string,
  userId: string,
  generation: number,
  input: TemplatesCommand,
  signal: AbortSignal
) {
  templateSession(generation, signal);
  const command = templatesCommand.parse(input),
    box = templatesOutbox(ipId, userId, generation);
  box.save(command);
  const latest = await fetchTemplates(ipId, generation, signal);
  const matches = (value: TemplatesSnapshot) =>
    value.version === command.expectedVersion + 1 &&
    JSON.stringify(value.templates) === JSON.stringify(command.templates);
  // A complete versioned readback can establish the requested configuration without another write.
  if (matches(latest)) {
    box.clear(command.clientKey);
    return latest;
  }
  if (latest.version !== command.expectedVersion)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "This IP changed. Refresh and review the current templates before replacing your draft.",
      409
    );
  templateSession(generation, signal);
  if (JSON.stringify(box.read()) !== JSON.stringify(command))
    throw new Error("Pending template changes changed.");
  const saved = snapshotSchema.parse(
    await api.put(path(ipId), {
      service: "aurora",
      signal,
      retry: false,
      data: { templates: command.templates, expectedVersion: command.expectedVersion },
    })
  );
  templateSession(generation, signal);
  if (!matches(saved))
    throw new Error("Template save receipt mismatch. Retry to check the current configuration.");
  box.clear(command.clientKey);
  return saved;
}
