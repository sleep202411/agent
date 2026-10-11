import { z } from "zod";
import type { GenerationModel } from "@/features/ai-lab/catalog-api";

const priority = {
  image: ["image_to_image"],
  video: ["multimodal_to_video", "image_to_video", "first_last_frame_to_video", "video_to_video"],
  audio: ["text_to_audio", "audio_to_audio"],
};
const setting = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.unknown())]);
const property = z
  .object({
    type: z.string(),
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    "x-ui": z
      .object({
        control: z.string().optional(),
        group: z.string().optional(),
        options: z.array(z.object({ value: z.unknown() }).passthrough()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Web canvasDefaultModel/canvasDefaultMode/defaultSettingsForModel policy.
 * Uses the current workspace catalog access result, never historical IDs or
 * Agent/Timeline project preferences (those are different workflows). */
export function canvasGenerationDefaults(
  models: readonly GenerationModel[],
  kind: keyof typeof priority
) {
  const available = models.filter(
    (model) => model.type === kind && model.enabled && model.access?.allowed !== false
  );
  if (new Set(available.map((model) => model.id)).size !== available.length)
    throw Error("Duplicate canvas models returned.");
  const modes = (model: GenerationModel) =>
    z.array(z.string()).optional().parse(model.generationModes) ?? [];
  const selected =
    (kind === "video" ? available.find((model) => model.id === "wan-3-0") : undefined) ??
    available.find((model) => priority[kind].some((mode) => modes(model).includes(mode))) ??
    available[0];
  const settings: Record<string, z.infer<typeof setting>> = {};
  if (!selected) return { settings };
  for (const [name, raw] of Object.entries(selected.input_schema.properties)) {
    const prop = property.parse(raw),
      ui = prop["x-ui"];
    if (name === "prompt" || ui?.control === "image_upload" || ui?.group === "references") continue;
    if (prop.default !== undefined) settings[name] = setting.parse(prop.default);
    else {
      const options = ui?.options?.filter((option) =>
        ["string", "number", "boolean"].includes(typeof option.value)
      );
      const values = (
        options?.length ? options.map((option) => option.value) : (prop.enum ?? [])
      ).filter(
        (value): value is string | number => typeof value === "string" || typeof value === "number"
      );
      if (values.length) settings[name] = values[0];
      else if (prop.type === "boolean") settings[name] = false;
      // Numeric fields without defaults stay absent, notably random seed.
    }
  }
  const supported = modes(selected);
  return {
    modelId: selected.id,
    modelName: selected.name,
    mode:
      priority[kind].find((mode) => supported.includes(mode)) ??
      supported.find((mode) => mode.startsWith("text_to_")) ??
      supported[0],
    settings,
  };
}
