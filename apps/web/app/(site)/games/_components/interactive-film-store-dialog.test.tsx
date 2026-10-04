import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceGameSummary } from "@repo/shared/experience-runtime";
import type { StoreListing } from "@/src/lib/story-store";
import { InteractiveFilmStoreDialog } from "./interactive-film-store-dialog";

const h = vi.hoisted(() => ({
  listing: vi.fn(),
  save: vi.fn(),
  user: null as { id: string } | null,
}));
vi.mock("@/src/lib/story-store", () => ({ fetchStoreListing: h.listing }));
vi.mock("@/src/lib/story-saves", () => ({ fetchLatestSave: h.save }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: h.user }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError?: React.ReactEventHandler<HTMLImageElement>;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- Next Image is replaced with a DOM image for this component test.
    <img src={src} alt={alt} onError={onError} />
  ),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? children : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children, ...props }: React.ComponentProps<"p">) => (
    <p {...props}>{children}</p>
  ),
  DialogClose: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("./media-carousel", () => ({
  MediaCarousel: ({ media }: { media: { url: string }[] }) => (
    <div data-testid="media">{media.map((item) => item.url).join(",")}</div>
  ),
}));

const game: ExperienceGameSummary = {
  gameId: "jinling-rumeng",
  title: "Actual catalogue title",
  subtitle: "Actual catalogue description",
  coverUrl: "https://example.invalid/catalogue.jpg",
  currentVersion: "published-1",
  updatedAt: "2026-10-04T09:00:00.000Z",
};
const listing: StoreListing = {
  gameId: game.gameId,
  title: "Actual published title",
  defaultLocale: "en-US",
  description: "The saved public introduction.\n\nThe next paragraph stays on its own line.",
  tags: ["Published genre", "Published tag"],
  developer: "Actual creator crew",
  trailerUrl: "https://example.invalid/published-trailer.mp4",
  coverUrl: null,
  screenshots: [],
};

describe("film details use real release data", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    h.user = null;
    h.listing.mockReset().mockResolvedValue(listing);
    h.save.mockReset().mockResolvedValue(null);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  const render = async (selected = game) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <InteractiveFilmStoreDialog game={selected} open onOpenChange={() => undefined} />
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };

  it("renders the snapshot without invented publisher, price, popularity or wishlist", async () => {
    await render();
    expect(container.querySelector("h1")?.textContent).toBe(listing.title);
    expect(container.textContent?.split(listing.description).length).toBe(2);
    expect(container.querySelector('[aria-labelledby="store-about"] p')?.textContent).toBe(
      listing.description
    );
    expect(container.querySelector("p.sr-only")?.textContent).toBe(
      `games.store.label: ${listing.title}`
    );
    expect(container.textContent).toContain(listing.developer);
    for (const tag of listing.tags) expect(container.textContent?.split(tag).length).toBe(2);
    expect(container.textContent).not.toContain("games.store.genres");
    expect(container.querySelector('[data-testid="media"]')?.textContent).toBe(listing.trailerUrl);
    expect(container.querySelector(`img[src="${game.coverUrl}"]`)).toBeNull();
    expect(container.textContent).not.toMatch(
      /freeToPlay|playingNow|publisher|releaseDate|Rumeng Crew|wishlist/i
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(
      container.querySelector(`a[href="/en-US/play/interactive-film/${game.gameId}"]`)
    ).not.toBeNull();
  });

  it("uses only actual catalogue metadata when no public introduction exists", async () => {
    h.listing.mockResolvedValue(null);
    await render();
    expect(container.querySelector("h1")?.textContent).toBe(game.title);
    expect(container.textContent?.split(game.subtitle!).length).toBe(2);
    expect(container.querySelector('[aria-labelledby="store-about"] p')?.textContent).toBe(
      game.subtitle
    );
    expect(container.querySelector('[data-testid="media"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Rumeng Crew|Nine distinct endings|freeToPlay/);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(game.coverUrl);
  });

  it("does not restore a withheld snapshot cover from the catalogue", async () => {
    h.listing.mockResolvedValue({ ...listing, coverUrl: null, trailerUrl: null });
    await render();
    expect(container.querySelector("h1")?.textContent).toBe(listing.title);
    expect(container.querySelector(`img[src="${game.coverUrl}"]`)).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(listing.description);
    expect(
      container.querySelector(`a[href="/en-US/play/interactive-film/${game.gameId}"]`)
    ).not.toBeNull();
  });

  it("shows a failed cover and retries the same published image", async () => {
    const coverUrl = "https://example.invalid/published-cover.jpg";
    h.listing.mockResolvedValue({ ...listing, coverUrl, trailerUrl: null });
    await render();
    await act(async () =>
      container
        .querySelector<HTMLImageElement>(`img[src="${coverUrl}"]`)
        ?.dispatchEvent(new Event("error"))
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "games.store.mediaError"
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-cover-retry]")?.click()
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(coverUrl);
    expect(container.querySelector(`img[src="${game.coverUrl}"]`)).toBeNull();
  });

  it("keeps a long multiline introduction complete and separate from the dialog announcement", async () => {
    const description = `Opening paragraph.\n\n${"a".repeat(12_900)}\nThe final line.`;
    h.listing.mockResolvedValue({ ...listing, description });
    await render();
    const introduction = container.querySelector('[aria-labelledby="store-about"] p');
    expect(introduction?.textContent).toBe(description);
    expect(container.textContent?.split(description).length).toBe(2);
    expect(container.querySelector("p.sr-only")?.textContent).not.toContain(description);
    expect(container.textContent).not.toContain(game.subtitle);
  });

  it("does not replace an empty published description with a catalogue introduction", async () => {
    h.listing.mockResolvedValue({ ...listing, description: "" });
    await render();
    expect(container.querySelector('[aria-labelledby="store-about"]')).toBeNull();
    expect(container.textContent).not.toContain(game.subtitle);
  });

  it("shows the upstream error and retries while keeping play available", async () => {
    h.listing
      .mockRejectedValueOnce(new Error("The public release snapshot is unavailable."))
      .mockResolvedValueOnce(listing);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The public release snapshot is unavailable."
    );
    expect(container.querySelector("h1")?.textContent).toBe(game.title);
    expect(container.textContent).not.toContain(game.subtitle);
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "common.retry"
    );
    expect(retry).toBeTruthy();
    await act(async () => retry?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector("h1")?.textContent).toBe(listing.title);
    expect(container.textContent?.split(listing.description).length).toBe(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("lets the current player validate the saved chapter and keeps restart available", async () => {
    h.user = { id: "player-1" };
    h.save.mockResolvedValue({ gameId: game.gameId, chapterId: "chapter / two" });
    await render();
    const continueLink = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("continuePlaying")
    );
    expect(continueLink?.getAttribute("href")).toBe(`/en-US/play/interactive-film/${game.gameId}`);
    expect(container.querySelector('a[href$="?restart=1"]')).not.toBeNull();
    h.user = null;
    await render();
    expect(container.querySelector('a[href$="?restart=1"]')).toBeNull();
    expect(container.textContent).not.toContain("continuePlaying");
  });

  it("does not show a previous work's late response after selection changes", async () => {
    let resolveOld!: (value: StoreListing) => void;
    h.listing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    await render();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("common.loading");
    const nextGame = { ...game, gameId: "other-work", title: "Other real work" };
    h.listing.mockResolvedValue(null);
    await render(nextGame);
    await act(async () => resolveOld(listing));
    expect(container.querySelector("h1")?.textContent).toBe(nextGame.title);
    expect(container.textContent).not.toContain(listing.developer);
    expect(h.listing.mock.calls[0]?.[1]?.aborted).toBe(true);
  });
});
