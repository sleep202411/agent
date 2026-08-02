// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { type UploadFileCheckpoint, uploadFileViaSignedUrl } from "./media-upload";

class SuccessfulUploadRequest {
  static instances: SuccessfulUploadRequest[] = [];

  method = "";
  url = "";
  status = 200;
  statusText = "OK";
  responseText = "";
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    SuccessfulUploadRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  send(file: File) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: file.size,
      total: file.size,
    } as ProgressEvent);
    this.onload?.();
  }

  abort() {
    this.onabort?.();
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  SuccessfulUploadRequest.instances = [];
  vi.unstubAllGlobals();
});

describe("uploadFileViaSignedUrl", () => {
  it("reports durable phases and emits a confirm-retry checkpoint after PUT", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          uploadUrl: "https://storage.example/upload",
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          storageKey: "crew/key.png",
          provider: "s3_compatible",
          expiresAt: "2026-07-29T20:00:00.000Z",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          mediaAssetId: "media-1",
          storageKey: "crew/key.png",
          provider: "s3_compatible",
          url: "/aurora/media/assets/media-1/content",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", SuccessfulUploadRequest);
    const stages: string[] = [];
    const checkpoints: UploadFileCheckpoint[] = [];
    const progress: number[] = [];

    const result = await uploadFileViaSignedUrl(
      new File(["image"], "concept.png", { type: "image/png" }),
      {
        kind: "crew_asset_file",
        scope: { crewId: "crew-1" },
        onStage: (stage) => stages.push(stage),
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
        onProgress: (value) => progress.push(value),
      }
    );

    expect(stages).toEqual(["signing", "uploading", "confirming"]);
    expect(progress).toEqual([100]);
    expect(checkpoints).toEqual([
      {
        storageKey: "crew/key.png",
        kind: "crew_asset_file",
        contentType: "image/png",
        scope: { crewId: "crew-1" },
      },
    ]);
    expect(SuccessfulUploadRequest.instances).toHaveLength(1);
    expect(result.mediaAssetId).toBe("media-1");
  });

  it("retries confirm from a matching checkpoint without uploading bytes again", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        mediaAssetId: "media-1",
        storageKey: "crew/key.png",
        provider: "s3_compatible",
        url: "/aurora/media/assets/media-1/content",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        constructor() {
          throw new Error("PUT must not run while resuming confirm");
        }
      }
    );
    const stages: string[] = [];
    const progress: number[] = [];

    await uploadFileViaSignedUrl(new File(["image"], "concept.png", { type: "image/png" }), {
      kind: "crew_asset_file",
      scope: { crewId: "crew-1" },
      resumeFrom: {
        storageKey: "crew/key.png",
        kind: "crew_asset_file",
        contentType: "image/png",
        scope: { crewId: "crew-1" },
      },
      onStage: (stage) => stages.push(stage),
      onProgress: (value) => progress.push(value),
    });

    expect(stages).toEqual(["confirming"]);
    expect(progress).toEqual([100]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/aurora/media/confirm");
  });
});
