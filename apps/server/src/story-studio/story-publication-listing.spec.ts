import {
  PatchStoryProjectSchema,
  StoreListingSchema,
  StoredStoreListingSchema,
} from './dto';
import { StoryPublicationListingSnapshotSchema } from './story-publication-listing';

const emptyDraft = {
  description: '',
  tags: [],
  developer: '',
  trailerAssetId: null,
  screenshotAssetIds: [],
};
const emptyLegacyDraft = {
  tagline: '',
  shortDescription: '',
  aboutParagraphs: [],
  tags: [],
  developer: '',
  trailerAssetId: null,
  screenshotAssetIds: [],
};

describe('Publication introduction validation', () => {
  it('retains unfinished introductions as editable project drafts', () => {
    expect(
      PatchStoryProjectSchema.safeParse({
        expectedProjectVersion: 1,
        storeListing: emptyDraft,
      }).success,
    ).toBe(true);
    expect(
      StoreListingSchema.parse({ ...emptyDraft, description: ' \n\n ' })
        .description,
    ).toBe('');
  });
  it('allows multiline descriptions up to thirteen thousand characters', () => {
    expect(
      StoreListingSchema.parse({
        ...emptyDraft,
        description: ' First paragraph\n\nSecond paragraph ',
      }).description,
    ).toBe('First paragraph\n\nSecond paragraph');
    const description = 'a'.repeat(13000);
    expect(
      StoreListingSchema.parse({ ...emptyDraft, description }).description,
    ).toBe(description);
    expect(
      StoreListingSchema.safeParse({
        ...emptyDraft,
        description: description + 'a',
      }).success,
    ).toBe(false);
  });
  it('accepts a release without promotional details', () => {
    expect(
      StoryPublicationListingSnapshotSchema.safeParse({
        title: 'A film',
        defaultLocale: 'en-US',
        coverAssetId: null,
        listing: emptyDraft,
      }).success,
    ).toBe(true);
  });
  it.each(['', 'Existing Crew'])(
    'freezes complete introductions while retaining creator metadata: %j',
    (developer) => {
      const listing = {
        ...emptyDraft,
        description: 'A complete work description.',
        developer,
      };
      const before = JSON.stringify(listing);
      const snapshot = StoryPublicationListingSnapshotSchema.parse({
        title: 'A film',
        defaultLocale: 'en-US',
        coverAssetId: '019f60f4-b101-70d4-8000-000000000099',
        listing,
      });
      expect(snapshot.listing.developer).toBe(developer);
      expect(snapshot.listing.description).toBe(listing.description);
      expect(JSON.stringify(listing)).toBe(before);
    },
  );
  it('accepts up to twelve unique labels and rejects more or duplicates', () => {
    const tags = Array.from({ length: 12 }, (_, index) => 'Tag ' + index);
    expect(StoreListingSchema.parse({ ...emptyDraft, tags }).tags).toEqual(
      tags,
    );
    expect(
      StoreListingSchema.safeParse({ ...emptyDraft, tags: [...tags, 'More'] })
        .success,
    ).toBe(false);
    expect(
      StoreListingSchema.safeParse({
        ...emptyDraft,
        tags: ['Drama', ' Drama '],
      }).success,
    ).toBe(false);
  });
  it.each([
    { genres: ['Drama'] },
    { tagline: 'A film' },
    { shortDescription: 'Choose your own path.' },
    { aboutParagraphs: ['Your story'] },
  ])('rejects retired fields in new project writes: %o', (retiredFields) => {
    expect(
      PatchStoryProjectSchema.safeParse({
        expectedProjectVersion: 1,
        storeListing: { ...emptyDraft, ...retiredFields },
      }).success,
    ).toBe(false);
  });
  it('merges the earlier text fields without dropping repeated text or new labels', () => {
    const tags = Array.from({ length: 12 }, (_, index) => 'Tag ' + index);
    const saved = {
      ...emptyLegacyDraft,
      tagline: ' A branching film ',
      shortDescription: 'A branching film',
      aboutParagraphs: ['', ' First paragraph ', ' ', 'Second paragraph'],
      tags,
    };
    const savedJson = JSON.stringify(saved);
    const parsed = StoredStoreListingSchema.parse(saved);
    expect(parsed.description).toBe(
      'A branching film\n\nA branching film\n\nFirst paragraph\n\nSecond paragraph',
    );
    expect(parsed.tags).toEqual(tags);
    expect(parsed).not.toHaveProperty('tagline');
    expect(parsed).not.toHaveProperty('shortDescription');
    expect(parsed).not.toHaveProperty('aboutParagraphs');
    expect(JSON.stringify(saved)).toBe(savedJson);
  });
  it('retains the maximum complete earlier text without truncation', () => {
    const saved = {
      ...emptyLegacyDraft,
      tagline: 'a'.repeat(120),
      shortDescription: 'b'.repeat(300),
      aboutParagraphs: Array.from({ length: 6 }, () => 'c'.repeat(2000)),
    };
    const description = StoredStoreListingSchema.parse(saved).description;
    expect(description).toBe(
      [saved.tagline, saved.shortDescription, ...saved.aboutParagraphs].join(
        '\n\n',
      ),
    );
    expect(description.length).toBe(12434);
  });
  it('preserves all twelve existing labels when reading the earliest draft shape', () => {
    const genres = ['Drama', 'Mystery', 'Comedy', 'Adventure'];
    const tags = Array.from({ length: 8 }, (_, index) => 'Tag ' + index);
    const saved = { ...emptyLegacyDraft, genres, tags };
    const parsed = StoredStoreListingSchema.parse(saved);
    expect(parsed.description).toBe('');
    expect(parsed.tags).toEqual([...genres, ...tags]);
    expect(parsed).not.toHaveProperty('genres');
    expect(saved.genres).toEqual(genres);
    expect(saved.tags).toEqual(tags);
  });
  it('merges repeated labels across the earlier lists without duplicating them', () => {
    expect(
      StoredStoreListingSchema.parse({
        ...emptyLegacyDraft,
        genres: [' Drama ', 'Mystery'],
        tags: ['Mystery', 'Multiple endings'],
      }).tags,
    ).toEqual(['Drama', 'Mystery', 'Multiple endings']);
  });
  it('does not silently truncate malformed stored labels', () => {
    expect(
      StoredStoreListingSchema.safeParse({
        ...emptyLegacyDraft,
        genres: ['Drama'],
        tags: Array.from({ length: 13 }, (_, index) => 'Tag ' + index),
      }).success,
    ).toBe(false);
  });
  it('rejects unknown stored fields and keeps invalid frozen introductions invalid', () => {
    expect(
      StoredStoreListingSchema.safeParse({
        ...emptyLegacyDraft,
        genres: ['Drama'],
        unknownField: 'Unexpected',
      }).success,
    ).toBe(false);
    expect(
      StoryPublicationListingSnapshotSchema.safeParse({
        title: 'A film',
        defaultLocale: 'en-US',
        coverAssetId: '019f60f4-b101-70d4-8000-000000000099',
        listing: { ...emptyLegacyDraft, unknownField: 'Unexpected' },
      }).success,
    ).toBe(false);
  });
  it('accepts complete descriptions without making promotional assets mandatory', () => {
    expect(
      StoreListingSchema.safeParse({
        ...emptyDraft,
        description: 'A film\n\nMake choices\n\nYour story',
        developer: 'Crew',
      }).success,
    ).toBe(true);
  });
});
