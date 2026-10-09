import { z } from "zod";
import type { StoryProjectSummary, StoryStoreListing } from "@/lib/story-projects-api";

const PublicationTagSchema = z.string().trim().min(1).max(40);
const StoryFilmDetailsDraftObject = z
  .object({
    description: z.string().trim().max(13_000),
    tags: z.array(PublicationTagSchema).max(12),
    developer: z.string().trim().max(60),
    trailerAssetId: z.string().uuid().nullable(),
    screenshotAssetIds: z.array(z.string().uuid()).max(8),
  })
  .strict();

function requireUniqueReferences(
  draft: { tags: string[]; screenshotAssetIds: string[] },
  context: z.RefinementCtx
) {
  for (const field of ["tags", "screenshotAssetIds"] as const) {
    if (new Set(draft[field]).size !== draft[field].length) {
      context.addIssue({ code: "custom", path: [field], message: "Values must be unique." });
    }
  }
}

export const StoryFilmDetailsDraftSchema =
  StoryFilmDetailsDraftObject.superRefine(requireUniqueReferences);

export interface StoryPublicationDraft {
  listing: StoryStoreListing;
  coverAssetId: string | null;
}

const StoryPublicationDraftObject = z
  .object({
    listing: StoryFilmDetailsDraftSchema,
    coverAssetId: z.string().uuid().nullable(),
  })
  .strict();

export const StoryPublicationDraftSchema = StoryPublicationDraftObject;

/** Retain over-limit introduction text and tags so the creator can correct the complete draft. */
const RecoverablePublicationDraftSchema = StoryPublicationDraftObject.extend({
  listing: StoryFilmDetailsDraftObject.extend({
    description: z.string().trim(),
    tags: z.array(PublicationTagSchema),
  }).superRefine(requireUniqueReferences),
});

/** One format migration for old workbenches, browser recovery records and retained HMR state. */
export function migratePublicationDraft(value: unknown): StoryPublicationDraft {
  const draft = value as StoryPublicationDraft;
  const listing = draft?.listing as StoryStoreListing & {
    genres?: unknown;
    tagline?: unknown;
    shortDescription?: unknown;
    aboutParagraphs?: unknown;
  };
  if (!listing || typeof listing !== "object") return draft;
  const oldText = ["tagline", "shortDescription", "aboutParagraphs"] as const;
  const hasOldText = oldText.some((field) => Object.hasOwn(listing, field));
  const hasGenres = Object.hasOwn(listing, "genres");
  if (!hasOldText && !hasGenres) return draft;
  // Mixing formats is invalid; retain every field so strict validation exposes it.
  if (hasOldText && Object.hasOwn(listing, "description")) return draft;
  if (
    hasOldText &&
    (typeof listing.tagline !== "string" ||
      typeof listing.shortDescription !== "string" ||
      !Array.isArray(listing.aboutParagraphs) ||
      !listing.aboutParagraphs.every((paragraph) => typeof paragraph === "string"))
  )
    return draft;
  if (
    hasGenres &&
    (!Array.isArray(listing.genres) ||
      !listing.genres.every((genre) => typeof genre === "string") ||
      !Array.isArray(listing.tags))
  )
    return draft;
  const { genres, tagline, shortDescription, aboutParagraphs, ...fields } = listing;
  return {
    ...draft,
    listing: {
      ...fields,
      description: hasOldText
        ? [tagline as string, shortDescription as string, ...(aboutParagraphs as string[])]
            .map((section) => section.trim())
            .filter(Boolean)
            .join("\n\n")
        : listing.description,
      tags: hasGenres
        ? [...new Set([...(genres as string[]), ...listing.tags].map((tag) => tag.trim()))]
        : listing.tags,
    },
  };
}

export function projectPublicationDraft(
  project: Pick<StoryProjectSummary, "storeListing" | "cover">
): StoryPublicationDraft {
  return migratePublicationDraft({
    listing: project.storeListing ?? {
      description: "",
      tags: [],
      developer: "",
      trailerAssetId: null,
      screenshotAssetIds: [],
    },
    coverAssetId: project.cover?.id ?? null,
  });
}

export function publicationDraftSignature(draft: StoryPublicationDraft): string {
  const { listing } = migratePublicationDraft(draft);
  return JSON.stringify({
    coverAssetId: draft.coverAssetId,
    listing: {
      description: listing.description,
      tags: listing.tags,
      developer: listing.developer,
      trailerAssetId: listing.trailerAssetId,
      screenshotAssetIds: listing.screenshotAssetIds,
    },
  });
}

/** Preserve the original saved baseline when Fast Refresh retains an old edit record. */
export function migratePublicationDraftSignature(signature: string): string {
  try {
    const draft = JSON.parse(signature) as StoryPublicationDraft;
    const migrated = migratePublicationDraft(draft);
    return migrated === draft ? signature : publicationDraftSignature(migrated);
  } catch {
    return signature;
  }
}

export interface StoredPublicationDraft {
  value: StoryPublicationDraft;
  projectVersion: number;
}

export function parseStoredPublicationDraft(value: string | null): StoredPublicationDraft | null {
  if (!value) return null;
  try {
    const recovered = JSON.parse(value) as StoredPublicationDraft;
    const parsed = z
      .object({
        value: RecoverablePublicationDraftSchema,
        projectVersion: z.number().int().nonnegative(),
      })
      .strict()
      .safeParse({ ...recovered, value: migratePublicationDraft(recovered.value) });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
