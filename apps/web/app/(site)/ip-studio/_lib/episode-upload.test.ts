// @vitest-environment node
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EPISODE_SOURCE_MAX_BYTES } from "@repo/shared";

const partSize = 8;
const fileBytes = "12345678abcdefghijk";
const file = (bytes = fileBytes) =>
  new File([bytes], "episode.mp4", { type: "video/mp4", lastModified: 123 });
let stored: Map<number, Uint8Array>;
let sends: number[];
let failPart: number | undefined;
let transientFailures: number;
let holdPart: number | undefined;
let uploaded: boolean;
let completeCalls: number;
let loseComplete: boolean;

class Request {
  url = "";
  status = 200;
  responseText = "";
  timeout = 0;
  cancelled = false;
  upload: { onprogress?: (event: { loaded: number }) => void } = {};
  onload?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  send(blob: Blob) {
    const number = Number(this.url.split("/").pop());
    sends.push(number);
    if (number === holdPart) return;
    void blob.arrayBuffer().then((buffer) => {
      if (this.cancelled) return;
      if (number === failPart || transientFailures > 0) {
        this.status = transientFailures-- > 0 ? 503 : 400;
      } else {
        stored.set(number, new Uint8Array(buffer));
        this.upload.onprogress?.({ loaded: blob.size });
      }
      this.onload?.();
    });
  }
  abort() {
    this.cancelled = true;
    this.onabort?.();
  }
}

beforeEach(() => {
  vi.resetModules();
  stored = new Map();
  sends = [];
  failPart = undefined;
  transientFailures = 0;
  holdPart = undefined;
  uploaded = false;
  completeCalls = 0;
  loseComplete = false;
  const persistence = new Map<string, string>();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("document", { documentElement: { lang: "en-US" }, cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => persistence.get(key) ?? null,
    setItem: (key: string, value: string) => persistence.set(key, value),
    removeItem: (key: string) => persistence.delete(key),
  });
  vi.stubGlobal(
    "DOMParser",
    class {
      parseFromString() {
        return { querySelector: () => null };
      }
    }
  );
  vi.stubGlobal("XMLHttpRequest", Request);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const input = init.body
        ? (JSON.parse(String(init.body)) as { id: string; sizeBytes: number })
        : null;
      if (url.endsWith("/episode-uploads"))
        return Response.json({
          id: input!.id,
          partSize,
          sizeBytes: input!.sizeBytes,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          uploaded,
          parts: uploaded
            ? []
            : Array.from(stored, ([number, bytes]) => ({ number, sizeBytes: bytes.length })),
        });
      if (url.includes("/parts/"))
        return Response.json({ url: `https://storage.test/${url.split("/").pop()}`, headers: {} });
      if (url.endsWith("/complete")) {
        completeCalls++;
        uploaded = true;
        if (loseComplete) {
          loseComplete = false;
          return Response.json({ message: "Storage response lost" }, { status: 503 });
        }
        return Response.json({
          mediaAssetId: "asset",
          storageKey: "key",
          url: "https://storage.test/video",
        });
      }
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${url}`);
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("episode video upload", () => {
  const options = () => ({ scopeKey: "ip", signal: new AbortController().signal });

  it("uploads bounded blobs, reports progress, and only then confirms", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    const stages: string[] = [];
    const progress: number[] = [];
    await expect(
      uploadEpisodeVideo(file(), {
        ...options(),
        onStage: (stage) => stages.push(stage),
        onProgress: (value) => progress.push(value),
      })
    ).resolves.toMatchObject({ mediaAssetId: "asset" });
    expect([...stored.values()].map((bytes) => bytes.length).sort()).toEqual([3, 8, 8]);
    expect(Buffer.concat([1, 2, 3].map((number) => stored.get(number)!)).toString()).toBe(
      fileBytes
    );
    expect(stages).toEqual(["uploading", "confirming"]);
    expect(progress.at(-1)).toBe(100);
    expect(completeCalls).toBe(1);
  });

  it("automatically retries transient part failures with a fresh URL", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    transientFailures = 1;
    await uploadEpisodeVideo(file(), options());
    expect(sends.length).toBe(4);
    expect(completeCalls).toBe(1);
  });

  it("preserves a non-JSON HTTP rejection without retrying it as a network failure", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    vi.mocked(fetch).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(uploadEpisodeVideo(file(), options())).rejects.toMatchObject({
      message: "HTTP 401",
      status: 401,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sends).toEqual([]);
    expect(completeCalls).toBe(0);
  }, 15_000);

  it("preserves a rejection whose JSON body is null", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    vi.mocked(fetch).mockResolvedValue(Response.json(null, { status: 403 }));
    await expect(uploadEpisodeVideo(file(), options())).rejects.toMatchObject({
      message: "HTTP 403",
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still retries a non-JSON temporary server failure", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(uploadEpisodeVideo(file(), options())).resolves.toMatchObject({
      mediaAssetId: "asset",
    });
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/episode-uploads"))
    ).toHaveLength(2);
    expect(completeCalls).toBe(1);
  });

  it("resumes verified parts after a failed upload instead of starting over", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    failPart = 3;
    await expect(uploadEpisodeVideo(file(), options())).rejects.toThrow("HTTP 400");
    expect(completeCalls).toBe(0);
    const before = new Map(stored);
    failPart = undefined;
    const sentBefore = sends.length;
    await uploadEpisodeVideo(file(), options());
    for (const number of before.keys()) expect(sends.slice(sentBefore)).not.toContain(number);
    expect(completeCalls).toBe(1);
  });

  it("rejects changed bytes in an uploaded part when file metadata matches", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    const controller = new AbortController();
    // Native hashing can settle in any order. Persist part one's fingerprint
    // before interrupting the upload, so this retry changes verified evidence.
    await expect(
      uploadEpisodeVideo(file(), {
        ...options(),
        signal: controller.signal,
        onProgress: () => {
          if (stored.has(1)) controller.abort();
        },
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(stored.has(1)).toBe(true);
    await expect(uploadEpisodeVideo(file("XXXXXXXXabcdefghijk"), options())).rejects.toThrow(
      "differs from the original"
    );
    expect(completeCalls).toBe(0);
  });

  it("recovers a lost completion response without re-uploading the video", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    loseComplete = true;
    await uploadEpisodeVideo(file(), options());
    expect(completeCalls).toBe(2);
    expect(sends).toHaveLength(3);
  });

  it("aborts in-flight parts and never confirms after cancellation", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    holdPart = 3;
    const controller = new AbortController();
    const promise = uploadEpisodeVideo(file(), { scopeKey: "ip", signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(sends).toContain(3));
    controller.abort();
    await assertion;
    expect(completeCalls).toBe(0);
  });

  it("rejects oversize input before reading or transmitting it", async () => {
    const { uploadEpisodeVideo } = await import("./episode-upload");
    const oversized = file();
    Object.defineProperty(oversized, "size", { value: EPISODE_SOURCE_MAX_BYTES + 1 });
    await expect(uploadEpisodeVideo(oversized, options())).rejects.toThrow("35 GB");
    expect(fetch).not.toHaveBeenCalled();
  });
});
