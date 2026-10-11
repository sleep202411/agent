import { fieldUi } from "./schema";
import type { MessageKey } from "@/i18n";
import type { AiObjectSchema } from "@repo/shared";
import type { GenerationModel } from "./catalog-api";

/** Mirrors Studio generation-api.ts: catalog mode IDs select reference roles,
 * not separate providers. Unknown modes retain the catalog's reference fields. */
function referenceFields(schema: AiObjectSchema) {
  return Object.entries(schema.properties)
    .filter(([, field]) => {
      const ui = fieldUi(field);
      return (
        (["image_upload", "video_upload", "audio_upload"].includes(ui?.control ?? "") ||
          ui?.group === "references") &&
        (field.type !== "array" || (field.maxItems ?? 0) > 0)
      );
    })
    .sort(
      ([a, x], [b, y]) =>
        (fieldUi(x).order ?? 999) - (fieldUi(y).order ?? 999) || a.localeCompare(b)
    );
}
export function canvasReferenceFields(schema: AiObjectSchema, mode: string | undefined) {
  const fields = referenceFields(schema);
  const all = fields.map(([name]) => name);
  if (!mode || mode.startsWith("text_to_")) return [];
  const pick = (...names: string[]) => names.filter((name) => all.includes(name));
  const nonFrames = all.filter((name) => !/frame/i.test(name));
  const firstImage = () =>
    fields
      .filter(([, field]) => {
        const ui = field["x-ui"] as { mediaKind?: string; control?: string } | undefined;
        const kind =
          ui?.mediaKind ??
          (ui?.control === "video_upload"
            ? "video"
            : ui?.control === "audio_upload"
              ? "audio"
              : "image");
        return kind === "image";
      })
      .slice(0, 1)
      .map(([name]) => name);
  if (mode === "first_last_frame_to_video") {
    const explicit = pick("startFrame", "firstFrame", "endFrame", "lastFrame");
    return explicit.length ? explicit : all.filter((name) => /frame/i.test(name));
  }
  if (mode === "multimodal_to_video") {
    const explicit = pick("referenceImages", "referenceVideos", "referenceAudios");
    return explicit.length ? explicit : nonFrames;
  }
  if (mode === "image_to_video" || mode === "image_to_panorama") {
    const explicit = pick("startFrame", "referenceImages");
    return explicit.length ? explicit.slice(0, 1) : firstImage();
  }
  if (mode === "image_to_image" || mode === "video_to_video") {
    const explicit =
      mode === "video_to_video" ? pick("sourceVideo", "referenceVideos") : pick("referenceImages");
    return explicit.length ? explicit : nonFrames.filter((name) => !/audio/i.test(name));
  }
  if (mode === "inpainting") return pick("referenceImages", "maskImage");
  if (["upscale", "remove_background", "relight", "multi_angle", "outpainting"].includes(mode)) {
    const explicit = pick("referenceImages");
    return explicit.length ? explicit : firstImage();
  }
  return all;
}
export function initialCanvasMode(model: GenerationModel, saved?: string) {
  const modes = model.generationModes ?? [];
  if (saved && modes.includes(saved)) return saved;
  const priority = {
    image: ["image_to_image"],
    video: ["multimodal_to_video", "image_to_video", "first_last_frame_to_video", "video_to_video"],
    audio: ["text_to_audio", "audio_to_audio"],
  }[model.type];
  return (
    priority.find((mode) => modes.includes(mode)) ??
    modes.find((mode) => mode.startsWith("text_to_")) ??
    modes[0]
  );
}
export function canvasModeForm(
  model: GenerationModel,
  mode: string | undefined,
  values: Record<string, unknown>
) {
  // Older catalogs without mode metadata keep their full schema-driven form.
  if (!model.generationModes?.length) return { schema: model.input_schema, values };
  const active = canvasReferenceFields(model.input_schema, mode);
  const inactive = new Set(
    referenceFields(model.input_schema)
      .map(([name]) => name)
      .filter((name) => !active.includes(name))
  );
  return {
    schema: {
      ...model.input_schema,
      properties: Object.fromEntries(
        Object.entries(model.input_schema.properties).filter(([name]) => !inactive.has(name))
      ),
      required: model.input_schema.required?.filter((name) => !inactive.has(name)),
    },
    // Preserve unknown settings for the existing explicit schema-change review.
    values: Object.fromEntries(Object.entries(values).filter(([name]) => !inactive.has(name))),
  };
}

const modeLabelKeys: Record<string, MessageKey> = {
  text_to_image: "aiLab.mode.text_to_image",
  text_to_video: "aiLab.mode.text_to_video",
  text_to_audio: "aiLab.mode.text_to_audio",
  audio_to_audio: "aiLab.mode.audio_to_audio",
  image_to_image: "aiLab.mode.image_to_image",
  image_to_panorama: "aiLab.mode.image_to_panorama",
  image_to_video: "aiLab.mode.image_to_video",
  video_to_video: "aiLab.mode.video_to_video",
  first_last_frame_to_video: "aiLab.mode.first_last_frame_to_video",
  multimodal_to_video: "aiLab.mode.multimodal_to_video",
  inpainting: "aiLab.mode.inpainting",
  outpainting: "aiLab.mode.outpainting",
  upscale: "aiLab.mode.upscale",
  remove_background: "aiLab.mode.remove_background",
  relight: "aiLab.mode.relight",
  multi_angle: "aiLab.mode.multi_angle",
  reference_image_generation: "aiLab.mode.reference_image_generation",
  image_to_audio: "aiLab.mode.image_to_audio",
  text_to_text: "aiLab.mode.text_to_text",
  multimodal_to_text: "aiLab.mode.multimodal_to_text",
  multimodal_to_image: "aiLab.mode.multimodal_to_image",
};
export function canvasModeLabel(mode: string, t: (key: MessageKey) => string) {
  const key = Object.hasOwn(modeLabelKeys, mode) ? modeLabelKeys[mode] : undefined;
  const label = key ? t(key) : undefined;
  return label && label !== key ? label : mode.replace(/_/g, " ");
}
