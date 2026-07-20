import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFileViaSignedUrl } from "./media-upload";

beforeEach(() => {
  FakeXMLHttpRequest.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFileViaSignedUrl", () => {
  it("fails before signing when a Story upload has no ownership scope", async () => {
    await expect(
      uploadFileViaSignedUrl(new File(["video"], "scene.mp4", { type: "video/mp4" }), {
        kind: "story_clip_video",
      })
    ).rejects.toThrow("require a workspace and project scope");
  });

  it("rejects non-MP4 Story clips before reserving an upload", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFileViaSignedUrl(new File(["video"], "scene.mov", { type: "video/quicktime" }), {
        kind: "story_clip_video",
        workspaceId: "workspace-1",
        scope: { projectId: "project-1" },
      })
    ).rejects.toThrow("require an MP4 file");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the canonical extension content type when the browser omits file.type", async () => {
    const fetchMock = mockUploadPipeline({ "x-storage-header": "signed" });
    vi.stubGlobal("fetch", fetchMock);
    const onSessionIssued = vi.fn();

    const result = await uploadFileViaSignedUrl(new File(["video"], "scene.mp4", { type: "" }), {
      kind: "story_clip_video",
      workspaceId: "workspace-1",
      scope: { projectId: "project-1" },
      onSessionIssued,
    });

    expect(FakeXMLHttpRequest.instances[0]?.headers).toEqual(
      new Map([
        ["Content-Type", "video/mp4"],
        ["x-storage-header", "signed"],
      ])
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      kind: "story_clip_video",
      contentType: "video/mp4",
      fileName: "scene.mp4",
      scope: { projectId: "project-1" },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-fizz-workspace-id": "workspace-1",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      kind: "story_clip_video",
      contentType: "video/mp4",
      uploadSessionId: "upload-session-1",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-fizz-workspace-id": "workspace-1",
    });
    expect(result).toEqual({
      mediaAssetId: "asset-1",
      storageKey: "story/scene.mp4",
      url: null,
    });
    expect(onSessionIssued).toHaveBeenCalledWith({
      uploadSessionId: "upload-session-1",
      mediaAssetId: "asset-1",
    });
  });

  it("recovers the durable session identity when the caller aborts during issuance", async () => {
    const controller = new AbortController();
    let resolveIssue!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveIssue = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSessionIssued = vi.fn();

    const upload = uploadFileViaSignedUrl(new File(["video"], "scene.mp4", { type: "video/mp4" }), {
      kind: "story_clip_video",
      workspaceId: "workspace-1",
      scope: { projectId: "project-1" },
      onSessionIssued,
      signal: controller.signal,
    });
    controller.abort();
    resolveIssue(
      jsonResponse({
        uploadUrl: "https://storage.example.test/upload",
        method: "PUT",
        headers: {},
        storageKey: "story/scene.mp4",
        provider: "aliyun_oss",
        expiresAt: "2026-07-17T12:00:00.000Z",
        uploadSessionId: "upload-session-1",
        mediaAssetId: "asset-1",
      })
    );

    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
    expect(onSessionIssued).toHaveBeenCalledWith({
      uploadSessionId: "upload-session-1",
      mediaAssetId: "asset-1",
    });
    expect(FakeXMLHttpRequest.instances).toHaveLength(0);
  });

  it("lets a provider-signed content type override the canonical default case-insensitively", async () => {
    vi.stubGlobal("fetch", mockUploadPipeline({ "content-type": "video/provider-signed" }));

    await uploadFileViaSignedUrl(new File(["video"], "scene.mp4", { type: "" }), {
      kind: "story_clip_video",
      workspaceId: "workspace-1",
      scope: { projectId: "project-1" },
    });

    expect(FakeXMLHttpRequest.instances[0]?.headers).toEqual(
      new Map([["content-type", "video/provider-signed"]])
    );
  });

  it("still requires a media URL for ordinary uploads", async () => {
    vi.stubGlobal("fetch", mockUploadPipeline({}));

    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png", { type: "image/png" }), {
        kind: "canvas_input_image",
      })
    ).rejects.toThrow("returned no media URL");
  });
});

function mockUploadPipeline(headers: Record<string, string>) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({
        uploadUrl: "https://storage.example.test/upload",
        method: "PUT",
        headers,
        storageKey: "story/scene.mp4",
        provider: "aliyun_oss",
        expiresAt: "2026-07-17T12:00:00.000Z",
        uploadSessionId: "upload-session-1",
        mediaAssetId: "asset-1",
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        mediaAssetId: "asset-1",
        storageKey: "story/scene.mp4",
        provider: "aliyun_oss",
      })
    );
}

function jsonResponse(data: object): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ code: 200, data }),
  } as unknown as Response;
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  readonly upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  readonly headers = new Map<string, string>();
  status = 200;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(): void {}

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  send(): void {
    queueMicrotask(() => this.onload?.());
  }

  abort(): void {
    this.onabort?.();
  }
}
