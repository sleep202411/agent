import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStoreListing } from "./story-store";

const listing = {
  gameId: "published-work",
  title: "Published title",
  defaultLocale: "en-US",
  description: "Published introduction.\n\nA second paragraph.",
  tags: ["Mystery", "Choices matter"],
  developer: "Published crew",
  trailerUrl: "https://media.example.invalid/trailer.mp4",
  coverUrl: null,
  screenshots: [{ url: "https://media.example.invalid/screenshot.jpg" }],
};

function respond(data: unknown, code = 200, message?: string) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code, message, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("published film introduction", () => {
  it("preserves the public snapshot and forwards cancellation", async () => {
    vi.stubGlobal("fetch", globalThis.fetch);
    respond(listing);
    const signal = new AbortController().signal;
    await expect(fetchStoreListing(listing.gameId, signal)).resolves.toEqual(listing);
    const request = vi.mocked(fetch).mock.calls[0];
    expect(request?.[0]).toContain("/aurora/story-store/published-work");
    expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(request?.[1]?.cache).toBe("no-store");
  });

  it("allows catalogue-only display only for an explicit null", async () => {
    vi.stubGlobal("fetch", globalThis.fetch);
    respond(null);
    await expect(fetchStoreListing(listing.gameId)).resolves.toBeNull();
    respond({});
    await expect(fetchStoreListing(listing.gameId)).rejects.toThrow("invalid format");
  });

  it("trims the description while preserving its full 13,000-character limit", async () => {
    vi.stubGlobal("fetch", globalThis.fetch);
    const description = "a".repeat(13_000);
    respond({ ...listing, description: `  ${description}\n` });
    await expect(fetchStoreListing(listing.gameId)).resolves.toEqual({ ...listing, description });
    respond({ ...listing, description: `${description}a` });
    await expect(fetchStoreListing(listing.gameId)).rejects.toThrow("invalid format");
  });

  it("requires the single description instead of the removed introduction fields", async () => {
    vi.stubGlobal("fetch", globalThis.fetch);
    const { description, ...metadata } = listing;
    respond({
      ...metadata,
      tagline: "A former tagline",
      shortDescription: description,
      aboutParagraphs: ["A former paragraph"],
    });
    await expect(fetchStoreListing(listing.gameId)).rejects.toThrow("invalid format");
  });

  it("rejects another work's introduction", async () => {
    vi.stubGlobal("fetch", globalThis.fetch);
    respond({ ...listing, gameId: "another-work" });
    await expect(fetchStoreListing(listing.gameId)).rejects.toThrow("does not match this work");
  });

  it("rejects unusable media URLs instead of mounting invalid images", async () => {
    vi.stubGlobal("fetch", globalThis.fetch);
    respond({ ...listing, trailerUrl: "javascript:alert(1)" });
    await expect(fetchStoreListing(listing.gameId)).rejects.toThrow("invalid format");
  });

  it("preserves upstream business failures inside HTTP 200", async () => {
    vi.stubGlobal("fetch", globalThis.fetch);
    respond(null, 503, "The publication snapshot cannot be read. Retry later.");
    await expect(fetchStoreListing(listing.gameId)).rejects.toMatchObject({
      message: "The publication snapshot cannot be read. Retry later.",
      code: 503,
    });
  });
});
