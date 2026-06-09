import type { ComponentType } from "react";
import {
  IconArrowBarToRight,
  IconColumns2,
  IconPhotoUp,
  IconStack2,
  IconTextCaption,
  IconWand,
} from "@tabler/icons-react";

/**
 * Mode-first studio abstraction.
 *
 * The studio shell (FizzStudioShell + feed + composer chassis) is shared across
 * every modality and mode. What differs per mode is declared here: which input
 * slots the composer renders, and which catalog `AiGenerationMode` the mode maps
 * to (used to filter usable models + route to the right provider endpoint).
 *
 * Adding a new mode = adding one entry below — no new chassis code.
 */
export type StudioSlotKind =
  | "prompt"
  | "firstFrame"
  | "lastFrame"
  | "sourceVideo"
  | "referenceImages"
  | "referenceVideo"
  | "audio";

export type StudioModeKey =
  | "text_to_video"
  | "image_to_video"
  | "first_last_frame_to_video"
  | "reference_to_video"
  | "video_to_video"
  | "video_extend";

export interface StudioModeConfig {
  key: StudioModeKey;
  /** Catalog AiGenerationMode — drives model filtering + endpoint routing. */
  generationMode: string;
  icon: ComponentType<{ className?: string; stroke?: number }>;
  /** i18n suffix under `fizzStudio.videoStudio.modes`: label = `${i18nKey}`, description = `${i18nKey}Desc`. */
  i18nKey: string;
  /** Declarative composer inputs for this mode — the heart of the abstraction. */
  inputSlots: StudioSlotKind[];
}

export const VIDEO_MODES: StudioModeConfig[] = [
  {
    key: "text_to_video",
    generationMode: "text_to_video",
    icon: IconTextCaption,
    i18nKey: "textToVideo",
    inputSlots: ["prompt"],
  },
  {
    key: "image_to_video",
    generationMode: "image_to_video",
    icon: IconPhotoUp,
    i18nKey: "imageToVideo",
    inputSlots: ["firstFrame", "prompt"],
  },
  {
    key: "first_last_frame_to_video",
    generationMode: "first_last_frame_to_video",
    icon: IconColumns2,
    i18nKey: "firstLastFrame",
    inputSlots: ["firstFrame", "lastFrame", "prompt"],
  },
  {
    key: "reference_to_video",
    generationMode: "multimodal_to_video",
    icon: IconStack2,
    i18nKey: "referenceToVideo",
    inputSlots: ["referenceImages", "prompt"],
  },
  {
    key: "video_to_video",
    generationMode: "video_to_video",
    icon: IconWand,
    i18nKey: "editVideo",
    inputSlots: ["sourceVideo", "prompt"],
  },
  {
    key: "video_extend",
    generationMode: "video_to_video",
    icon: IconArrowBarToRight,
    i18nKey: "extendVideo",
    inputSlots: ["sourceVideo", "prompt"],
  },
];
