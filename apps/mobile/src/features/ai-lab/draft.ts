import { skillSelection } from "./project-skills";
import { generationStorageKey, type GenerationStorageScope } from "./generation-scope";
import { z } from "zod";
import { durableRecord } from "@/lib/durable-record";
import { referenceCheckpoint } from "./reference-image";
import { generationSession } from "./jobs-api";
const draftSchema = z.object({
  mode: z.enum(["image", "video", "audio"]),
  presetId: z.string(),
  modelId: z.string(),
  schemaVersion: z.string(),
  values: z.record(z.string(), z.unknown()),
  upload: referenceCheckpoint.optional(),
  skillSelection: skillSelection.optional(),
  uploadedReferences: z
    .array(
      z.object({
        field: z.string(),
        mediaAssetId: z.string().uuid(),
        url: z.string().url(),
        fileName: z.string(),
        kind: z.enum(["image", "video", "audio"]).optional(),
        durationSeconds: z.number().finite().positive().optional(),
        bytes: z.number().int().positive().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      })
    )
    .optional(),
});
export type GenerationDraft = z.infer<typeof draftSchema>;
export function generationDraft(
  userId: string,
  generation: number,
  storageScope?: GenerationStorageScope
) {
  const store = durableRecord(
    "ai-lab-draft",
    userId,
    generationStorageKey(storageScope, "composer")
  );
  return {
    read() {
      generationSession(generation);
      const raw = store.read();
      return raw && raw !== "null" ? draftSchema.parse(JSON.parse(raw)) : null;
    },
    save(value: GenerationDraft) {
      generationSession(generation);
      store.write(JSON.stringify(draftSchema.parse(value)));
    },
    clear() {
      generationSession(generation);
      store.write("null");
    },
  };
}
