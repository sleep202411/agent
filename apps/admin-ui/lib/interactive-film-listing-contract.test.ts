import { describe, expect, it } from "vitest";
import type { AdminInteractiveFilmDetail } from "./interactive-film-admin-contract";
import {
  areInteractiveFilmMaterialsReady,
  interactiveFilmListingVersion,
  parseAdminInteractiveFilmListingSnapshot,
} from "./interactive-film-listing-contract";

const GAME_ID = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const LIVE_VERSION = "20000000-0000-4000-8000-000000000002";
export const listingFixture = {
  gameId: GAME_ID,
  title: "Dragon Gate",
  defaultLocale: "en-US",
  description: "A frozen introduction.\n\nChoices shape the story.",
  developer: "",
  tags: ["Mystery", "Choices matter"],
  coverUrl: "https://media.invalid/cover.jpg",
  coverStatus: "available" as const,
  trailerUrl: "https://media.invalid/trailer.mp4",
  screenshots: [{ url: "https://media.invalid/shot.jpg" }],
};

describe("moderation promotional materials contract", () => {
  it("permits legacy releases but blocks missing snapshots and unavailable selected covers", () => {
    expect(areInteractiveFilmMaterialsReady(null)).toBe(false);
    expect(areInteractiveFilmMaterialsReady({ contentVersion: VERSION, listing: null })).toBe(true);
    expect(
      areInteractiveFilmMaterialsReady({ contentVersion: VERSION, listing: listingFixture })
    ).toBe(true);
    expect(
      areInteractiveFilmMaterialsReady({
        contentVersion: VERSION,
        listing: { ...listingFixture, coverUrl: null, coverStatus: "unavailable" },
      })
    ).toBe(false);
  });
  it.each([
    ["draft", VERSION],
    ["reviewing", VERSION],
    ["published", LIVE_VERSION],
    ["offline", LIVE_VERSION],
  ] as const)("selects the authoritative %s release", (status, expected) => {
    expect(
      interactiveFilmListingVersion({
        status,
        draftVersion: VERSION,
        currentVersion: LIVE_VERSION,
      } as AdminInteractiveFilmDetail)
    ).toBe(expected);
  });
  it("uses an offline candidate only when there is no published version", () => {
    expect(
      interactiveFilmListingVersion({
        status: "offline",
        draftVersion: VERSION,
        currentVersion: null,
      } as AdminInteractiveFilmDetail)
    ).toBe(VERSION);
    expect(
      interactiveFilmListingVersion({
        status: "published",
        draftVersion: VERSION,
        currentVersion: null,
      } as AdminInteractiveFilmDetail)
    ).toBeNull();
  });
  it("retains frozen introduction, tags and all media", () => {
    expect(
      parseAdminInteractiveFilmListingSnapshot(
        { contentVersion: VERSION, listing: listingFixture },
        GAME_ID,
        VERSION
      )
    ).toEqual({ contentVersion: VERSION, listing: listingFixture });
  });
  it("keeps a release reviewable when its optional promotional details are empty", () => {
    const listing = {
      ...listingFixture,
      description: "",
      tags: [],
      developer: "",
      trailerUrl: null,
      screenshots: [],
    };
    const snapshot = parseAdminInteractiveFilmListingSnapshot(
      { contentVersion: VERSION, listing },
      GAME_ID,
      VERSION
    );
    expect(snapshot.listing).toEqual(listing);
    expect(areInteractiveFilmMaterialsReady(snapshot)).toBe(true);
  });
  it("keeps a release reviewable when no optional cover was selected", () => {
    const listing = { ...listingFixture, coverUrl: null, coverStatus: "not_provided" as const };
    const snapshot = parseAdminInteractiveFilmListingSnapshot(
      { contentVersion: VERSION, listing },
      GAME_ID,
      VERSION
    );
    expect(snapshot.listing).toEqual(listing);
    expect(areInteractiveFilmMaterialsReady(snapshot)).toBe(true);
  });
  it.each([
    { coverStatus: undefined, coverUrl: null },
    { coverStatus: "unknown", coverUrl: null },
    { coverStatus: "available", coverUrl: null },
    { coverStatus: "not_provided", coverUrl: listingFixture.coverUrl },
    { coverStatus: "unavailable", coverUrl: listingFixture.coverUrl },
  ])("rejects missing or inconsistent cover status (case %#)", (cover) => {
    expect(() =>
      parseAdminInteractiveFilmListingSnapshot(
        { contentVersion: VERSION, listing: { ...listingFixture, ...cover } },
        GAME_ID,
        VERSION
      )
    ).toThrow("invalid");
  });
  it.each([undefined, null, 42, {}, "a".repeat(13_001)])(
    "rejects missing, malformed or oversized descriptions (case %#)",
    (description) => {
      expect(() =>
        parseAdminInteractiveFilmListingSnapshot(
          { contentVersion: VERSION, listing: { ...listingFixture, description } },
          GAME_ID,
          VERSION
        )
      ).toThrow("invalid");
    }
  );
  it("distinguishes an explicit historical missing snapshot from invalid responses", () => {
    expect(
      parseAdminInteractiveFilmListingSnapshot(
        { contentVersion: VERSION, listing: null },
        GAME_ID,
        VERSION
      )
    ).toEqual({ contentVersion: VERSION, listing: null });
    expect(() =>
      parseAdminInteractiveFilmListingSnapshot({ contentVersion: VERSION }, GAME_ID, VERSION)
    ).toThrow("invalid");
  });
  it("rejects other games and versions instead of rendering or approving them", () => {
    expect(() =>
      parseAdminInteractiveFilmListingSnapshot(
        { contentVersion: LIVE_VERSION, listing: listingFixture },
        GAME_ID,
        VERSION
      )
    ).toThrow("different release");
    expect(() =>
      parseAdminInteractiveFilmListingSnapshot(
        { contentVersion: VERSION, listing: { ...listingFixture, gameId: "wrong" } },
        GAME_ID,
        VERSION
      )
    ).toThrow("different interactive film");
  });
  it.each(["javascript:alert(1)", "https://user:secret@media.invalid/shot.jpg", null])(
    "rejects unsafe or missing screenshot URLs (%s)",
    (url) => {
      expect(() =>
        parseAdminInteractiveFilmListingSnapshot(
          { contentVersion: VERSION, listing: { ...listingFixture, screenshots: [{ url }] } },
          GAME_ID,
          VERSION
        )
      ).toThrow("invalid");
    }
  );
});
