// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpCommerceIp } from "@/src/lib/ip-commerce/api";
import { TvApp } from "./tv-app";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const harness = vi.hoisted(() => ({ get: vi.fn(), routerPush: vi.fn() }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
  useLocale: () => "en-US",
}));
vi.mock("@/src/i18n/locale-url", () => ({ localizePath: (path: string) => path }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.routerPush }) }));
vi.mock("@/src/lib/api", () => ({ api: { get: harness.get } }));
function makeIp(id: string, title: string): IpCommerceIp {
  const asset = (url: string) => ({
    id: `${id}-${url}`,
    kind: "image",
    storageProvider: "oss",
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: url,
    url: null,
    contentType: "image/jpeg",
    width: 1600,
    height: 900,
    durationSeconds: null,
  });
  return {
    id,
    slug: null,
    status: "published",
    listingVisibility: "public",
    ageRating: "ALL",
    region: null,
    title,
    subtitle: null,
    summary: `${title} summary`,
    description: null,
    sourceLocale: "en-US",
    localization: {} as IpCommerceIp["localization"],
    genres: ["Sci-Fi"],
    tags: [],
    genreCodes: ["scifi"],
    tagCodes: [],
    taxonomy: { genres: [], tags: [] },
    copyrightOwner: "Studio",
    createdById: "user-1",
    contributors: [],
    rightsSummary: {},
    aiDisclosure: {},
    coverAsset: asset(`https://cdn.test/${id}.jpg`),
    trailerAsset: asset(`https://cdn.test/${id}.mp4`),
    publishedAt: null,
    scheduledAt: null,
    price: null,
    campaigns: [],
    episodes: [],
  };
}

describe("TV IP list", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  const ips = [makeIp("ip-1", "First IP"), makeIp("ip-2", "Second IP")];

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    harness.get.mockReset().mockResolvedValue({ items: ips, nextCursor: null });
    harness.routerPush.mockClear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(embedded = false) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TvApp embedded={embedded} />
        </QueryClientProvider>
      );
    });
  }
  async function waitForText(text: string) {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.textContent).toContain(text);
    });
  }
  function clickIp(title: string) {
    const button = container.querySelector<HTMLButtonElement>(
      `nav button[aria-label="${title}"], nav button[aria-label^="${title},"]`
    );
    expect(button).not.toBeNull();
    act(() => button!.click());
  }
  const selected = () =>
    container.querySelector('nav button[aria-current="true"]')?.getAttribute("aria-label");

  it("opens the first channel and allows manual selection", async () => {
    await render();
    await waitForText("Second IP");
    expect(harness.get).toHaveBeenCalledWith("/aurora/ip-commerce/ips", {
      params: { locale: "en-US", cursor: undefined, limit: 20 },
    });
    expect(container.querySelectorAll("nav button")).toHaveLength(2);
    expect(selected()).toContain("First IP");
    expect(container.querySelector("video")?.getAttribute("src")).toContain("ip-1.mp4");
    clickIp("Second IP");
    expect(selected()).toContain("Second IP");
    expect(container.querySelector("video")?.getAttribute("src")).toContain("ip-2.mp4");
    clickIp("First IP");
    expect(container.querySelector("video")?.getAttribute("src")).toContain("ip-1.mp4");
  });

  it("shows genres consistently and marks only playable channels with a video icon", async () => {
    harness.get.mockResolvedValue({
      items: [
        { ...ips[0], subtitle: "A marketing tagline", copyrightOwner: "First creator" },
        { ...ips[1], genres: [], subtitle: "Another tagline", trailerAsset: null },
      ],
      nextCursor: null,
    });
    await render();
    await waitForText("Second IP");
    const list = container.querySelector("nav")!;
    expect(list.textContent).toContain("Sci-Fi");
    expect(list.textContent).not.toContain("tv.uncategorized");
    expect(list.querySelector('button[aria-label="Second IP"]')?.textContent).toBe("Second IP");
    expect(list.textContent).not.toContain("tagline");
    expect(list.textContent).not.toContain("creator");
    expect(list.querySelectorAll('[role="img"][aria-label="tv.hasVideo"]')).toHaveLength(1);
    clickIp("Second IP");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("section img")?.getAttribute("src")).toContain("ip-2.jpg");
  });

  it("keeps the initial channel when refreshed results change order", async () => {
    await render();
    await waitForText("First IP");
    await act(async () => {
      queryClient.setQueryData(["tv", "ips", "en-US"], {
        pages: [{ items: [...ips].reverse(), nextCursor: null }],
        pageParams: [undefined],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(selected()).toContain("First IP");
  });

  it("embeds the same player without the standalone exit control or duplicated logo", async () => {
    await render(true);
    await waitForText("First IP");
    expect(selected()).toContain("First IP");
    expect(container.querySelector('[aria-label="tv.exit"]')).toBeNull();
    expect(container.querySelector('img[alt="FizzDragon"]')).toBeNull();
    expect(container.querySelector("nav[data-lenis-prevent]")).not.toBeNull();
  });

  it("does not switch IPs after playback ends, scrolling, keys, or elapsed time", async () => {
    await render();
    await waitForText("First IP");
    clickIp("First IP");
    vi.useFakeTimers();
    act(() => {
      container.querySelector("video")!.dispatchEvent(new Event("ended", { bubbles: true }));
      container
        .querySelector("section")!
        .dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true }));
      for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "j", "k", "2"]) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      }
      vi.advanceTimersByTime(120_000);
    });
    expect(selected()).toContain("First IP");
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("video")?.loop).toBe(false);
  });

  it("preserves selection when loading another page or refreshing reordered results", async () => {
    harness.get
      .mockResolvedValueOnce({ items: ips, nextCursor: "next" })
      .mockResolvedValueOnce({ items: [makeIp("ip-3", "Third IP")], nextCursor: null });
    await render();
    await waitForText("First IP");
    clickIp("Second IP");
    act(() =>
      [...container.querySelectorAll<HTMLButtonElement>("nav button")]
        .find((button) => button.textContent === "tv.loadMore")!
        .click()
    );
    await waitForText("Third IP");
    expect(harness.get).toHaveBeenLastCalledWith("/aurora/ip-commerce/ips", {
      params: { locale: "en-US", cursor: "next", limit: 20 },
    });
    expect(selected()).toContain("Second IP");
    await act(async () => {
      queryClient.setQueryData(["tv", "ips", "en-US"], {
        pages: [{ items: [...ips].reverse(), nextCursor: null }],
        pageParams: [undefined],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(selected()).toContain("Second IP");
  });

  it("recovers from broken video and cover when the user selects another IP", async () => {
    await render();
    await waitForText("First IP");
    clickIp("First IP");
    act(() => {
      container.querySelector("video")!.dispatchEvent(new Event("error"));
    });
    act(() => container.querySelector("section img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("section img")).toBeNull();
    expect(container.textContent).toContain("tv.videoUnavailable");
    expect(selected()).toContain("First IP");
    clickIp("Second IP");
    expect(container.querySelector("video")?.getAttribute("src")).toContain("ip-2.mp4");
    expect(container.textContent).not.toContain("tv.videoUnavailable");
  });

  it("keeps native mute and pause state across a catalog refresh", async () => {
    await render();
    await waitForText("First IP");
    clickIp("First IP");
    const video = container.querySelector("video")!;
    expect(video.controls).toBe(true);
    act(() => {
      video.muted = false;
      video.dispatchEvent(new Event("volumechange"));
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["tv", "ips", "en-US"] });
    });
    expect(container.querySelector("video")).toBe(video);
    expect(video.muted).toBe(false);
    expect(video.paused).toBe(true);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("shows an empty list without inventing an aggregate channel", async () => {
    harness.get.mockResolvedValue({ items: [], nextCursor: null });
    await render();
    await waitForText("tv.noIps");
    expect(container.querySelectorAll("nav button")).toHaveLength(0);
    expect(container.querySelector("video")).toBeNull();
  });

  it("shows upstream errors and retries the list request", async () => {
    harness.get.mockRejectedValueOnce(new Error("Catalog temporarily unavailable"));
    await render();
    await waitForText("Catalog temporarily unavailable");
    act(() =>
      container.querySelector<HTMLButtonElement>('nav button[aria-label="tv.retry"]')!.click()
    );
    await waitForText("First IP");
    clickIp("First IP");
    expect(selected()).toContain("First IP");
  });
});
