// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import type { ReferenceUpload } from "./use-reference-uploads";
import { useComposerDraftStore } from "./use-composer-draft";
import { useImageGeneration, useAudioGeneration } from "./use-image-generation";
import { useVideoGeneration } from "./use-video-generation";

const state = vi.hoisted(() => ({
  items: [] as ReferenceUpload[],
  submit: vi.fn(),
  userId: "owner",
  workspaceId: "workspace",
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.userId } }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/canvas-authoring/use-ai-catalog", () => ({
  useAiCatalog: () => ({ data: undefined }),
  usableModelsByModality: (_catalog: unknown, kind: "image" | "video" | "audio") => [model(kind)],
}));
vi.mock("./use-generation-feed", () => ({ useGenerationFeed: () => ({ submit: state.submit }) }));
vi.mock("@/app/_components/credits-badge", () => ({
  useComputeWalletBalance: () => ({ data: undefined }),
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => ({ id: state.workspaceId }),
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
function model(type: "image" | "video" | "audio"): FizzAiModel {
  return {
    id: "test-model",
    type,
    billing_policy:
      type === "audio"
        ? {
            productPricing: {
              mode: "per_character",
              version: "test",
              currency: "COMPUTE_POINTS",
              defaultOutputCount: 1,
              minOutputCount: 1,
              maxOutputCount: 1,
              pointsPerCharacter: 0.003,
              minCharacters: 1,
              maxCharacters: 3000,
              defaultCharacters: 200,
              minimumPoints: 1,
              roundTo: 1,
            },
          }
        : undefined,
    generationModes: [
      type === "image"
        ? "image_to_image"
        : type === "audio"
          ? "audio_to_audio"
          : "multimodal_to_video",
    ],
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

describe.each(["image", "video", "audio"] as const)("%s composer reference submission", (kind) => {
  let root: Root;
  let container: HTMLDivElement;
  let controller: ReturnType<typeof useImageGeneration> | ReturnType<typeof useVideoGeneration>;
  const useController =
    kind === "image"
      ? useImageGeneration
      : kind === "audio"
        ? useAudioGeneration
        : useVideoGeneration;
  function Harness() {
    controller = useController();
    return null;
  }
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useComposerDraftStore.setState({ drafts: {} });
    state.userId = "owner";
    state.workspaceId = "workspace";
    state.submit.mockReset().mockResolvedValue({ ok: true });
    state.items = [upload(kind === "audio" ? "audio" : "image", 2)];
    if (kind === "video") state.items.push(upload("video", 1), upload("audio", 1));
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      controller.onSelectModel(model(kind));
      controller.setPrompt(kind === "audio" ? "Use @Audio2" : "Use @Image2");
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
  it.each(["account", "workspace"])(
    "isolates rapid submissions and late success across %s changes",
    async (change) => {
      let finish!: (value: { ok: boolean }) => void;
      state.submit.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      let pending!: Promise<{ ok: boolean }>;
      const oldSubmit = controller.submit;
      await act(async () => {
        pending = oldSubmit();
        expect(await oldSubmit()).toEqual({ ok: false });
      });
      expect(state.submit).toHaveBeenCalledTimes(1);
      if (change === "account") state.userId = "replacement";
      else state.workspaceId = "replacement";
      await act(async () => root.render(<Harness />));
      expect(controller.submitting).toBe(false);
      expect(await oldSubmit()).toEqual({ ok: false });
      expect(controller.prompt).toBe("");
      await act(async () => controller.setPrompt("New workspace prompt"));
      state.submit.mockImplementationOnce(() => new Promise(() => {}));
      await act(async () => {
        void controller.submit();
      });
      await act(async () => {
        finish({ ok: true });
        expect(await pending).toEqual({ ok: false });
      });
      expect(controller.submitting).toBe(true);
      expect(state.submit).toHaveBeenCalledTimes(2);
    }
  );

  if (kind === "audio")
    it("estimates speech from the entered text length", async () => {
      await act(async () => controller.setPrompt("a".repeat(1000)));
      expect(controller.cost).toBe(3);
      await act(async () => controller.setPrompt("Short speech"));
      expect(controller.cost).toBe(1);
    });

  it("retains errors for active retry but suppresses errors after departure", async () => {
    state.submit.mockRejectedValueOnce(new Error("retry me"));
    await act(async () => {
      expect(await controller.submit()).toEqual({ ok: false });
    });
    expect("submitError" in controller ? controller.submitError : controller.error).toBe(
      "retry me"
    );
    expect(controller.submitting).toBe(false);
    let reject!: (error: Error) => void;
    state.submit.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    let pending!: Promise<{ ok: boolean }>;
    await act(async () => {
      pending = controller.submit();
    });
    state.userId = "replacement";
    await act(async () => root.render(<Harness />));
    await act(async () => {
      reject(new Error("abandoned"));
      expect(await pending).toEqual({ ok: false });
    });
    expect("submitError" in controller ? controller.submitError : controller.error).toBeNull();
  });

  it("sends every selected media reference with matching mention bindings", async () => {
    await act(async () => {
      expect(await controller.submit()).toEqual({ ok: true });
    });
    const request = state.submit.mock.calls[0][0];
    const referenceField = kind === "audio" ? "referenceAudios" : "referenceImages";
    expect(request.input[referenceField]).toHaveLength(1);
    if (kind === "video") {
      expect(request.input.referenceVideos).toHaveLength(1);
      expect(request.input.referenceAudios).toHaveLength(1);
    }
    expect(request.referenceBindings).toHaveLength(state.items.length);
    expect(request.referenceBindings[0]).toMatchObject({
      refId: `${kind === "audio" ? "audio" : "image"}-2`,
      assetId: `${kind === "audio" ? "audio" : "image"}-2`,
      label: kind === "audio" ? "Audio2" : "Image2",
    });
    expect(request.input[referenceField][0].url).toBe(request.referenceBindings[0].url);
    expect(request.input[referenceField][0].url).toBe(
      new URL(state.items[0].url!, window.location.origin).href
    );
    expect(controller.canSubmit).toBe(true);
  });
  it("reports an unresolved reference without sending a partial request or staying busy", async () => {
    state.items = [
      ...state.items,
      {
        ...upload(kind === "audio" ? "audio" : "image", 3),
        mediaAssetId: undefined,
        url: "blob:expired",
      },
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
