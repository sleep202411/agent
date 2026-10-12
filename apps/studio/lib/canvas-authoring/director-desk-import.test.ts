// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import {
  dataUrlToFile,
  DIRECTOR_DESK_CAPTURE_REQUEST,
  DIRECTOR_DESK_CAPTURES_SENT,
  directorDeskSrc,
  importDirectorCaptures,
  isDirectorDeskOrigin,
  parseDirectorCapturesMessage,
  parseDirectorDeskCommandError,
  requestDirectorDeskCapture,
} from "./director-desk-import";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

it("accepts the director-desk capture postMessage", () => {
  const parsed = parseDirectorCapturesMessage({
    type: DIRECTOR_DESK_CAPTURES_SENT,
    payload: {
      instanceId: "project-1",
      operationId: "op-1",
      captures: [{ dataUrl: PNG, fileName: "shot.png", captureId: "c1" }],
    },
  });
  expect(parsed?.payload.operationId).toBe("op-1");
  expect(parsed?.payload.captures).toHaveLength(1);
});

it("accepts the official staging capture result", () => {
  const parsed = parseDirectorCapturesMessage({
    type: "workbench:staging-result",
    requestId: "req-1",
    result: { capture: { dataUrl: PNG, fileName: "shot.png" } },
  });
  expect(parsed?.payload.operationId).toBe("req-1");
  expect(parsed?.payload.captures[0]?.fileName).toBe("shot.png");
  expect(
    parseDirectorDeskCommandError({
      type: "workbench:staging-result",
      requestId: "req-1",
      error: "渲染器未就绪，请重新连接导演台",
    })
  ).toContain("渲染器未就绪");
});

it("rejects other messages and empty batches", () => {
  expect(parseDirectorCapturesMessage({ type: "other" })).toBeNull();
  expect(
    parseDirectorCapturesMessage({
      type: DIRECTOR_DESK_CAPTURES_SENT,
      payload: { operationId: "op", captures: [{ dataUrl: "https://x/a.png" }] },
    })
  ).toBeNull();
});

it("asks the embedded desk to capture", () => {
  const postMessage = vi.fn();
  requestDirectorDeskCapture({ postMessage } as unknown as Window);
  expect(postMessage).toHaveBeenCalledWith(
    { type: DIRECTOR_DESK_CAPTURE_REQUEST },
    "https://java.fizzdragon.com"
  );
  requestDirectorDeskCapture({ postMessage } as unknown as Window, "cn");
  expect(postMessage).toHaveBeenCalledWith(
    { type: DIRECTOR_DESK_CAPTURE_REQUEST },
    "https://java.fizzspace.cn"
  );
});

it("builds an embed iframe URL for the current project", () => {
  const src = directorDeskSrc("project-1", "http://127.0.0.1:9540");
  expect(src).toContain("https://java.fizzdragon.com/");
  expect(src).toContain("instanceId=project-1");
  expect(src).toContain("embed=1");
  expect(src).toContain("stagingHost=http%3A%2F%2F127.0.0.1%3A9540");
  expect(directorDeskSrc("project-1", undefined, "cn")).toContain("https://java.fizzspace.cn/");
});

it("trusts the deployed desk and local sidecar hosts", () => {
  expect(isDirectorDeskOrigin("https://java.fizzdragon.com")).toBe(true);
  expect(isDirectorDeskOrigin("https://java.fizzspace.cn")).toBe(true);
  expect(isDirectorDeskOrigin("http://127.0.0.1:5174")).toBe(true);
  expect(isDirectorDeskOrigin("http://127.0.0.1:5173")).toBe(true);
  expect(isDirectorDeskOrigin("http://127.0.0.1:3000")).toBe(false);
  expect(isDirectorDeskOrigin("https://evil.example")).toBe(false);
});

it("uploads each capture and returns canvas assets", async () => {
  const upload = vi.fn<
    (
      file: File,
      options?: { kind: string; workspaceId?: string }
    ) => Promise<{ mediaAssetId: string; variantId: string; storageKey: string; url: string }>
  >(async (file) => ({
    mediaAssetId: `media-${file.name}`,
    variantId: "v",
    storageKey: "k",
    url: `https://cdn.example/${file.name}`,
  }));
  const assets = await importDirectorCaptures({
    captures: [{ dataUrl: PNG, fileName: "hero.png", captureId: "c1" }],
    workspaceId: "ws",
    upload,
  });
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0]?.[1]).toMatchObject({
    kind: "ai_reference_image",
    workspaceId: "ws",
  });
  expect(assets[0]).toMatchObject({
    id: "media-hero.png",
    kind: "image",
    source: "uploaded",
    name: "hero.png",
  });
  expect(dataUrlToFile(PNG, "x.png").type).toBe("image/png");
});
