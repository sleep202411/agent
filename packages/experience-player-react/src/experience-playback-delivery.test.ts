// @vitest-environment jsdom

import type { MediaProviderAdapter } from "@vidstack/react";
import { describe, expect, it, vi } from "vitest";
import {
  ExperiencePlaybackDelivery,
  configureExperienceMediaProvider,
  type ExperienceDeclaredSource,
} from "./experience-playback-delivery";

const CONTENT = "/aurora/story-projects/p/builds/b/assets/a/variants/original/content";
const PLAYBACK = "/aurora/story-projects/p/builds/b/assets/a/variants/original/playback";
const MASTER = "https://media.fizzspace.cn/hls/a/master.m3u8";
const CLIP: ExperienceDeclaredSource = { src: CONTENT, type: "video/mp4" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hlsAnswer(): Response {
  return jsonResponse(200, {
    code: 200,
    data: { url: MASTER, contentType: "application/vnd.apple.mpegurl" },
  });
}

/** A delivery whose server answers come from `answers`, in order. */
function deliveryWith(
  answers: Array<Response | Promise<Response>>,
  options: { adaptive?: boolean; acceptsHls?: () => boolean } = {}
) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    const next = answers.shift();
    if (!next) throw new Error("Unexpected negotiation request.");
    return Promise.resolve(next);
  });
  const delivery = new ExperiencePlaybackDelivery({
    adaptive: options.adaptive ?? true,
    fetch,
    acceptsHls: options.acceptsHls ?? (() => true),
  });
  return { delivery, fetch };
}

describe("ExperiencePlaybackDelivery negotiation", () => {
  it("plays the declared file synchronously when adaptive playback is off", async () => {
    const { delivery, fetch } = deliveryWith([], { adaptive: false });
    const source = delivery.peek(CLIP);
    expect(source).toEqual({
      src: CONTENT,
      type: "video/mp4",
      delivery: "progressive",
      declaredSrc: CONTENT,
    });
    await expect(delivery.resolve(CLIP)).resolves.toBe(source);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never negotiates media that is not a frozen build clip", () => {
    const { delivery, fetch } = deliveryWith([]);
    const declared = { src: "https://media.example.test/clip.mp4", type: "video/mp4" };
    expect(delivery.peek(declared)).toMatchObject({ delivery: "progressive", src: declared.src });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not ask for HLS a browser could not play", () => {
    const acceptsHls = vi.fn(() => false);
    const { delivery, fetch } = deliveryWith([], { acceptsHls });
    expect(delivery.peek(CLIP)?.delivery).toBe("progressive");
    expect(delivery.peek({ ...CLIP, src: CONTENT.replace("/a/", "/b/") })?.delivery).toBe(
      "progressive"
    );
    expect(fetch).not.toHaveBeenCalled();
    // Asked once per delivery, not per clip.
    expect(acceptsHls).toHaveBeenCalledTimes(1);
  });

  it("swaps a build clip for the HLS master the server offers", async () => {
    const { delivery, fetch } = deliveryWith([hlsAnswer()]);
    expect(delivery.peek(CLIP)).toBeUndefined();

    const source = await delivery.resolve(CLIP);

    expect(source).toEqual({
      src: MASTER,
      type: "application/vnd.apple.mpegurl",
      delivery: "hls",
      declaredSrc: CONTENT,
    });
    expect(fetch).toHaveBeenCalledWith(PLAYBACK, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    // Settled answers are stable, so they can key a render.
    expect(delivery.peek(CLIP)).toBe(source);
    expect(delivery.peek(CLIP)).toBe(source);
  });

  it("keeps the declared file when the server has no HLS for the clip", async () => {
    const { delivery } = deliveryWith([jsonResponse(200, { code: 200, data: null })]);
    await expect(delivery.resolve(CLIP)).resolves.toEqual({
      src: CONTENT,
      type: "video/mp4",
      delivery: "progressive",
      declaredSrc: CONTENT,
    });
  });

  it("tolerates extra envelope keys", async () => {
    const { delivery } = deliveryWith([
      jsonResponse(200, {
        code: 200,
        msg: "ok",
        traceId: "t-1",
        data: { url: MASTER, contentType: "application/vnd.apple.mpegurl" },
      }),
    ]);
    await expect(delivery.resolve(CLIP)).resolves.toMatchObject({ delivery: "hls", src: MASTER });
  });

  it.each([
    [403, { code: "STORY_BUILD_ASSET_MODERATION_BLOCKED", message: "This clip is unavailable." }],
    [410, { code: "STORY_BUILD_ASSET_DELETED", message: "This clip was removed." }],
  ])("surfaces a %s refusal verbatim", async (status, body) => {
    const { delivery } = deliveryWith([jsonResponse(status, body)]);
    await expect(delivery.resolve(CLIP)).rejects.toThrow(body.message);
  });

  it("names the HTTP status when a refusal carries no message", async () => {
    const { delivery } = deliveryWith([new Response("<html>Bad gateway</html>", { status: 502 })]);
    await expect(delivery.resolve(CLIP)).rejects.toThrow("Playback negotiation failed (HTTP 502)");
  });

  it("refuses an answer that breaks the contract, naming where", async () => {
    const { delivery } = deliveryWith([
      jsonResponse(200, {
        code: 200,
        data: {
          url: "ftp://media.fizzspace.cn/hls/a/master.m3u8",
          contentType: "application/vnd.apple.mpegurl",
        },
      }),
    ]);
    await expect(delivery.resolve(CLIP)).rejects.toThrow(
      /^Playback negotiation returned an invalid response: data\.url: /
    );
  });

  it("asks once for any number of concurrent callers", async () => {
    let answer!: (response: Response) => void;
    const { delivery, fetch } = deliveryWith([
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    ]);
    const first = delivery.resolve(CLIP);
    const second = delivery.resolve(CLIP);
    answer(hlsAnswer());
    const [left, right] = await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(left).toBe(right);
  });

  it("does not remember a failure", async () => {
    const { delivery, fetch } = deliveryWith([
      jsonResponse(503, { code: "UNAVAILABLE", message: "Try again." }),
      hlsAnswer(),
    ]);
    await expect(delivery.resolve(CLIP)).rejects.toThrow("Try again.");
    expect(delivery.peek(CLIP)).toBeUndefined();
    await expect(delivery.resolve(CLIP)).resolves.toMatchObject({ delivery: "hls" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("asks again once an answer is forgotten", async () => {
    const { delivery, fetch } = deliveryWith([hlsAnswer(), hlsAnswer()]);
    await delivery.resolve(CLIP);
    delivery.markStaged(CONTENT);
    delivery.forget(CONTENT);
    expect(delivery.peek(CLIP)).toBeUndefined();
    expect(delivery.hasStagedOrWarmed(CONTENT)).toBe(false);
    await delivery.resolve(CLIP);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("tracks what is already on stage or warm", () => {
    const { delivery } = deliveryWith([]);
    expect(delivery.hasStagedOrWarmed(CONTENT)).toBe(false);
    delivery.markStaged(CONTENT);
    delivery.markWarmed("/next.mp4");
    expect(delivery.hasStagedOrWarmed(CONTENT)).toBe(true);
    expect(delivery.hasStagedOrWarmed("/next.mp4")).toBe(true);
  });

  it("follows the rendition height the network last held", () => {
    const { delivery } = deliveryWith([]);
    expect(delivery.lastLevelHeight).toBeNull();
    delivery.recordLevelHeight(720);
    delivery.recordLevelHeight(undefined);
    delivery.recordLevelHeight(0);
    expect(delivery.lastLevelHeight).toBe(720);
  });
});

/** The slice of hls.js the provider hooks touch. */
class FakeHls {
  static Events = {
    LEVEL_SWITCHED: "hlsLevelSwitched",
    MANIFEST_PARSED: "hlsManifestParsed",
  } as const;
  url: string | null = MASTER;
  levels: Array<{ height: number; uri: string }> = [];
  startLevel = -1;
  private readonly handlers = new Map<string, Array<(event: string, data: unknown) => void>>();

  on(event: string, handler: (event: string, data: unknown) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  emit(event: string, data: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(event, data));
  }
}

function fakeHlsProvider() {
  const instances: Array<(hls: FakeHls) => void> = [];
  const provider = {
    $$PROVIDER_TYPE: "HLS",
    library: "https://cdn.jsdelivr.net/npm/hls.js@^1.5.0/dist/hls.js" as unknown,
    config: {} as Record<string, unknown>,
    onInstance: vi.fn((callback: (hls: FakeHls) => void) => {
      instances.push(callback);
      return () => undefined;
    }),
  };
  const attach = () => {
    const hls = new FakeHls();
    instances.forEach((callback) => callback(hls));
    return hls;
  };
  return { provider, adapter: provider as unknown as MediaProviderAdapter, attach };
}

const LEVELS = [
  { height: 480, uri: "https://media.fizzspace.cn/hls/a/480p.m3u8" },
  { height: 720, uri: "https://media.fizzspace.cn/hls/a/720p.m3u8" },
  { height: 1080, uri: "https://media.fizzspace.cn/hls/a/1080p.m3u8" },
];

describe("configureExperienceMediaProvider", () => {
  it("bundles hls.js through an arrow-function loader instead of the CDN default", async () => {
    const { provider, adapter } = fakeHlsProvider();
    configureExperienceMediaProvider(adapter, null);

    expect(typeof provider.library).toBe("function");
    // Vidstack calls a library with a prototype as the hls.js constructor.
    expect((provider.library as () => unknown).prototype).toBeUndefined();
    expect(provider.config).toEqual({
      capLevelToPlayerSize: true,
      abrEwmaDefaultEstimate: 1_500_000,
    });
    const loaded = (await (provider.library as () => Promise<{ default: unknown }>)()).default;
    expect(typeof (loaded as { isSupported?: unknown }).isSupported).toBe("function");
  });

  it("hands the providers below a delivery the hls.js it imported for an HLS answer", async () => {
    const { delivery } = deliveryWith([jsonResponse(200, { code: 200, data: null }), hlsAnswer()]);
    await delivery.resolve(CLIP);
    // A clip with no HLS needs no hls.js.
    expect(delivery.hlsLibrary).toBeUndefined();

    await delivery.resolve({ ...CLIP, src: CONTENT.replace("/a/", "/b/") });

    // The constructor itself: handed a loader, Vidstack offers the element the
    // stream while the import is on its way, and Chrome starts loading it natively.
    const { default: Hls } = await import("hls.js");
    expect(delivery.hlsLibrary).toBe(Hls);
    const { provider, adapter } = fakeHlsProvider();
    configureExperienceMediaProvider(adapter, delivery);
    expect(provider.library).toBe(Hls);
  });

  it("leaves non-HLS providers and already-configured ones alone", () => {
    const video = { $$PROVIDER_TYPE: "VIDEO", library: undefined };
    configureExperienceMediaProvider(video as unknown as MediaProviderAdapter, null);
    expect(video.library).toBeUndefined();
    configureExperienceMediaProvider(null, null);

    const { provider, adapter } = fakeHlsProvider();
    configureExperienceMediaProvider(adapter, null);
    configureExperienceMediaProvider(adapter, null);
    expect(provider.onInstance).toHaveBeenCalledTimes(1);
  });

  it("opens on the rendition the look-ahead warmed", () => {
    const { delivery } = deliveryWith([]);
    delivery.recordWarmedVariant(MASTER, "https://media.fizzspace.cn/hls/a/720p.m3u8");
    const { adapter, attach } = fakeHlsProvider();
    configureExperienceMediaProvider(adapter, delivery);
    const hls = attach();

    hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: LEVELS });

    expect(hls.startLevel).toBe(1);
  });

  it("leaves the start level to hls.js when nothing was warmed", () => {
    const { delivery } = deliveryWith([]);
    const { adapter, attach } = fakeHlsProvider();
    configureExperienceMediaProvider(adapter, delivery);
    const hls = attach();

    hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: LEVELS });

    expect(hls.startLevel).toBe(-1);
  });

  it("records the height of every rendition hls.js switches to", () => {
    const { delivery } = deliveryWith([]);
    const { adapter, attach } = fakeHlsProvider();
    configureExperienceMediaProvider(adapter, delivery);
    const hls = attach();
    hls.levels = LEVELS;

    hls.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 2 });
    expect(delivery.lastLevelHeight).toBe(1080);
    hls.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 0 });
    expect(delivery.lastLevelHeight).toBe(480);
  });
});
