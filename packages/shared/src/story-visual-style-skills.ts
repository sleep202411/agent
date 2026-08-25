/**
 * Curated visual-style Skills offered by Story Studio's creative profile.
 *
 * The slug is the human-readable wire value. Skill and version ids pin the
 * exact immutable catalog behavior used by durable authoring and generation.
 * UI copy stays in the locale bundles; preview filenames are deployment assets.
 */
export const STORY_VISUAL_STYLE_SKILL_SLUGS = [
  "cinematic-realism",
  "stylized-3d-cinema",
  "anime-cinematic",
  "graphic-novel-cinema",
  "ink-wash-cinema",
  "stop-motion-clay-cinema",
  "classic-cel-animation",
  "hand-painted-fantasy-adventure",
  "retro-anime-key-visual",
  "pixel-art-adventure",
  "surreal-collage-dreamscape",
  "grindhouse-chapter-cinema",
] as const;

export type StoryVisualStyleSkillSlug = (typeof STORY_VISUAL_STYLE_SKILL_SLUGS)[number];

export const STORY_VISUAL_STYLE_SKILLS = [
  {
    slug: "cinematic-realism",
    skillId: "10000000-0000-7000-8000-000000000029",
    versionId: "20000000-0000-7000-8000-000000000029",
    previewImageFile: "cinematic-realism.jpg",
  },
  {
    slug: "stylized-3d-cinema",
    skillId: "10000000-0000-7000-8000-000000000030",
    versionId: "20000000-0000-7000-8000-000000000030",
    previewImageFile: "stylized-3d-cinema.jpg",
  },
  {
    slug: "anime-cinematic",
    skillId: "10000000-0000-7000-8000-000000000031",
    versionId: "20000000-0000-7000-8000-000000000031",
    previewImageFile: "anime-cinematic.jpg",
  },
  {
    slug: "graphic-novel-cinema",
    skillId: "10000000-0000-7000-8000-000000000032",
    versionId: "20000000-0000-7000-8000-000000000032",
    previewImageFile: "graphic-novel-cinema.jpg",
  },
  {
    slug: "ink-wash-cinema",
    skillId: "10000000-0000-7000-8000-000000000008",
    versionId: "20000000-0000-7000-8000-000000000008",
    previewImageFile: "ink-wash-cinema.jpg",
  },
  {
    slug: "stop-motion-clay-cinema",
    skillId: "10000000-0000-7000-8000-000000000007",
    versionId: "20000000-0000-7000-8000-000000000007",
    previewImageFile: "stop-motion-clay-cinema.jpg",
  },
  {
    slug: "classic-cel-animation",
    skillId: "10000000-0000-7000-8000-000000000006",
    versionId: "20000000-0000-7000-8000-000000000006",
    previewImageFile: "classic-cel-animation.jpg",
  },
  {
    slug: "hand-painted-fantasy-adventure",
    skillId: "10000000-0000-7000-8000-000000000005",
    versionId: "20000000-0000-7000-8000-000000000005",
    previewImageFile: "hand-painted-fantasy-adventure.jpg",
  },
  {
    slug: "retro-anime-key-visual",
    skillId: "10000000-0000-7000-8000-000000000009",
    versionId: "20000000-0000-7000-8000-000000000009",
    previewImageFile: "retro-anime-key-visual.jpg",
  },
  {
    slug: "pixel-art-adventure",
    skillId: "10000000-0000-7000-8000-000000000013",
    versionId: "20000000-0000-7000-8000-000000000033",
    previewImageFile: "pixel-art-adventure.jpg",
  },
  {
    slug: "surreal-collage-dreamscape",
    skillId: "10000000-0000-7000-8000-000000000015",
    versionId: "20000000-0000-7000-8000-000000000034",
    previewImageFile: "surreal-collage-dreamscape.jpg",
  },
  {
    slug: "grindhouse-chapter-cinema",
    skillId: "10000000-0000-7000-8000-000000000004",
    versionId: "20000000-0000-7000-8000-000000000004",
    previewImageFile: "grindhouse-chapter-cinema.jpg",
  },
] as const satisfies readonly {
  slug: StoryVisualStyleSkillSlug;
  skillId: string;
  versionId: string;
  previewImageFile: string;
}[];

export type StoryVisualStyleSkill = (typeof STORY_VISUAL_STYLE_SKILLS)[number];

export function storyVisualStyleSkillBySlug(slug: string): StoryVisualStyleSkill | undefined {
  return STORY_VISUAL_STYLE_SKILLS.find((skill) => skill.slug === slug);
}
