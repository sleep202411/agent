// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExperiencePlaybackDelivery,
  experiencePrefersNativeHls,
} from "./experience-playback-delivery";
import {
  chooseWarmVariant,
  firstHlsSegment,
  parseHlsVariants,
  warmExperienceMedia,
  type ExperienceHlsVariant,
} from "./experience-media-warm";

vi.mock("./experience-playback-delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./experience-playback-delivery")>()),
  experiencePrefersNativeHls: vi.fn(() => false),
}));

const CONTENT = "/aurora/story-projects/p/builds/b/assets/a/variants/original/content";
const MASTER = "https://media.fizzspace.cn/hls/a/master.m3u8";

const MASTER_PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  "1080p.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  "720p.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2"',
  "480p.m3u8",
].join("\n");

const mediaPlaylist = (name: string) =>
  [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXTINF:6.000,",
    `${name}_0.ts`,
    "#EXTINF:6.000,",
    `${name}_1.ts`,
    "#EXT-X-ENDLIST",
  ].join("\r\n");

/** A delivery whose `/playback` answers with the HLS master above. */
function hlsDelivery(): ExperiencePlaybackDelivery {
  return new ExperiencePlaybackDelivery({
    adaptive: true,
    acceptsHls: () => true,
    fetch: async () =>
      new Response(
        JSON.stringify({
          code: 200,
          data: { url: MASTER, contentType: "application/vnd.apple.mpegurl" },
        }),
        { status: 200 }
      ),
  });
}

describe("warmExperienceMedia over HLS", () => {
  let cdn: ReturnType<typeof vi.fn<typeof fetch>>;
  let segmentBodies: string[];

  beforeEach(() => {
    segmentBodies = [];
    cdn = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === MASTER) return new Response(MASTER_PLAYLIST);
      const playlist = /\/(\d+p)\.m3u8$/.exec(url);
      if (playlist) return new Response(mediaPlaylist(playlist[1]!));
      if (url.endsWith(".ts")) {
        segmentBodies.push(url);
        return new Response(new Uint8Array(188));
      }
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", cdn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(experiencePrefersNativeHls).mockReturnValue(false);
  });

  it("fetches one rendition's playlist and only its first segment, credential-less", async () => {
    const delivery = hlsDelivery();
    const { signal } = new AbortController();

    await warmExperienceMedia({ src: CONTENT, type: "video/mp4" }, delivery, signal);

    // Cold start: nothing measured yet, so the best tier inside the 1.5 Mbps
    // budget hls.js itself assumes.
    expect(cdn.mock.calls.map(([url]) => String(url))).toEqual([
      MASTER,
      "https://media.fizzspace.cn/hls/a/480p.m3u8",
      "https://media.fizzspace.cn/hls/a/480p_0.ts",
    ]);
    for (const [, init] of cdn.mock.calls) {
      expect(init).toEqual({ mode: "cors", credentials: "omit", signal });
    }
    expect(segmentBodies).toEqual(["https://media.fizzspace.cn/hls/a/480p_0.ts"]);
    expect(delivery.warmedVariantFor(MASTER)).toBe("https://media.fizzspace.cn/hls/a/480p.m3u8");
  });

  it("warms the rendition the network last held", async () => {
    const delivery = hlsDelivery();
    delivery.recordLevelHeight(720);

    await warmExperienceMedia(
      { src: CONTENT, type: "video/mp4" },
      delivery,
      new AbortController().signal
    );

    expect(segmentBodies).toEqual(["https://media.fizzspace.cn/hls/a/720p_0.ts"]);
    expect(delivery.warmedVariantFor(MASTER)).toBe("https://media.fizzspace.cn/hls/a/720p.m3u8");
  });

  it("only negotiates where WebKit plays HLS natively", async () => {
    vi.mocked(experiencePrefersNativeHls).mockReturnValue(true);
    const delivery = hlsDelivery();

    await warmExperienceMedia(
      { src: CONTENT, type: "video/mp4" },
      delivery,
      new AbortController().signal
    );

    expect(cdn).not.toHaveBeenCalled();
    expect(delivery.peek({ src: CONTENT, type: "video/mp4" })?.delivery).toBe("hls");
  });

  it("rejects with the failing URL when the CDN refuses", async () => {
    cdn.mockImplementation(async () => new Response("denied", { status: 403 }));
    await expect(
      warmExperienceMedia(
        { src: CONTENT, type: "video/mp4" },
        hlsDelivery(),
        new AbortController().signal
      )
    ).rejects.toThrow(`HLS warm-up failed (HTTP 403): ${MASTER}`);
  });
});

describe("HLS playlist reading", () => {
  it("resolves rendition and segment URIs against the playlist that lists them", () => {
    expect(parseHlsVariants(MASTER_PLAYLIST, MASTER)).toEqual([
      { uri: "https://media.fizzspace.cn/hls/a/1080p.m3u8", height: 1080, bandwidth: 4_500_000 },
      { uri: "https://media.fizzspace.cn/hls/a/720p.m3u8", height: 720, bandwidth: 2_500_000 },
      { uri: "https://media.fizzspace.cn/hls/a/480p.m3u8", height: 480, bandwidth: 1_000_000 },
    ]);
    expect(
      firstHlsSegment(mediaPlaylist("720p"), "https://media.fizzspace.cn/hls/a/720p.m3u8")
    ).toBe("https://media.fizzspace.cn/hls/a/720p_0.ts");
    expect(
      firstHlsSegment(
        "#EXTM3U\n#EXTINF:5.0,\nhttps://edge.example.test/s/0.ts\n",
        "https://media.fizzspace.cn/hls/a/480p.m3u8"
      )
    ).toBe("https://edge.example.test/s/0.ts");
    expect(firstHlsSegment("#EXTM3U\n#EXT-X-ENDLIST\n", MASTER)).toBeNull();
  });
});

describe("chooseWarmVariant", () => {
  const ladder: ExperienceHlsVariant[] = [
    { uri: "1080p", height: 1080, bandwidth: 4_500_000 },
    { uri: "720p", height: 720, bandwidth: 2_500_000 },
    { uri: "480p", height: 480, bandwidth: 1_000_000 },
  ];

  it.each([
    ["the tier the network held", 720, ladder, "720p"],
    ["the best tier below a height the ladder lacks", 900, ladder, "720p"],
    ["the best tier inside the cold-start budget", null, ladder, "480p"],
    ["the budget when every tier is above the held height", 360, ladder, "480p"],
    [
      "the lightest tier when none fits the budget",
      null,
      [
        { uri: "1080p", height: 1080, bandwidth: 4_500_000 },
        { uri: "720p", height: 720, bandwidth: 2_500_000 },
      ],
      "720p",
    ],
  ] as const)("picks %s", (_label, height, variants, expected) => {
    expect(chooseWarmVariant(variants, height).uri).toBe(expected);
  });
});

describe("warmExperienceMedia over progressive files", () => {
  let load: ReturnType<typeof vi.spyOn>;
  // Settled by the warm-up's own createElement call. Not polled: polling under
  // fake timers would advance the very clock the timeout test reads.
  let warmElement: () => Promise<HTMLVideoElement>;

  beforeEach(() => {
    vi.useFakeTimers();
    load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    let created!: (video: HTMLVideoElement) => void;
    const element = new Promise<HTMLVideoElement>((resolve) => {
      created = resolve;
    });
    warmElement = () => element;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const made = createElement(tag);
      if (tag === "video") created(made as HTMLVideoElement);
      return made;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const progressive = { src: "https://media.example.test/next.mp4", type: "video/mp4" };
  const delivery = () => new ExperiencePlaybackDelivery({ adaptive: false });

  it("preloads on a detached muted element and releases it once it can play through", async () => {
    const warm = warmExperienceMedia(progressive, delivery(), new AbortController().signal);
    const video = await warmElement();

    expect(video.isConnected).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.preload).toBe("auto");
    expect(video.getAttribute("src")).toBe(progressive.src);
    expect(load).toHaveBeenCalledTimes(1);

    video.dispatchEvent(new Event("canplaythrough"));
    await expect(warm).resolves.toBeUndefined();

    expect(video.hasAttribute("src")).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects on a media error and still releases the element", async () => {
    const warm = warmExperienceMedia(progressive, delivery(), new AbortController().signal);
    const video = await warmElement();
    const rejected = expect(warm).rejects.toThrow(`Progressive warm-up failed: ${progressive.src}`);

    video.dispatchEvent(new Event("error"));

    await rejected;
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("gives up after eight seconds", async () => {
    const warm = warmExperienceMedia(progressive, delivery(), new AbortController().signal);
    const video = await warmElement();
    const rejected = expect(warm).rejects.toThrow("timed out after 8000 ms");

    await vi.advanceTimersByTimeAsync(7_999);
    expect(video.hasAttribute("src")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    await rejected;
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("stops at once when the plan moves on", async () => {
    const controller = new AbortController();
    const warm = warmExperienceMedia(progressive, delivery(), controller.signal);
    const video = await warmElement();
    const rejected = expect(warm).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();

    await rejected;
    expect(video.hasAttribute("src")).toBe(false);
  });
});
