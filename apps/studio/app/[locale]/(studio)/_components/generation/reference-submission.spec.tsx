// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import type { ReferenceUpload } from "./use-reference-uploads";
import { useImageGeneration } from "./use-image-generation";
import { useVideoGeneration } from "./use-video-generation";

const state = vi.hoisted(() => ({ items: [] as ReferenceUpload[], submit: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/canvas-authoring/use-ai-catalog", () => ({
  useAiCatalog: () => ({ data: undefined }),
  usableModelsByModality: () => [],
}));
vi.mock("./use-generation-feed", () => ({ useGenerationFeed: () => ({ submit: state.submit }) }));
vi.mock("@/app/_components/credits-badge", () => ({
  useComputeWalletBalance: () => ({ data: undefined }),
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => null,
}));
vi.mock("./use-reference-uploads", async (original) => ({
  ...(await original<typeof import("./use-reference-uploads")>()),
  useReferenceUploads: () => ({ items: state.items }),
}));

const field = (kind: string) => ({
  type: "array",
  maxItems: 9,
  "x-ui": { control: `${kind}_upload`, kind, group: "references" },
});
function model(type: "image" | "video"): FizzAiModel {
  return {
    id: "test-model",
    type,
    generationModes: [type === "image" ? "image_to_image" : "multimodal_to_video"],
    input_schema: {
      properties: {
        prompt: { type: "string" },
        referenceImages: field("image"),
        referenceVideos: field("video"),
        referenceAudios: field("audio"),
      },
    },
  } as unknown as FizzAiModel;
}
function upload(kind: "image" | "video" | "audio", index: number): ReferenceUpload {
  const id = `${kind}-${index}`;
  return {
    id,
    mediaAssetId: id,
    field: `reference${kind === "image" ? "Images" : kind === "video" ? "Videos" : "Audios"}`,
    kind,
    name: id,
    previewUrl: `/aurora/media/assets/${id}/content`,
    url: `/aurora/media/assets/${id}/content`,
    uploading: false,
    progress: 100,
    label: `${kind[0].toUpperCase()}${kind.slice(1)}${index}`,
    durationSeconds: 4,
    bytes: 1024,
  };
}

describe.each(["image", "video"] as const)("%s composer reference submission", (kind) => {
  let root: Root;
  let container: HTMLDivElement;
  let controller: ReturnType<typeof useImageGeneration> | ReturnType<typeof useVideoGeneration>;
  const useController = kind === "image" ? useImageGeneration : useVideoGeneration;
  function Harness() {
    controller = useController();
    return null;
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.submit.mockReset().mockResolvedValue({ ok: true });
    state.items = [upload("image", 2)];
    if (kind === "video") state.items.push(upload("video", 1), upload("audio", 1));
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      controller.onSelectModel(model(kind));
      controller.setPrompt("Use @Image2");
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
  it("sends every selected media reference with matching mention bindings", async () => {
    await act(async () => {
      expect(await controller.submit()).toEqual({ ok: true });
    });
    const request = state.submit.mock.calls[0][0];
    expect(request.input.referenceImages).toHaveLength(1);
    if (kind === "video") {
      expect(request.input.referenceVideos).toHaveLength(1);
      expect(request.input.referenceAudios).toHaveLength(1);
    }
    expect(request.referenceBindings).toHaveLength(state.items.length);
    expect(request.referenceBindings[0]).toMatchObject({
      refId: "image-2",
      assetId: "image-2",
      label: "Image2",
    });
    expect(request.input.referenceImages[0].url).toBe(request.referenceBindings[0].url);
    expect(request.input.referenceImages[0].url).toBe(
      new URL(state.items[0].url!, window.location.origin).href
    );
    expect(controller.canSubmit).toBe(true);
  });
  it("reports an unresolved reference without sending a partial request or staying busy", async () => {
    state.items = [
      ...state.items,
      { ...upload("image", 3), mediaAssetId: undefined, url: "blob:expired" },
    ];
    await act(async () => root.render(<Harness />));
    await act(async () => {
      expect(await controller.submit()).toEqual({ ok: false });
    });
    expect(state.submit).not.toHaveBeenCalled();
    expect("error" in controller ? controller.error : controller.submitError).toBe(
      "generationReferenceUnavailable"
    );
    expect(controller.canSubmit).toBe(true);
  });
});
