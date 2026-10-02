import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AssetGenerationPanel } from "./story-asset-generation-panel";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  submit: vi.fn(),
  get: vi.fn(),
  close: vi.fn(),
  generation: 1,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000009" },
}));
vi.mock("../api/story-timeline-models", () => ({
  loadTimelineModels: h.load,
  timelineModelOptions: (m: { input_schema: unknown }) => m.input_schema,
}));
vi.mock("../api/story-asset-generation", () => ({
  getAssetGeneration: h.get,
  assetGenerationPending: () => ({
    read: h.read,
    save: h.save,
    submit: h.submit,
    clear: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Alert: { alert: vi.fn() },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => (
    <input
      value={value}
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));

const id = "00000000-0000-4000-8000-000000000001",
  scope = {
    projectId: id,
    chapterId: id,
    assetId: id,
    purpose: "turnaround" as const,
    outputKind: "image" as const,
    generation: 1,
  };
const job = {
  id,
  targetVersion: 2,
  aiJob: { status: "completed", stage: "done", progress: 1, modelId: "model", error: null },
  materialization: { status: "completed", canRetry: false, error: null },
};
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = async (text: string) => {
  await act(async () => button(text).click());
};
const render = async (
  canGenerate = true,
  latestId?: string,
  newGenerationDisabledReason?: string
) => {
  await act(async () =>
    root.render(
      <AssetGenerationPanel
        scope={scope}
        userId="user"
        version={2}
        kind="image"
        canGenerate={canGenerate}
        newGenerationDisabledReason={newGenerationDisabledReason}
        latestId={latestId}
        onClose={h.close}
      />
    )
  );
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.read.mockReturnValue(null);
  h.load.mockResolvedValue({
    models: [
      {
        id: "model",
        name: "Model",
        schemaVersion: "v1",
        input_schema: {
          type: "object",
          properties: { duration: { type: "integer", default: 5 } },
          required: ["duration"],
        },
      },
    ],
    selectedId: "model",
  });
  h.submit.mockResolvedValue(job);
  h.get.mockResolvedValue(job);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires explicit paid confirmation and submits the selected schema, asset purpose and version", async () => {
  await render();
  await click("assetEdit.generate");
  expect(h.submit).not.toHaveBeenCalled();
  expect(host.textContent).toContain("timeline.generationCharge");
  await click("timeline.confirmGeneration");
  expect(h.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "create",
      input: {
        expectedVersion: 2,
        purpose: "turnaround",
        outputKind: "image",
        modelId: "model",
        schemaVersion: "v1",
        options: { duration: 5 },
      },
    })
  );
  expect(host.textContent).toContain("timeline.materialization.completed");
  expect(button("assetEdit.generate").disabled).toBe(true);
  await click("assetEdit.reloadAsset");
  expect(h.close).toHaveBeenCalled();
});
it("retains identical command after interrupted submission", async () => {
  h.submit.mockRejectedValueOnce(Error("Lost reply"));
  await render();
  await click("assetEdit.generate");
  await click("timeline.confirmGeneration");
  const saved = h.submit.mock.calls[0][0];
  await click("timeline.retry");
  expect(h.submit.mock.calls[1][0]).toEqual(saved);
});
it("recovers pending commands even if model loading fails", async () => {
  const saved = { action: "create", clientKey: id, input: { expectedVersion: 2 } };
  h.read.mockReturnValue(saved);
  h.load.mockRejectedValue(Error("Offline"));
  await render();
  await click("timeline.retry");
  expect(h.submit).toHaveBeenCalledWith(saved);
});
it("lets read-only users inspect jobs without generation writes", async () => {
  await render(false, id);
  expect(h.load).not.toHaveBeenCalled();
  expect(h.get).toHaveBeenCalled();
  expect(button("assetEdit.generate").disabled).toBe(true);
});
it("does not dispatch when durable storage fails", async () => {
  h.save.mockImplementation(() => {
    throw Error("Disk full");
  });
  await render();
  await click("assetEdit.generate");
  await click("timeline.confirmGeneration");
  expect(h.submit).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Disk full");
});
it("requires paid confirmation again for retry but routes attachment separately", async () => {
  h.get.mockResolvedValue({
    ...job,
    aiJob: { ...job.aiJob, status: "failed" },
    materialization: { status: "failed", canRetry: true, error: "Attach error" },
  });
  await render(true, id);
  await click("timeline.retryGeneration");
  expect(h.submit).not.toHaveBeenCalled();
  await click("common.cancel");
  await click("timeline.retryAttachment");
  expect(h.submit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "attach", generationId: id })
  );
});

it("requires reference-capable models for three-view jobs", async () => {
  await render();
  expect(h.load).toHaveBeenCalledWith(scope, "image", expect.any(AbortSignal), {
    imageReference: true,
  });
});
it("blocks new generation without a primary image but preserves saved-request recovery", async () => {
  await render(true, undefined, "Select a primary image");
  expect(button("assetEdit.generate").disabled).toBe(true);
  expect(host.textContent).toContain("Select a primary image");
  const saved = {
    action: "create",
    clientKey: id,
    input: { expectedVersion: 2, purpose: "turnaround", outputKind: "image" },
  };
  h.read.mockReturnValue(saved);
  await click("assetEdit.refreshGeneration");
  await click("timeline.retry");
  expect(h.submit).toHaveBeenCalledWith(saved);
});
it("keeps cancellation available when a primary image is no longer selected", async () => {
  h.get.mockResolvedValue({ ...job, aiJob: { ...job.aiJob, status: "in_progress" } });
  await render(true, id, "Select a primary image");
  await click("timeline.cancelGeneration");
  expect(h.submit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "cancel", generationId: id })
  );
});
