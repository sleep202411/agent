import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamesPageClient } from "./games-page-client";

vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- Next Image is replaced with a DOM image for this component test.
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/layout/plaza-hero", () => ({ PlazaHero: () => <header /> }));
vi.mock("./interactive-film-store-dialog", () => ({
  InteractiveFilmStoreDialog: ({
    game,
    open,
  }: {
    game: { title: string } | null;
    open: boolean;
  }) => (open ? <div role="dialog">{game?.title}</div> : null),
}));

describe("published catalogue", () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("leaves an empty catalogue empty without sample works", async () => {
    await act(async () => root.render(<GamesPageClient textGames={[]} interactiveFilms={[]} />));
    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(container.textContent).toContain("films.empty");
    expect(container.textContent).not.toMatch(/Jinling|Lunar Armor|Three Second World/);
  });

  it("lists actual works once and preserves modified direct-player clicks", async () => {
    await act(async () =>
      root.render(
        <GamesPageClient
          textGames={[]}
          interactiveFilms={[
            {
              gameId: "jinling-rumeng",
              title: "Actual published work",
              currentVersion: "release-2",
              updatedAt: "2026-10-04T09:00:00Z",
            },
          ]}
        />
      )
    );
    expect(container.querySelectorAll("article")).toHaveLength(1);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/en-US/play/interactive-film/jinling-rumeng"]'
    );
    expect(link).toBeTruthy();
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => link?.dispatchEvent(modified));
    expect(modified.defaultPrevented).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => link?.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Actual published work");
  });
});
