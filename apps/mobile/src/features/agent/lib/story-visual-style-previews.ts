import type { StoryVisualStyleSkillSlug } from "@repo/shared";

// Bundled copies of the official Studio v1 previews; available in both regions offline.
export const storyVisualStylePreviews = {
  "anime-cinematic": require("../../../../assets/images/story-visual-styles/anime-cinematic.jpg"),
  "cinematic-realism": require("../../../../assets/images/story-visual-styles/cinematic-realism.jpg"),
  "classic-cel-animation": require("../../../../assets/images/story-visual-styles/classic-cel-animation.jpg"),
  "graphic-novel-cinema": require("../../../../assets/images/story-visual-styles/graphic-novel-cinema.jpg"),
  "grindhouse-chapter-cinema": require("../../../../assets/images/story-visual-styles/grindhouse-chapter-cinema.jpg"),
  "hand-painted-fantasy-adventure": require("../../../../assets/images/story-visual-styles/hand-painted-fantasy-adventure.jpg"),
  "ink-wash-cinema": require("../../../../assets/images/story-visual-styles/ink-wash-cinema.jpg"),
  "pixel-art-adventure": require("../../../../assets/images/story-visual-styles/pixel-art-adventure.jpg"),
  "retro-anime-key-visual": require("../../../../assets/images/story-visual-styles/retro-anime-key-visual.jpg"),
  "stop-motion-clay-cinema": require("../../../../assets/images/story-visual-styles/stop-motion-clay-cinema.jpg"),
  "stylized-3d-cinema": require("../../../../assets/images/story-visual-styles/stylized-3d-cinema.jpg"),
  "surreal-collage-dreamscape": require("../../../../assets/images/story-visual-styles/surreal-collage-dreamscape.jpg"),
} satisfies Record<StoryVisualStyleSkillSlug, number>;
