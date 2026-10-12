import { STORY_VISUAL_STYLE_SKILL_SLUGS, type StoryVisualStyleSkillSlug } from "@repo/shared";

const STYLE_PREVIEWS: Record<StoryVisualStyleSkillSlug, number> = {
  "cinematic-realism": require("../../../../assets/story-visual-styles/cinematic-realism.jpg"),
  "stylized-3d-cinema": require("../../../../assets/story-visual-styles/stylized-3d-cinema.jpg"),
  "anime-cinematic": require("../../../../assets/story-visual-styles/anime-cinematic.jpg"),
  "graphic-novel-cinema": require("../../../../assets/story-visual-styles/graphic-novel-cinema.jpg"),
  "ink-wash-cinema": require("../../../../assets/story-visual-styles/ink-wash-cinema.jpg"),
  "stop-motion-clay-cinema": require("../../../../assets/story-visual-styles/stop-motion-clay-cinema.jpg"),
  "classic-cel-animation": require("../../../../assets/story-visual-styles/classic-cel-animation.jpg"),
  "hand-painted-fantasy-adventure": require("../../../../assets/story-visual-styles/hand-painted-fantasy-adventure.jpg"),
  "retro-anime-key-visual": require("../../../../assets/story-visual-styles/retro-anime-key-visual.jpg"),
  "pixel-art-adventure": require("../../../../assets/story-visual-styles/pixel-art-adventure.jpg"),
  "surreal-collage-dreamscape": require("../../../../assets/story-visual-styles/surreal-collage-dreamscape.jpg"),
  "grindhouse-chapter-cinema": require("../../../../assets/story-visual-styles/grindhouse-chapter-cinema.jpg"),
};

export function storyProfileStylePreview(value: string): number | null {
  if (!STORY_VISUAL_STYLE_SKILL_SLUGS.some((slug) => slug === value)) return null;
  return STYLE_PREVIEWS[value as StoryVisualStyleSkillSlug];
}
