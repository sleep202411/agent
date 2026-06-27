import type { CreatorServiceSummary } from "@/data/types";
import type { MessageKey } from "@/i18n";

type Translate = (key: MessageKey) => string;

const SERVICE_CATEGORY_KEYS: Record<string, MessageKey> = {
  video_production: "creatorService.category.videoProduction",
  animation: "creatorService.category.animation",
  art_illustration: "creatorService.category.artIllustration",
  storyboard: "creatorService.category.storyboard",
  character_design: "creatorService.category.characterDesign",
  scene_design: "creatorService.category.sceneDesign",
  voice_acting: "creatorService.category.voiceActing",
  music_sound: "creatorService.category.musicSound",
  writing_script: "creatorService.category.writingScript",
  editing_post: "creatorService.category.editingPost",
  consulting: "creatorService.category.consulting",
  other: "creatorService.category.other",
};

export function serviceCategoryLabel(category: string, t: Translate): string {
  return t(SERVICE_CATEGORY_KEYS[category] ?? "creatorService.category.other");
}

export function formatServicePrice(
  service: Pick<CreatorServiceSummary, "currency" | "startingPrice">,
  locale: string
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: service.currency,
      maximumFractionDigits: service.currency === "JPY" ? 0 : 2,
    }).format(service.startingPrice);
  } catch {
    return `${service.currency} ${service.startingPrice}`;
  }
}
