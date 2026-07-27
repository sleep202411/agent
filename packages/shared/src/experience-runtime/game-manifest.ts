import { z } from "zod";
import {
  ExperienceLocaleSchema,
  ExperienceLocalizedTextSchema,
  ExperienceSha256Schema,
  ExperienceStableIdSchema,
  uniqueById,
} from "./common.js";

/**
 * The Game Manifest: the table of contents of a multi-chapter work.
 *
 * A chapter ends in an ending, so a work with N chapters cannot compile into
 * one Runtime Manifest — every chapter after the first would be an unreachable
 * scene. Each chapter therefore ships as its own Runtime Manifest at its own
 * permanent URL, and THIS document is what the release API receives: chapter
 * identity plus where each chapter's manifest lives. It carries no scenes, no
 * assets and no logic, so it never duplicates or contradicts a chapter.
 *
 * Versioned separately from the Runtime Manifest because the two evolve
 * independently: a new engine feature bumps the runtime schema, while this
 * document only changes when the shape of a chapter listing changes.
 */
export const EXPERIENCE_GAME_MANIFEST_SCHEMA_VERSION = 1 as const;

const ExperienceChapterManifestUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Chapter manifest URLs must be absolute" });
      return;
    }
    if (url.protocol === "https:") return;
    context.addIssue({ code: "custom", message: "Chapter manifest URLs must use HTTPS" });
  });

export const ExperienceGameChapterSchema = z
  .object({
    chapterId: ExperienceStableIdSchema,
    /** Reading order as authored. Gaps are meaningful: an unbuilt chapter is skipped. */
    rank: z.number().int().nonnegative(),
    title: ExperienceLocalizedTextSchema,
    manifestUrl: ExperienceChapterManifestUrlSchema,
    /**
     * The chapter Runtime Manifest's own contentVersion. The player compares it
     * to the document it downloads, so a chapter URL that starts serving
     * different content fails loudly instead of silently playing.
     */
    contentVersion: ExperienceStableIdSchema,
    /** Digest of the canonical chapter manifest bytes at `manifestUrl`. */
    manifestHash: ExperienceSha256Schema,
  })
  .strict();

export const ExperienceGameManifestSchema = z
  .object({
    manifestType: z.literal("fizzdragon.experience-game"),
    schemaVersion: z.literal(EXPERIENCE_GAME_MANIFEST_SCHEMA_VERSION),
    gameId: ExperienceStableIdSchema,
    contentVersion: ExperienceStableIdSchema,
    defaultLocale: ExperienceLocaleSchema,
    /** Lowest rank first. The work opens on `chapters[0]`. */
    chapters: z.array(ExperienceGameChapterSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    uniqueById(manifest.chapters, (chapter) => chapter.chapterId, ["chapters"], context);
    manifest.chapters.forEach((chapter, index) => {
      if (!chapter.title[manifest.defaultLocale]) {
        context.addIssue({
          code: "custom",
          path: ["chapters", index, "title", manifest.defaultLocale],
          message: `Missing localized chapter title for ${manifest.defaultLocale}`,
        });
      }
      const previous = manifest.chapters[index - 1];
      if (previous && previous.rank >= chapter.rank) {
        context.addIssue({
          code: "custom",
          path: ["chapters", index, "rank"],
          message: "Chapters must be listed in strictly ascending rank order",
        });
      }
    });
  });

export type ExperienceGameChapter = z.infer<typeof ExperienceGameChapterSchema>;
export type ExperienceGameManifest = z.infer<typeof ExperienceGameManifestSchema>;

/**
 * Distinguishes the two documents a release URL may serve without parsing
 * either: a single-chapter work publishes its chapter Runtime Manifest
 * directly, a multi-chapter work publishes this table of contents.
 */
export function isExperienceGameManifest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { manifestType?: unknown }).manifestType === "fizzdragon.experience-game"
  );
}
