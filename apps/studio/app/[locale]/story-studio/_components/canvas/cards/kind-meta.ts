import {
  IconCards,
  IconFileText,
  IconFingerprint,
  IconGitBranch,
  IconRocket,
  IconUserCircle,
  IconVideo,
  type Icon,
} from "@tabler/icons-react";
import type { CharacterPortraitKey, NarrativeNodeKind } from "../types";

export const ROLE_CARD_WIDTH = 320;
export const ROLE_CARD_HEIGHT = 168;
export const ROLE_PORTRAIT_WIDTH = 82;
export const ROLE_PORTRAIT_HEIGHT = Math.round((ROLE_PORTRAIT_WIDTH * 16) / 9);

export const CHARACTER_PORTRAITS: Record<CharacterPortraitKey, { src: string; alt: string }> = {
  female: {
    src: "/narrative-studio/avatars/female-student.png",
    alt: "女生默认角色图",
  },
  male: {
    src: "/narrative-studio/avatars/male-student.png",
    alt: "男生默认角色图",
  },
  neutral: {
    src: "/narrative-studio/avatars/neutral-student.png",
    alt: "无性别默认角色图",
  },
};

export const KIND_META: Record<NarrativeNodeKind, { icon: Icon; accent: string; glow: string }> = {
  storyRoot: {
    icon: IconFileText,
    accent: "text-[#84b7ff]",
    glow: "bg-[#84b7ff]/18",
  },
  plot: {
    icon: IconGitBranch,
    accent: "text-white",
    glow: "bg-white/14",
  },
  ending: {
    icon: IconRocket,
    accent: "text-white",
    glow: "bg-white/14",
  },
  role: {
    icon: IconUserCircle,
    accent: "text-[#e0c27a]",
    glow: "bg-[#e0c27a]/18",
  },
  clue: {
    icon: IconFingerprint,
    accent: "text-white",
    glow: "bg-white/14",
  },
  item: {
    icon: IconCards,
    accent: "text-[#e0c27a]",
    glow: "bg-[#e0c27a]/18",
  },
  video: {
    icon: IconVideo,
    accent: "text-white",
    glow: "bg-white/14",
  },
};

export const CANVAS_LAYOUT = {
  endingColumnX: 2760,
  endingColumnStartY: -860,
  endingCardHeight: 280,
  endingCardGap: 72,
} as const;
