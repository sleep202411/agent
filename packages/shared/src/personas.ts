/**
 * Persona = the UI-layer identity attached to an AI message. Under the hood
 * all messages come from the single storyos agent; the persona controls the
 * avatar / name / video shown in the chat stream and which system-prompt was
 * loaded for that particular workflow step.
 *
 * Kept in a shared package so both server (labelling messages when a workflow
 * step produces output) and web (rendering avatars) read from the same list.
 */
export const PERSONAS = [
  "storyos",
  "scriptwriter",
  "role_designer",
  "storyboard_artist",
  "mood_master",
  "producer",
] as const;

export type Persona = (typeof PERSONAS)[number];

export const PERSONA_DISPLAY: Record<Persona, { labelZh: string; labelEn: string }> = {
  storyos: { labelZh: "路由助手", labelEn: "Router" },
  scriptwriter: { labelZh: "编剧", labelEn: "Screenwriter" },
  role_designer: { labelZh: "角色设计师", labelEn: "Character Designer" },
  storyboard_artist: { labelZh: "分镜师", labelEn: "Storyboard Artist" },
  mood_master: { labelZh: "情绪大师", labelEn: "Mood Director" },
  producer: { labelZh: "制片", labelEn: "Producer" },
};
