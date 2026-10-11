// @vitest-environment jsdom
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminInteractiveFilmDetail } from "@/lib/interactive-film-admin-contract";
import type { AdminInteractiveFilmListing } from "@/lib/interactive-film-listing-contract";
import { InteractiveFilmListingSection } from "./interactive-film-listing-section";

const GAME = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const game = {
  gameId: GAME,
  status: "reviewing",
  draftVersion: VERSION,
  currentVersion: null,
} as AdminInteractiveFilmDetail;
const listing: AdminInteractiveFilmListing = {
  gameId: GAME,
  title: "Dragon Gate",
  defaultLocale: "en-US",
  description: "Frozen introduction",
  developer: "",
  tags: ["Mystery"],
  coverUrl: "https://media.invalid/cover.jpg",
  coverStatus: "available",
  trailerUrl: "https://media.invalid/trailer.mp4",
  screenshots: [{ url: "https://media.invalid/screen.jpg" }],
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
async function renderDom(
  data: AdminInteractiveFilmListing | null,
  onReadyChange = vi.fn(),
  hydrate = false
) {
  container = document.createElement("div");
  const view = (
    <InteractiveFilmListingSection
      game={game}
      initialListing={{
        contentVersion: VERSION,
        data: { contentVersion: VERSION, listing: data },
        error: null,
      }}
      onReadyChange={onReadyChange}
      refreshRevision={0}
    />
  );
  if (hydrate) {
    container.innerHTML = renderToString(view);
    await act(async () => {
      root = hydrateRoot(container, view);
    });
  } else {
    root = createRoot(container);
    await act(async () => root!.render(view));
  }
  return onReadyChange;
}
async function mediaEvent(element: Element, type: "load" | "error") {
  await act(async () => {
    element.dispatchEvent(new Event(type));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
});
function render(
  data: AdminInteractiveFilmListing | null,
  error: string | null = null,
  version = VERSION,
  refreshRevision = 0
) {
  return renderToStaticMarkup(
    <InteractiveFilmListingSection
      game={game}
      initialListing={{
        contentVersion: version,
        data: error ? null : { contentVersion: version, listing: data },
        error,
      }}
      onReadyChange={() => {}}
      refreshRevision={refreshRevision}
    />
  );
}

it("renders the frozen introduction, tags and all submitted media", () => {
  const html = render(listing);
  expect(html).toContain("Frozen introduction");
  expect(html).toContain("Mystery");
  expect(html).toContain(listing.coverUrl!);
  expect(html).toContain(listing.trailerUrl!);
  expect(html).toContain(listing.screenshots[0]!.url);
  expect(html).toContain(VERSION);
});
it("never renders stale materials while another candidate or validation refresh is loading", () => {
  for (const html of [render(listing, null, "old_version"), render(listing, null, VERSION, 1)]) {
    expect(html).toContain("Loading release materials");
    expect(html).not.toContain("Frozen introduction");
    expect(html).not.toContain("no promotional materials snapshot");
  }
});
it("distinguishes a legacy absent snapshot from an upstream read failure", () => {
  expect(render(null)).toContain("no promotional materials snapshot");
  const failure = render(null, "Candidate changed.");
  expect(failure).toContain("Candidate changed.");
  expect(failure).toContain("Retry materials");
  expect(failure).not.toContain("no promotional materials snapshot");
});
it("explains an unavailable selected cover and preserves recovery", () => {
  const html = render({ ...listing, coverUrl: null, coverStatus: "unavailable" });
  expect(html).toContain("cannot be approved because its cover is unavailable");
  expect(html).toContain("Retry materials");
  expect(html).toContain("Frozen introduction");
});
it("keeps an intentionally coverless release reviewable without a media load", async () => {
  const onReadyChange = await renderDom({
    ...listing,
    coverUrl: null,
    coverStatus: "not_provided",
    trailerUrl: null,
    screenshots: [],
  });
  expect(container.textContent).toContain("No cover provided.");
  expect(container.textContent).not.toContain("cannot be approved");
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
});
it("keeps an unavailable selected cover blocked even without a media element", async () => {
  const onReadyChange = await renderDom({ ...listing, coverUrl: null, coverStatus: "unavailable" });
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, false);
});
it("keeps a new cover pending until its image has loaded", async () => {
  const onReadyChange = await renderDom(listing);
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, false);
  await mediaEvent(container.querySelector('img[alt="Dragon Gate cover"]')!, "load");
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
});
it("blocks a failed cover until retry has loaded without blocking optional media", async () => {
  const onReadyChange = await renderDom(listing);
  await mediaEvent(container.querySelector('img[alt="Dragon Gate cover"]')!, "load");
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
  await mediaEvent(container.querySelector('img[alt="Dragon Gate screenshot 1"]')!, "error");
  await mediaEvent(container.querySelector("video")!, "error");
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
  const cover = container.querySelector('img[alt="Dragon Gate cover"]')!;
  await mediaEvent(cover, "error");
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, false);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Retry media"))!
      .click()
  );
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, false);
  await mediaEvent(container.querySelector('img[alt="Dragon Gate cover"]')!, "load");
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
});
it("keeps legacy releases reviewable without a promotional snapshot", async () => {
  const onReadyChange = await renderDom(null);
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
});
it("recovers a cover that failed before hydration without waiting for another error event", async () => {
  const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  const width = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
  const onReadyChange = await renderDom(listing, vi.fn(), true);
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, false);
  expect(container.textContent).toContain("Media could not be loaded.");
  complete.mockReturnValue(false);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Retry media"))!
      .click()
  );
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, false);
  width.mockReturnValue(1920);
  await mediaEvent(container.querySelector('img[alt="Dragon Gate cover"]')!, "load");
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
});
it("accepts a cached cover that loaded before hydration without waiting for another load event", async () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1920);
  const onReadyChange = await renderDom(listing, vi.fn(), true);
  expect(onReadyChange).toHaveBeenLastCalledWith(VERSION, true);
  expect(container.textContent).not.toContain("Media could not be loaded.");
});
