import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFileViaSignedUrl } from "./media-upload";

beforeEach(() => {
  FakeXMLHttpRequest.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uploadFileViaSignedUrl", () => {
  it.each([
    [
      "screenshot.jpg",
      "image/jpeg",
      [137, 80, 78, 71, 13, 10, 26, 10],
      "image/png",
      "screenshot.png",
    ],
    ["photo.png", "image/png", [255, 216, 255, 224], "image/jpeg", "photo.jpg"],
    [
      "frame.jpg",
      "image/jpeg",
      [82, 73, 70, 70, 16, 0, 0, 0, 87, 69, 66, 80],
      "image/webp",
      "frame.webp",
    ],
  ] as const)(
    "corrects mislabeled %s consistently across signing, storage and confirmation",
    async (name, type, bytes, expected, normalizedName) => {
      const fetchMock = mockUploadPipeline({});
      vi.stubGlobal("fetch", fetchMock);
      await uploadFileViaSignedUrl(new File([new Uint8Array(bytes)], name, { type }), {
        kind: "canvas_input_image",
        contentType: type,
      });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        contentType: expected,
        fileName: normalizedName,
      });
      expect(FakeXMLHttpRequest.instances[0]?.headers.get("Content-Type")).toBe(expected);
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
        contentType: expected,
      });
    }
  );

  it("uses the canonical extension content type when the browser omits file.type", async () => {
    const fetchMock = mockUploadPipeline({ "x-storage-header": "signed" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFileViaSignedUrl(new File(["image"], "frame.png", { type: "" }), {
      kind: "ai_reference_image",
      workspaceId: "workspace-1",
      scope: { storyProjectId: "project-1" },
    });

    expect(FakeXMLHttpRequest.instances[0]?.headers).toEqual(
      new Map([
        ["Content-Type", "image/png"],
        ["x-storage-header", "signed"],
      ])
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      kind: "ai_reference_image",
      contentType: "image/png",
      fileName: "frame.png",
      scope: { storyProjectId: "project-1" },
    });
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.headers).not.toHaveProperty("x-fizz-workspace-id");
    }
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      scope: { storyProjectId: "project-1" },
      kind: "ai_reference_image",
      contentType: "image/png",
    });
    expect(result).toEqual({
      mediaAssetId: "asset-1",
      variantId: "variant-1",
      storageKey: "reference/frame.png",
      url: "https://media.example.test/frame.png",
    });
  });

  it.each([
    ["constructor", "image/png"],
    ["__proto__", "application/octet-stream"],
  ])("uses the normal MIME fallback for extension %s", async (extension, expected) => {
    const fetchMock = mockUploadPipeline({});
    vi.stubGlobal("fetch", fetchMock);
    await uploadFileViaSignedUrl(
      new File(["image"], `frame.${extension}`, {
        type: extension === "constructor" ? "image/png" : "",
      }),
      { kind: "ai_reference_image" }
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      contentType: expected,
    });
    expect(FakeXMLHttpRequest.instances[0]?.headers.get("Content-Type")).toBe(expected);
  });

  it("lets a provider-signed content type override the canonical default case-insensitively", async () => {
    vi.stubGlobal("fetch", mockUploadPipeline({ "content-type": "image/provider-signed" }));

    await uploadFileViaSignedUrl(new File(["image"], "frame.png", { type: "" }), {
      kind: "ai_reference_image",
    });

    expect(FakeXMLHttpRequest.instances[0]?.headers).toEqual(
      new Map([["content-type", "image/provider-signed"]])
    );
  });

  it("removes the cancellation listener when starting the storage request throws", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const add = vi.spyOn(controller.signal, "addEventListener");
    const error = new DOMException("Network unavailable", "NetworkError");
    vi.spyOn(FakeXMLHttpRequest.prototype, "send").mockImplementation(() => {
      throw error;
    });
    const fetchMock = mockUploadPipeline({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png"), {
        kind: "ai_reference_image",
        signal: controller.signal,
      })
    ).rejects.toBe(error);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to start once the caller has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png", { type: "image/png" }), {
        kind: "ai_reference_image",
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a media URL on the confirmed asset", async () => {
    vi.stubGlobal("fetch", mockUploadPipeline({}, { mediaAssetId: "asset-1" }));

    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png", { type: "image/png" }), {
        kind: "canvas_input_image",
      })
    ).rejects.toThrow("returned no media URL");
  });

  it("requires an original variant on the confirmed asset", async () => {
    vi.stubGlobal(
      "fetch",
      mockUploadPipeline(
        {},
        { mediaAssetId: "asset-1", url: "https://media.example.test/frame.png" }
      )
    );

    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png", { type: "image/png" }), {
        kind: "canvas_input_image",
      })
    ).rejects.toThrow("returned no original media variant");
  });
  it.each([
    [1, { code: 403, success: true }],
    [2, { code: 403, success: true }],
    [1, { code: 200, success: false }],
    [2, { code: 200, success: false }],
  ] as const)("rejects contradictory status fields at stage %s (%j)", async (stage, status) => {
    const base = mockUploadPipeline({});
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (...args) => {
        const response = await base(...args);
        if (++calls !== stage) return response;
        const body = await response.json();
        return {
          ...response,
          json: async () => ({ ...body, ...status, message: "Upload permission denied" }),
        } as Response;
      })
    );
    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png"), { kind: "canvas_input_image" })
    ).rejects.toThrow("Upload permission denied");
    expect(base).toHaveBeenCalledTimes(stage);
    expect(FakeXMLHttpRequest.instances).toHaveLength(stage - 1);
  });

  it.each([1, 2])("rejects a failed application envelope at upload stage %s", async (stage) => {
    const base = mockUploadPipeline({});
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (...args) => {
        const response = await base(...args);
        calls += 1;
        if (calls !== stage) return response;
        const body = await response.json();
        return {
          ...response,
          json: async () => ({ ...body, code: 403, message: "Upload permission denied" }),
        } as Response;
      })
    );
    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png"), { kind: "canvas_input_image" })
    ).rejects.toThrow("Upload permission denied");
    expect(base).toHaveBeenCalledTimes(stage);
    expect(FakeXMLHttpRequest.instances).toHaveLength(stage - 1);
  });

  it.each([1, 2])("abandons a delayed parsed response at upload stage %s", async (stage) => {
    const controller = new AbortController();
    const base = mockUploadPipeline({});
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (...args) => {
        const response = await base(...args);
        calls += 1;
        if (calls !== stage) return response;
        return {
          ...response,
          json: async () => {
            const body = await response.json();
            controller.abort();
            return body;
          },
        } as Response;
      })
    );
    await expect(
      uploadFileViaSignedUrl(new File(["image"], "frame.png"), {
        kind: "canvas_input_image",
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(base).toHaveBeenCalledTimes(stage);
    expect(FakeXMLHttpRequest.instances).toHaveLength(stage - 1);
  });

  it.each(["plain", "success", "SUCCESS", "both"])(
    "retains supported %s upload responses",
    async (format) => {
      const base = mockUploadPipeline({});
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (...args) => {
          const response = await base(...args);
          const body = await response.json();
          return {
            ...response,
            json: async () =>
              format === "plain"
                ? body.data
                : format === "success"
                  ? { success: true, data: body.data }
                  : format === "both"
                    ? { code: 200, success: true, data: body.data }
                    : { code: "SUCCESS", data: body.data },
          } as Response;
        })
      );
      await expect(
        uploadFileViaSignedUrl(new File(["image"], "frame.png"), { kind: "canvas_input_image" })
      ).resolves.toMatchObject({ mediaAssetId: "asset-1", variantId: "variant-1" });
    }
  );
});

function mockUploadPipeline(headers: Record<string, string>, confirmed?: object) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({
        uploadUrl: "https://storage.example.test/upload",
        method: "PUT",
        headers,
        storageKey: "reference/frame.png",
        provider: "aliyun_oss",
        expiresAt: "2026-07-17T12:00:00.000Z",
      })
    )
    .mockResolvedValueOnce(
      jsonResponse(
        confirmed ?? {
          mediaAssetId: "asset-1",
          variantId: "variant-1",
          storageKey: "reference/frame.png",
          provider: "aliyun_oss",
          url: "https://media.example.test/frame.png",
        }
      )
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
