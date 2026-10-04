// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from "react";
import videojs from "video.js";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpCommerceIp } from "@/src/lib/ip-commerce/api";
import { TvApp } from "./tv-app";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/app/(site)/ips/_components/community-video-dialog", () => ({
  CommunityVideoDialog: () => null,
}));
vi.mock("@/app/(site)/ip-studio/_components/new-ip-create-form", () => ({
  NewIpCreateDialog: () => null,
}));
vi.mock("@/components/payment/community-recharge-dialog", () => ({
  CommunityRechargeDialog: () => null,
}));
vi.mock("@/components/payment/community-membership-dialog", () => ({
  CommunityMembershipDialog: () => null,
}));
vi.mock("./tv-right-rail", () => ({ TvRightRail: () => null }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
const harness = vi.hoisted(() => ({
  userId: "viewer-a",
  get: vi.fn(),
  post: vi.fn(),
  list: vi.fn(),
  discovery: vi.fn(),
  detail: vi.fn(),
  routerPush: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: harness.userId } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: (ns: string) => (key: string, values?: { number?: string }) =>
    key === "roomNumber" ? `Room ${values?.number}` : `${ns}.${key}`,
  useLocale: () => "en-US",
}));
vi.mock("@/src/i18n/locale-url", () => ({ localizePath: (path: string) => path }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.routerPush }) }));
vi.mock("@/src/lib/api", () => ({
  api: {
    post: (...args: unknown[]) => harness.post(...args),
    get: (path: string, config?: unknown) => {
      harness.get(path, config);
      if (String(path).includes("/discovery")) return harness.discovery();
      if (path.endsWith("/access")) {
        return Promise.resolve({
          episodes: [{ id: "locked", access: "locked", price: null }],
          entitlements: [],
          wallet: null,
        });
      }
      if (/\/ips\//.test(path)) return harness.detail(path);
      return harness.list(config);
    },
  },
}));
vi.mock("@/app/(site)/ips/_components/ip-release-links", () => ({ IpReleaseLinks: () => null }));
vi.mock("@/app/(site)/ips/_components/ip-production-stage", () => ({
  IpProductionStage: () => null,
}));
vi.mock("@/app/(site)/ips/_components/ip-crew-origin", () => ({ IpCrewOrigin: () => null }));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    value,
    onChange,
    children,
    ...props
  }: {
    value: string;
    onChange: (v: string) => void;
    children: ReactNode;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Native DOM stand-in for the themed Select in interaction tests.
    <select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: ({ children, ...props }: { children: ReactNode; value: string }) => (
    <option {...props}>{children}</option>
  ),
}));
vi.mock("@/app/(site)/ips/_components/episode-feedback", () => ({
  EpisodeFeedback: ({ episodeId }: { episodeId: string }) => <div data-feedback={episodeId} />,
}));
function makeIp(id: string, title: string): IpCommerceIp {
  const asset = (url: string, kind: "image" | "video") => ({
    id: `${id}-${url}`,
    kind,
    storageProvider: "external_url",
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: url,
    url,
    contentType: kind === "video" ? "video/mp4" : "image/jpeg",
    width: 1600,
    height: 900,
    durationSeconds: null,
  });
  return {
    id,
    roomNumber: `10000${id.split("-").at(-1)}`,
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
    coverAsset: asset(`https://cdn.test/${id}.jpg`, "image"),
    trailerAsset: asset(`https://cdn.test/${id}.mp4`, "video"),
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

  let observerCallback: IntersectionObserverCallback;

  beforeEach(() => {
    harness.userId = "viewer-a";
    // JSDOM has no codecs. Admit the fixture MP4s so asynchronous unsupported-
    // source errors cannot race assertions about explicitly simulated playback.
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((mime) =>
      mime === "video/mp4" ? "probably" : ""
    );
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe(target: Element) {
          observerCallback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
        }
        disconnect() {}
      }
    );
    harness.get.mockReset();
    harness.detail.mockReset().mockResolvedValue({ ip: null });
    harness.post.mockReset().mockResolvedValue({ recorded: true });
    harness.list.mockReset().mockResolvedValue({ items: ips, nextCursor: null });
    harness.discovery.mockReset().mockResolvedValue({ items: [] });
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
  async function render(
    embedded = false,
    entry: { initialIpId?: string; initialEpisodeId?: string } = {}
  ) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StrictMode>
            <TvApp embedded={embedded} {...entry} />
          </StrictMode>
        </QueryClientProvider>
      );
    });
  }

  it("collapses and restores channel details without replacing the player", async () => {
    await render();
    await waitForText("First IP");
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="tv-channel-details"]'
    );
    expect(toggle).not.toBeNull();
    const details = container.querySelector<HTMLElement>("#tv-channel-details")!;
    expect(details.hidden).toBe(true);
    await act(async () => toggle!.click());
    expect(details.hidden).toBe(false);
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle!.click());
    expect(details.hidden).toBe(true);
    expect(details.textContent).toContain("First IP");
  });

  it("shows both categories together without filtering catalog or discovery", async () => {
    harness.list.mockResolvedValue({
      items: [
        { ...makeIp("ip-1", "First IP"), channelType: "ip" },
        { ...makeIp("community-1", "Community video"), channelType: "community" },
      ],
      nextCursor: null,
    });
    await render();
    await waitForText("Community video");
    expect(container.textContent).toContain("First IP");
    expect(container.textContent).toContain("channels.ip");
    expect(container.textContent).toContain("channels.community");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (b) => b.textContent === "channels.community"
      )
    ).toBe(false);
    for (const [path, options] of harness.get.mock.calls) {
      if (path === "/aurora/ip-commerce/ips" || path === "/aurora/ip-commerce/discovery") {
        expect(options.params.channelType).toBeUndefined();
      }
    }
  });

  it("cancels catalog and discovery reads when the viewer changes", async () => {
    harness.list.mockImplementation(() => new Promise(() => {}));
    harness.discovery.mockImplementation(() => new Promise(() => {}));
    await render();
    const oldRequests = harness.get.mock.calls.map(
      ([, options]) => options as { signal: AbortSignal }
    );
    expect(oldRequests.length).toBeGreaterThanOrEqual(2);
    harness.userId = "viewer-b";
    harness.list.mockResolvedValue({
      items: [makeIp("new-ip", "New viewer IP")],
      nextCursor: null,
    });
    harness.discovery.mockResolvedValue({ items: [] });
    await render();
    expect(oldRequests.every((request) => request.signal.aborted)).toBe(true);
    expect(harness.get.mock.calls.length).toBeGreaterThan(oldRequests.length);
  });

  it("does not reuse the previous viewer's fresh channel cache", async () => {
    await render();
    harness.userId = "viewer-b";
    harness.list.mockResolvedValue({
      items: [makeIp("new-ip", "New viewer IP")],
      nextCursor: null,
    });
    await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain("New viewer IP");
    expect(container.textContent).not.toContain("First IP");
  });

  it("reports a recommendation failure while retaining playable catalog channels", async () => {
    harness.discovery.mockRejectedValue(new Error("Recommendations unavailable"));
    await render();
    await waitForText("Recommendations unavailable");
    expect(container.textContent).toContain("First IP");
    expect(container.textContent).toContain("Second IP");
    expect(selected()).toContain("First IP");
  });
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
  const player = () => videojs.getPlayer(container.querySelector(".video-js")!.id)!;
  async function waitForSource(id: string) {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(player().currentSrc()).toContain(`${id}.mp4`);
    });
  }
  const selected = () =>
    container.querySelector('nav button[aria-current="true"]')?.getAttribute("aria-label");

  it("records full-episode playback once, without counting trailers or buffering", async () => {
    const first = makeIp("ip-1", "First IP");
    first.episodes = [1, 2].map((number) => ({
      id: `episode-${number}`,
      episodeNo: number,
      title: `Episode ${number}`,
      status: "published",
      mediaAsset: { ...first.trailerAsset!, url: `https://cdn.test/episode-${number}.mp4` },
    })) as typeof first.episodes;
    harness.list.mockResolvedValue({ items: [first], nextCursor: null });
    await render();
    await waitForSource("ip-1");
    act(() => player().trigger("playing"));
    expect(harness.post).not.toHaveBeenCalled();
    for (const number of [1, 2]) {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(`[data-episode-id="episode-${number}"]`)!
          .click();
      });
      await waitForSource(`episode-${number}`);
      expect(harness.post).toHaveBeenCalledTimes(number - 1);
      const staleSource = vi
        .spyOn(player(), "currentSrc")
        .mockReturnValue("https://cdn.test/old.mp4");
      act(() => player().trigger("playing"));
      expect(harness.post).toHaveBeenCalledTimes(number - 1);
      staleSource.mockRestore();
      await act(async () => {
        player().trigger("playing");
        player().trigger("waiting");
        player().trigger("playing");
      });
      expect(harness.post).toHaveBeenCalledTimes(number);
      expect(harness.post).toHaveBeenLastCalledWith("/aurora/ip-commerce/member-views", {
        data: { ipId: "ip-1", episodeId: `episode-${number}` },
      });
    }
  });

  it.each(["failed", "ineligible"])(
    "skips guests and retries a %s signal on later playback",
    async (outcome) => {
      const first = makeIp("ip-1", "First IP");
      first.episodes = [
        {
          id: "episode-1",
          episodeNo: 1,
          title: "Episode 1",
          status: "published",
          mediaAsset: { ...first.trailerAsset!, url: "https://cdn.test/episode-one.mp4" },
        },
      ] as typeof first.episodes;
      harness.list.mockResolvedValue({ items: [first], nextCursor: null });
      harness.userId = "";
      await render();
      await waitForSource("ip-1");
      async function selectEpisode() {
        await act(async () => {
          container.querySelector<HTMLButtonElement>('[data-episode-id="episode-1"]')!.click();
        });
        await waitForSource("episode-one");
      }
      await selectEpisode();
      await act(async () => player().trigger("playing"));
      expect(harness.post).not.toHaveBeenCalled();
      harness.userId = "viewer-b";
      if (outcome === "failed") harness.post.mockRejectedValueOnce(new Error("Signal unavailable"));
      else harness.post.mockResolvedValueOnce({ recorded: false });
      await render();
      await waitForSource("ip-1");
      await selectEpisode();
      await act(async () => player().trigger("playing"));
      expect(harness.post).toHaveBeenCalledTimes(1);
      expect(container.querySelector('nav [aria-label="tv.nowPlaying"]')).not.toBeNull();
      await act(async () => {
        player().trigger("waiting");
        player().trigger("playing");
      });
      expect(harness.post).toHaveBeenCalledTimes(2);
      await act(async () => player().trigger("playing"));
      expect(harness.post).toHaveBeenCalledTimes(2);
    }
  );

  it("lists locked episodes without exposing their video and clears feedback on another channel", async () => {
    const first = makeIp("ip-1", "First IP");
    const media = { ...first.trailerAsset!, url: "https://cdn.test/episode-one.mp4" };
    first.episodes = [
      {
        id: "episode-1",
        episodeNo: 1,
        title: "First episode",
        status: "published",
        mediaAsset: media,
      },
      {
        id: "locked",
        episodeNo: 2,
        title: "Locked",
        mediaLocked: true,
        status: "published",
        mediaAsset: null,
        trailerAsset: media,
      },
    ] as typeof first.episodes;
    harness.list.mockResolvedValue({ items: [first, ips[1]], nextCursor: null });
    await render();
    await waitForSource("ip-1");
    const select = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="tv.episodeSelector"]'
    )!;
    expect(select.textContent).toContain("First episode");
    expect(select.textContent).toContain("Locked");
    await act(async () => {
      select.querySelector<HTMLButtonElement>('[data-episode-id="episode-1"]')!.click();
    });
    await waitForSource("episode-one");
    expect(container.querySelector('[data-feedback="episode-1"]')).not.toBeNull();
    await act(async () => {
      select.querySelector<HTMLButtonElement>('[data-episode-id="locked"]')!.click();
    });
    expect(container.textContent).toContain("tv.episodeAccess");
    expect(container.querySelector("[data-feedback]")).toBeNull();
    expect(container.querySelector('section a[href="/ip/100001"]')).not.toBeNull();
    clickIp("Second IP");
    await waitForSource("ip-2");
    expect(container.querySelector("[data-feedback]")).toBeNull();
  });
  it("opens the first channel and allows manual selection", async () => {
    await render();
    await waitForText("Second IP");
    expect(harness.get).toHaveBeenCalledWith("/aurora/ip-commerce/ips", {
      signal: expect.any(AbortSignal),
      params: {
        locale: "en-US",
        cursor: undefined,
        q: undefined,
        limit: 20,
      },
    });
    expect(container.querySelectorAll("nav button")).toHaveLength(2);
    expect(selected()).toContain("First IP");
    await waitForSource("ip-1");
    clickIp("Second IP");
    expect(selected()).toContain("Second IP");
    await waitForSource("ip-2");
    clickIp("First IP");
    await waitForSource("ip-1");
  });

  it("leads the catalog with IP Plaza For you placements", async () => {
    const featured = makeIp("ip-featured", "Featured IP");
    harness.discovery.mockResolvedValue({
      items: [{ ipCard: featured, sortOrder: 0 }],
    });
    harness.list.mockResolvedValue({ items: ips, nextCursor: null });
    await render();
    await waitForText("Featured IP");
    expect(selected()).toContain("Featured IP");
    expect(selected()).toContain("tv.hot");
    const labels = [...container.querySelectorAll("nav button")].map((button) =>
      button.getAttribute("aria-label")
    );
    expect(labels[0]).toContain("Featured IP");
    expect(labels[0]).toContain("tv.hot");
    expect(labels[1]).toContain("First IP");
    expect(container.querySelector('nav [aria-label="tv.hot"]')).not.toBeNull();
    await waitForSource("ip-featured");
  });

  it("keeps poster-only IPs out of TV while retaining playable channels and genres", async () => {
    harness.list.mockResolvedValue({
      items: [
        { ...ips[0], subtitle: "A marketing tagline", copyrightOwner: "First creator" },
        { ...ips[1], genres: [], subtitle: "Another tagline", trailerAsset: null },
      ],
      nextCursor: null,
    });
    await render();
    await waitForSource("ip-1");
    const list = container.querySelector("nav")!;
    expect(list.textContent).toContain("Sci-Fi");
    expect(list.textContent).not.toContain("tv.uncategorized");
    expect(list.querySelector('button[aria-label^="Second IP,"]')).toBeNull();
    expect(list.textContent).not.toContain("tagline");
    expect(list.textContent).not.toContain("creator");
    expect(list.querySelectorAll('[role="img"][aria-label="tv.hasVideo"]')).toHaveLength(1);
  });

  it.each([false, true])(
    "shows stable room numbers in the list and selected IP (embedded=%s)",
    async (embedded) => {
      const roomNumber = "9223372036854775807";
      harness.list.mockResolvedValue({
        items: [{ ...ips[0], roomNumber }, ips[1]],
        nextCursor: null,
      });
      await render(embedded);
      await waitForText("Second IP");
      const list = container.querySelector("nav")!;
      expect(list.textContent).toContain(`Room ${roomNumber}`);
      expect(list.textContent).toContain("Room 100002");
      expect(selected()).toContain(`Room ${roomNumber}`);
      expect(container.querySelector(`a[href="/ip/${roomNumber}"]`)).not.toBeNull();
      clickIp("Second IP");
      expect(container.textContent?.match(/Room 100002/g)).toHaveLength(2);
      expect(container.querySelector('a[href="/ip/100002"]')).not.toBeNull();
    }
  );

  it("keeps the initial channel when refreshed results change order", async () => {
    await render();
    await waitForText("First IP");
    await act(async () => {
      queryClient.setQueryData(["tv", "ips", "en-US", "", harness.userId], {
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

  it("does not switch IPs from scrolling, unrelated keys, or elapsed time", async () => {
    await render();
    await waitForText("First IP");
    clickIp("First IP");
    vi.useFakeTimers();
    act(() => {
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
    harness.list
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
    expect(harness.list).toHaveBeenLastCalledWith({
      signal: expect.any(AbortSignal),
      params: {
        locale: "en-US",
        cursor: "next",
        q: undefined,
        limit: 20,
      },
    });
    expect(selected()).toContain("Second IP");
    await act(async () => {
      queryClient.setQueryData(["tv", "ips", "en-US", "", harness.userId], {
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
    await waitForSource("ip-1");
    vi.spyOn(videojs.log, "error").mockImplementation(() => {});
    act(() => player().error("CDN request failed"));
    act(() => container.querySelector("section img.size-full")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("section img.size-full")).toBeNull();
    expect(container.textContent).toContain("CDN request failed");
    expect(selected()).toContain("First IP");
    clickIp("Second IP");
    await waitForSource("ip-2");
    expect(container.textContent).not.toContain("CDN request failed");
  });

  it("keeps the custom player, mute and pause state across a catalog refresh", async () => {
    await render();
    await waitForText("First IP");
    clickIp("First IP");
    await waitForSource("ip-1");
    const video = container.querySelector("video")!;
    const instance = player();
    expect(video.controls).toBe(false);
    expect(container.querySelectorAll(".vjs-control-bar button")).toHaveLength(3);
    expect(container.querySelector(".vjs-play-control")).not.toBeNull();
    expect(container.querySelector(".vjs-volume-panel")).not.toBeNull();
    expect(container.querySelector('.vjs-progress-control [role="slider"]')).not.toBeNull();
    expect(container.querySelector(".vjs-current-time")).not.toBeNull();
    expect(container.querySelector(".vjs-duration")).not.toBeNull();
    expect(container.querySelector(".vjs-fullscreen-control")).not.toBeNull();
    act(() => {
      player().muted(false);
      player().volume(0.4);
      player().pause();
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["tv", "ips", "en-US", ""] });
    });
    expect(container.querySelector("video")).toBe(video);
    expect(player()).toBe(instance);
    expect(player().muted()).toBe(false);
    expect(player().volume()).toBeCloseTo(0.4);
    expect(player().paused()).toBe(true);
  });

  it("advances to the next playable channel on ended and stops at the catalog end", async () => {
    harness.list.mockResolvedValue({
      items: [ips[0], { ...ips[1], trailerAsset: null }, makeIp("ip-3", "Third IP")],
      nextCursor: null,
    });
    await render();
    await waitForSource("ip-1");
    const instance = player();
    act(() => player().trigger("ended"));
    await waitForSource("ip-3");
    expect(selected()).toContain("Third IP");
    expect(player()).toBe(instance);
    act(() => player().trigger("ended"));
    expect(selected()).toContain("Third IP");
    clickIp("First IP");
    await waitForSource("ip-1");
    act(() => player().trigger("ended"));
    await waitForSource("ip-3");
  });

  it("loads through cover-only pages when advancing beyond the current page", async () => {
    harness.list
      .mockReset()
      .mockResolvedValueOnce({ items: [ips[0]], nextCursor: "page-2" })
      .mockResolvedValueOnce({ items: [{ ...ips[1], trailerAsset: null }], nextCursor: "page-3" })
      .mockResolvedValueOnce({ items: [makeIp("ip-3", "Third IP")], nextCursor: null });
    await render();
    await waitForSource("ip-1");
    act(() => player().trigger("ended"));
    await waitForSource("ip-3");
    expect(selected()).toContain("Third IP");
    expect(harness.list).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("tv.loadingChannel");
  });

  it("does not let a late next-page response override a manual selection", async () => {
    let resolvePage!: (value: unknown) => void;
    harness.list
      .mockReset()
      .mockResolvedValueOnce({ items: ips, nextCursor: "page-2" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePage = resolve;
          })
      );
    await render();
    await waitForSource("ip-1");
    clickIp("Second IP");
    await waitForSource("ip-2");
    act(() => player().trigger("ended"));
    expect(container.textContent).toContain("tv.loadingChannel");
    clickIp("First IP");
    await act(async () => {
      resolvePage({ items: [makeIp("ip-3", "Third IP")], nextCursor: null });
    });
    await waitForText("Third IP");
    expect(selected()).toContain("First IP");
    await waitForSource("ip-1");
  });

  it.each(["resolve", "reject"] as const)(
    "abandons pending channel navigation when search changes (%s)",
    async (outcome) => {
      let resolvePage!: (value: unknown) => void;
      let rejectPage!: (error: Error) => void;
      harness.list
        .mockReset()
        .mockImplementation((config: { params: { q?: string; cursor?: string } }) => {
          if (config.params.q)
            return Promise.resolve({
              items: [makeIp("new-ip", "Search result")],
              nextCursor: null,
            });
          if (!config.params.cursor)
            return Promise.resolve({ items: [ips[0]], nextCursor: "page-2" });
          return new Promise((resolve, reject) => {
            resolvePage = resolve;
            rejectPage = reject;
          });
        });
      await render();
      await waitForSource("ip-1");
      act(() => player().trigger("ended"));
      expect(container.textContent).toContain("tv.loadingChannel");
      const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
          input,
          "new"
        );
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "new" }));
      });
      expect(container.textContent).not.toContain("tv.loadingChannel");
      await act(async () => {
        if (outcome === "resolve") resolvePage({ items: [ips[1]], nextCursor: null });
        else rejectPage(new Error("Abandoned navigation failure"));
        await new Promise((resolve) => setTimeout(resolve, 350));
      });
      await waitForText("Search result");
      expect(container.textContent).not.toContain("Abandoned navigation failure");
      expect(selected()).toContain("Search result");
    }
  );

  it("surfaces a next-page failure and lets the viewer retry without losing the channel", async () => {
    harness.list
      .mockReset()
      .mockResolvedValueOnce({ items: [ips[0]], nextCursor: "page-2" })
      .mockRejectedValueOnce(new Error("Catalog page unavailable"))
      .mockResolvedValueOnce({ items: [ips[1]], nextCursor: null });
    await render();
    await waitForSource("ip-1");
    act(() => player().trigger("ended"));
    await waitForText("Catalog page unavailable");
    expect(selected()).toContain("First IP");
    act(() => container.querySelector<HTMLButtonElement>('section [role="alert"] button')!.click());
    await waitForSource("ip-2");
    expect(container.textContent).not.toContain("Catalog page unavailable");
  });

  it("preserves volume and mute when switching past an excluded poster-only IP", async () => {
    harness.list.mockResolvedValue({
      items: [ips[0], { ...ips[1], trailerAsset: null }, makeIp("ip-3", "Third IP")],
      nextCursor: null,
    });
    await render();
    await waitForSource("ip-1");
    const instance = player();
    act(() => {
      player().muted(false);
      player().volume(0.3);
    });
    expect(container.querySelector('button[aria-label^="Second IP,"]')).toBeNull();
    clickIp("Third IP");
    await waitForSource("ip-3");
    expect(player()).toBe(instance);
    expect(player().muted()).toBe(false);
    expect(player().volume()).toBeCloseTo(0.3);
  });

  it("reflects playback state and pauses offscreen without advancing", async () => {
    await render();
    await waitForSource("ip-1");
    act(() => player().trigger("playing"));
    expect(container.querySelector('nav [aria-label="tv.nowPlaying"]')).not.toBeNull();
    act(() => player().trigger("waiting"));
    expect(container.querySelector('nav [aria-label="tv.nowPlaying"]')).toBeNull();
    const pause = vi.spyOn(player(), "pause");
    act(() =>
      observerCallback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    expect(pause).toHaveBeenCalled();
    act(() => player().trigger("ended"));
    expect(selected()).toContain("First IP");
    act(() =>
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    act(() => player().trigger("ended"));
    await waitForSource("ip-2");
  });

  it.each([
    ["video/quicktime", "mov", false, "video/mp4"],
    ["video/quicktime", "mov", true, "video/quicktime"],
    ["video/webm", "webm", false, "video/webm"],
    ["application/x-mpegURL", "m3u8", false, "application/x-mpegURL"],
  ])(
    "admits %s %s sources while preserving supported hints (%s)",
    async (type, extension, quicktimeSupported, expected) => {
      vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((mime) =>
        mime === "video/quicktime" && !quicktimeSupported ? "" : "probably"
      );
      const ip = makeIp("compat", "Compatibility");
      ip.trailerAsset = {
        ...ip.trailerAsset!,
        url: `https://cdn.test/compat.${extension}?version=1`,
        contentType: type,
      };
      harness.list.mockResolvedValue({ items: [ip], nextCursor: null });
      await render();
      await vi.waitFor(() => {
        expect(player().currentSrc()).toBe(ip.trailerAsset!.url);
        expect(player().currentType()).toBe(expected);
      });
    }
  );

  it("uses the same MOV admission when selecting a published episode", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((mime) =>
      mime === "video/quicktime" ? "" : "probably"
    );
    const ip = makeIp("ip-1", "First IP");
    const media = {
      ...ip.trailerAsset!,
      url: "https://cdn.test/episode.mov",
      contentType: "video/quicktime",
    };
    ip.episodes = [
      {
        id: "mov-episode",
        episodeNo: 1,
        title: "MOV episode",
        status: "published",
        mediaAsset: media,
      },
    ] as typeof ip.episodes;
    harness.list.mockResolvedValue({ items: [ip], nextCursor: null });
    await render();
    await waitForSource("ip-1");
    const select = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="tv.episodeSelector"]'
    )!;
    await act(async () => {
      select.querySelector<HTMLButtonElement>('[data-episode-id="mov-episode"]')!.click();
    });
    await vi.waitFor(() => {
      expect(player().currentSrc()).toBe(media.url);
      expect(player().currentType()).toBe("video/mp4");
    });
  });

  it("releases the previous stream before selecting a channel that cannot load", async () => {
    await render();
    await waitForSource("ip-1");
    const instance = player();
    act(() => {
      instance.muted(false);
      instance.volume(0.4);
    });
    const pause = vi.spyOn(instance, "pause");
    const reset = vi.spyOn(instance, "reset");
    // Source admission can fail before a replacement tech is attached.
    const setSource = vi.spyOn(instance, "src").mockImplementation(() => "");
    clickIp("Second IP");
    await vi.waitFor(() => expect(reset).toHaveBeenCalled());
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]!);
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
      setSource.mock.invocationCallOrder.at(-1)!
    );
    expect(instance.currentSrc()).not.toContain("ip-1.mp4");
    expect(instance.muted()).toBe(false);
    expect(instance.volume()).toBeCloseTo(0.4);
  });

  it("stops playback when a media error is reported", async () => {
    await render();
    await waitForSource("ip-1");
    const pause = vi.spyOn(player(), "pause");
    vi.spyOn(videojs.log, "error").mockImplementation(() => {});
    act(() => player().error("Unsupported replacement"));
    expect(pause).toHaveBeenCalled();
    expect(container.textContent).toContain("Unsupported replacement");
  });

  it("retries a failed source on the same player", async () => {
    await render();
    await waitForSource("ip-1");
    const instance = player();
    const setSource = vi.spyOn(instance, "src");
    vi.spyOn(videojs.log, "error").mockImplementation(() => {});
    act(() => player().error("Preview temporarily unavailable"));
    expect(container.textContent).toContain("Preview temporarily unavailable");
    act(() =>
      container.querySelector<HTMLButtonElement>('section [role="status"] button')!.click()
    );
    await waitForSource("ip-1");
    expect(player()).toBe(instance);
    expect(setSource).toHaveBeenCalledWith({ src: "https://cdn.test/ip-1.mp4", type: "video/mp4" });
    expect(container.textContent).not.toContain("Preview temporarily unavailable");
  });

  it("shows an empty list without inventing an aggregate channel", async () => {
    harness.list.mockResolvedValue({ items: [], nextCursor: null });
    await render();
    await waitForText("tv.noIps");
    expect(container.querySelectorAll("nav button")).toHaveLength(0);
    expect(container.querySelector("video")).toBeNull();
  });

  it("searches by room number or name through the shared catalog API", async () => {
    await render();
    await waitForText("First IP");
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.getAttribute("placeholder")).toBe("tv.searchPlaceholder");
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto?.set?.call(input, "100001");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "100001" }));
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(harness.get).toHaveBeenCalledWith(
      "/aurora/ip-commerce/ips",
      expect.objectContaining({
        params: expect.objectContaining({
          q: "100001",
        }),
      })
    );
  });

  it("shows upstream errors and retries the list request", async () => {
    harness.list.mockRejectedValueOnce(new Error("Catalog temporarily unavailable"));
    await render();
    await waitForText("Catalog temporarily unavailable");
    act(() =>
      container.querySelector<HTMLButtonElement>('nav button[aria-label="tv.retry"]')!.click()
    );
    await waitForText("First IP");
    clickIp("First IP");
    expect(selected()).toContain("First IP");
  });
  it("resolves a deep-linked IP and episode outside the loaded catalogue without substituting the first channel", async () => {
    const linked = makeIp("linked-ip", "Linked IP");
    linked.episodes = [
      {
        id: "linked-episode",
        episodeNo: 1,
        title: "Linked episode",
        status: "published",
        mediaAsset: { ...linked.trailerAsset!, url: "https://cdn.test/linked-episode.mp4" },
      },
    ] as typeof linked.episodes;
    harness.detail.mockResolvedValue({ ip: linked });
    await render(false, { initialIpId: linked.id, initialEpisodeId: "linked-episode" });
    await waitForSource("linked-episode");
    expect(harness.get).toHaveBeenCalledWith(
      "/aurora/ip-commerce/ips/linked-ip",
      expect.any(Object)
    );
    expect(
      container.querySelector('[data-episode-id="linked-episode"]')?.getAttribute("aria-pressed")
    ).toBe("true");
    expect(selected()).toBeUndefined();
  });
  it("does not substitute a trailer when the linked episode was removed", async () => {
    const linked = makeIp("linked-ip", "Linked IP");
    harness.detail.mockResolvedValue({ ip: linked });
    await render(false, { initialIpId: linked.id, initialEpisodeId: "withdrawn" });
    await waitForText("tv.entryUnavailable");
    expect(container.querySelector(".video-js")).toBeNull();
  });
  it("removes the player when a linked IP loses access and does not fall back to the catalogue", async () => {
    const linked = makeIp("linked-ip", "Linked IP");
    harness.detail.mockResolvedValue({ ip: linked });
    await render(false, { initialIpId: linked.id });
    await waitForSource("linked-ip");
    harness.detail.mockRejectedValue(new Error("IP unavailable"));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["tv", "selected-ip"] });
    });
    await waitForText("IP unavailable");
    expect(container.querySelector(".video-js")).toBeNull();
    expect(container.textContent).toContain("First IP");
  });
  it("keeps a deep-linked locked episode locked and exposes no full media", async () => {
    const linked = makeIp("linked-ip", "Linked IP");
    linked.episodes = [
      {
        id: "locked",
        episodeNo: 1,
        title: "Locked",
        status: "published",
        mediaLocked: true,
        mediaAsset: null,
      },
    ] as typeof linked.episodes;
    harness.detail.mockResolvedValue({ ip: linked });
    await render(false, { initialIpId: linked.id, initialEpisodeId: "locked" });
    await waitForText("Locked");
    expect(player().currentSrc()).toBe("");
    expect(
      container.querySelector('[data-episode-id="locked"]')?.getAttribute("aria-pressed")
    ).toBe("true");
    expect(harness.post).not.toHaveBeenCalled();
  });
});
