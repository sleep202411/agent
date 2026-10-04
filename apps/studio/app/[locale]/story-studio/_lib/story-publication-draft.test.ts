import { describe, expect, it } from "vitest";
import {
  missingPublicationFields,
  migratePublicationDraft,
  migratePublicationDraftSignature,
  parseStoredPublicationDraft,
  projectPublicationDraft,
  publicationDraftSignature,
  StoryPublicationDraftSchema,
} from "./story-publication-draft";

const firstAsset = "00000000-0000-4000-8000-000000000001";
const secondAsset = "00000000-0000-4000-8000-000000000002";
const empty = () => projectPublicationDraft({ storeListing: null, cover: null });
const legacyDraft = () => ({
  coverAssetId: null,
  listing: {
    tagline: " Unsaved title ",
    shortDescription: " Unsaved summary ",
    aboutParagraphs: [
      "First paragraph\nSecond line",
      "",
      "Repeated paragraph",
      "Repeated paragraph",
    ],
    genres: ["Drama", " Mystery "],
    tags: ["Mystery", "Choices"],
    developer: "Crew",
    trailerAssetId: null,
    screenshotAssetIds: [],
  },
});
const migratedDescription =
  "Unsaved title\n\nUnsaved summary\n\nFirst paragraph\nSecond line\n\nRepeated paragraph\n\nRepeated paragraph";

describe("publication introduction drafts", () => {
  it("accepts incomplete drafts while reporting fields still needed for submission", () => {
    const draft = empty();
    draft.listing.description = "An unfinished film";
    expect(StoryPublicationDraftSchema.safeParse(draft).success).toBe(true);
    expect(missingPublicationFields(draft)).toEqual(["cover"]);
  });

  it("recovers an incomplete account draft together with its original project version", () => {
    const draft = empty();
    draft.listing.description = "Saved before the artwork was ready.";
    expect(
      parseStoredPublicationDraft(JSON.stringify({ value: draft, projectVersion: 3 }))
    ).toEqual({ value: draft, projectVersion: 3 });
  });

  it("merges legacy text with section breaks and legacy genres into tags without losing edits", () => {
    const value = legacyDraft();
    const recovered = parseStoredPublicationDraft(JSON.stringify({ value, projectVersion: 4 }));
    expect(recovered).toEqual({
      value: {
        coverAssetId: null,
        listing: {
          description: migratedDescription,
          tags: ["Drama", "Mystery", "Choices"],
          developer: "Crew",
          trailerAssetId: null,
          screenshotAssetIds: [],
        },
      },
      projectVersion: 4,
    });
    const project = { storeListing: value.listing, cover: null } as unknown as Parameters<
      typeof projectPublicationDraft
    >[0];
    expect(projectPublicationDraft(project)).toEqual(recovered!.value);
    expect(StoryPublicationDraftSchema.safeParse(value).success).toBe(false);
    expect(StoryPublicationDraftSchema.safeParse(recovered!.value).success).toBe(true);
  });

  it("also migrates the previous three-field introduction after genres were already removed", () => {
    const listing = Object.fromEntries(
      Object.entries(legacyDraft().listing).filter(([field]) => field !== "genres")
    );
    const migrated = migratePublicationDraft({ coverAssetId: null, listing });
    expect(migrated.listing.description).toBe(migratedDescription);
    expect(migrated.listing.tags).toEqual(["Mystery", "Choices"]);
    expect(StoryPublicationDraftSchema.safeParse(migrated).success).toBe(true);
  });

  it("accepts twelve merged tags and preserves excess recovery tags for correction", () => {
    const legacy = legacyDraft();
    legacy.listing.genres = ["Genre 1", "Genre 2", "Genre 3", "Genre 4"];
    legacy.listing.tags = Array.from({ length: 8 }, (_, index) => `Tag ${index + 1}`);
    const migrated = migratePublicationDraft(legacy);
    expect(migrated.listing.tags).toHaveLength(12);
    expect(StoryPublicationDraftSchema.safeParse(migrated).success).toBe(true);
    legacy.listing.tags.push("Extra tag");
    const recovered = parseStoredPublicationDraft(
      JSON.stringify({ value: legacy, projectVersion: 1 })
    );
    expect(recovered!.value.listing.tags).toHaveLength(13);
    expect(recovered!.value.listing.tags.at(-1)).toBe("Extra tag");
    expect(StoryPublicationDraftSchema.safeParse(recovered!.value).success).toBe(false);
  });

  it("retains an over-limit merged introduction for correction without truncating it", () => {
    const legacy = legacyDraft();
    legacy.listing.aboutParagraphs = ["x".repeat(13_001), "Keep the final section"];
    const recovered = parseStoredPublicationDraft(
      JSON.stringify({ value: legacy, projectVersion: 2 })
    );
    expect(recovered!.value.listing.description).toBe(
      `Unsaved title\n\nUnsaved summary\n\n${legacy.listing.aboutParagraphs.join("\n\n")}`
    );
    expect(StoryPublicationDraftSchema.safeParse(recovered!.value).success).toBe(false);
  });

  it("normalizes retained HMR saved signatures without hiding unsaved edits", () => {
    const legacy = legacyDraft();
    const savedSignature = migratePublicationDraftSignature(JSON.stringify(legacy));
    expect(publicationDraftSignature(migratePublicationDraft(legacy))).toBe(savedSignature);
    const edited = { ...legacy, listing: { ...legacy.listing, tagline: "My unsaved film" } };
    expect(publicationDraftSignature(migratePublicationDraft(edited))).not.toBe(savedSignature);
    expect(
      migratePublicationDraft(edited).listing.description.startsWith("My unsaved film\n\n")
    ).toBe(true);
  });

  it.each([
    { ...empty().listing, tagline: "Conflicting old title" },
    { ...empty().listing, unknownField: "Must not be ignored" },
  ])("rejects mixed or unknown fields instead of masking them during recovery", (listing) => {
    const value = { ...empty(), listing };
    expect(StoryPublicationDraftSchema.safeParse(value).success).toBe(false);
    expect(parseStoredPublicationDraft(JSON.stringify({ value, projectVersion: 1 }))).toBeNull();
    expect(migratePublicationDraft(value)).toBe(value);
  });

  it.each([
    "not json",
    JSON.stringify({ value: empty(), projectVersion: -1 }),
    JSON.stringify({ value: { ...empty(), coverAssetId: "broken" }, projectVersion: 1 }),
  ])("ignores invalid recovery records", (record) => {
    expect(parseStoredPublicationDraft(record)).toBeNull();
  });

  it("rejects duplicate media references and overlong text before saving", () => {
    const draft = empty();
    draft.listing.screenshotAssetIds = [firstAsset, firstAsset];
    expect(StoryPublicationDraftSchema.safeParse(draft).success).toBe(false);
    draft.listing.screenshotAssetIds = [];
    draft.listing.description = "x".repeat(13_000);
    expect(StoryPublicationDraftSchema.safeParse(draft).success).toBe(true);
    draft.listing.description += "x";
    expect(StoryPublicationDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("allows an empty saved draft but requires a nonblank introduction for submission", () => {
    const draft = empty();
    draft.coverAssetId = firstAsset;
    draft.listing.description = " \n ";
    expect(StoryPublicationDraftSchema.safeParse(draft).success).toBe(true);
    expect(missingPublicationFields(draft)).toEqual(["description"]);
    draft.listing.description = "A complete introduction\n\nWith another paragraph";
    expect(missingPublicationFields(draft)).toEqual([]);
    expect(draft.listing.developer).toBe("");
    expect(StoryPublicationDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("preserves stored creator information through recovery and subsequent saves", () => {
    const draft = empty();
    draft.coverAssetId = firstAsset;
    draft.listing.description = "A complete introduction";
    draft.listing.developer = "Original film team";
    const recovered = parseStoredPublicationDraft(
      JSON.stringify({ value: draft, projectVersion: 5 })
    )!;
    expect(recovered.value.listing.developer).toBe("Original film team");
    recovered.value.listing.description = "Updated introduction";
    const saved = StoryPublicationDraftSchema.parse(recovered.value);
    expect(saved.listing.developer).toBe("Original film team");
    expect(JSON.parse(publicationDraftSignature(saved)).listing.developer).toBe(
      "Original film team"
    );
    expect(missingPublicationFields(saved)).toEqual([]);
  });

  it("treats the same restored fields as equal regardless of JSON property order, while keeping screenshot order meaningful", () => {
    const draft = empty();
    draft.listing.screenshotAssetIds = [firstAsset, secondAsset];
    const reordered = { coverAssetId: draft.coverAssetId, listing: { ...draft.listing } };
    expect(publicationDraftSignature(reordered)).toBe(publicationDraftSignature(draft));
    reordered.listing.screenshotAssetIds = [secondAsset, firstAsset];
    expect(publicationDraftSignature(reordered)).not.toBe(publicationDraftSignature(draft));
  });
});
