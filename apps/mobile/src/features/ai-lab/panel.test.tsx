import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GenerationPanel } from "./panel";
import { ApiRequestError } from "@/lib/api-client";
vi.mock("@/features/services/conversation-audio", () => ({
  ConversationAudio: ({ url }: { url: string }) => <span>Audio playback: {url}</span>,
}));
vi.mock("./reference-audio-metadata", () => ({ probeReferenceAudio: h.probe }));
vi.mock("expo-clipboard", () => ({ setStringAsync: h.copy }));
vi.mock("expo-image", () => ({ Image: () => null }));
const h = vi.hoisted(() => ({
  signedIn: true,
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  push: vi.fn(),
  key: 10,
  open: vi.fn(),
  copy: vi.fn(),
  pick: vi.fn(),
  probe: vi.fn(),
  selected: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, patch: h.patch, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => `00000000-0000-4000-8000-${String(++h.key).padStart(12, "0")}` },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
    multiline,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
    multiline?: boolean;
  }) =>
    multiline ? (
      <textarea
        value={value}
        onChange={(e) => onChangeText(e.target.value)}
        readOnly={!editable}
        aria-label={accessibilityLabel}
      />
    ) : (
      <input
        value={value}
        onChange={(e) => onChangeText(e.target.value)}
        readOnly={!editable}
        aria-label={accessibilityLabel}
      />
    ),
}));

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  router: { push: h.push },
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: h.push }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => (
      <>{options.headerRight?.()}</>
    ),
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.signedIn ? "authenticated" : "anonymous",
    user: { userId: "alice" },
    generation: 1,
  }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/features/ip-author/contributors-panel", () => ({ IpContributorsPanel: () => null }));

vi.mock("@/features/ip-author/selected-media", () => ({ selectedMedia: h.selected }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("./reference-video-metadata", () => ({ probeReferenceVideo: h.probe }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const model = {
  id: "model",
  name: "Image model",
  type: "image",
  enabled: true,
  schemaVersion: "1",
  input_schema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string", title: "Prompt", "x-ui": { control: "textarea" } },
      seed: { type: "integer", title: "Seed" },
      references: {
        type: "array",
        title: "References",
        maxItems: 2,
        "x-ui": { control: "image_upload" },
        items: { type: "string", format: "uri" },
      },
    },
  },
};
const catalog = {
  version: "1",
  region: "global",
  models: [model],
  presets: [
    {
      id: "preset",
      label: "Image preset",
      type: "image",
      modelIds: ["model"],
      enabled: true,
      billingPolicy: { mode: "charge", preflightCost: 2, displayCurrency: "points" },
    },
  ],
};
let jobs: unknown[];
const job = {
  id: "11111111-1111-4111-8111-111111111111",
  modelId: "model",
  type: "image",
  status: "in_queue",
  stage: "queued",
  prompt: "Lake",
  outputs: [],
  createdAt: "today",
  updatedAt: "today",
  sourceSurface: "ai-lab",
};
const mount = (
  workspace?: import("@/features/agent/api/studio-projects-api").StudioWorkspace,
  project?: import("./projects-api").GenerationProject,
  canvas?: import("./panel").CanvasGenerationContext
) =>
  act(async () =>
    root.render(
      <StrictMode>
        <GenerationPanel
          userId="alice"
          generation={1}
          workspace={workspace}
          project={project}
          canvas={canvas}
        />
      </StrictMode>
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const input = (label: string) =>
  host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
const change = (label: string, value: string) =>
  act(async () => {
    const node = input(label);
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value"
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  jobs = [];
  host = document.createElement("div");
  root = createRoot(host);
  h.get.mockImplementation(async (path) =>
    path.startsWith("/project-skills/")
      ? {
          ownerKind: path.split("/")[2],
          projectId: path.split("/")[3],
          projectRevision: 1,
          installations: [],
        }
      : path === "/ai/models"
        ? catalog
        : path.includes("entitlement")
          ? { entitlement: { rank: 0 } }
          : path === "/ai/jobs"
            ? { jobs, nextCursor: null }
            : job
  );
  h.post.mockResolvedValue({ request_id: job.id, status: "in_queue" });
});
afterEach(() => act(() => root.unmount()));
it("restores raw draft inputs through remount and submits only after confirmation", async () => {
  await mount();
  await click("Image preset");
  await change("Prompt", "Lake ");
  await change("Seed", "12");
  await change("References", "https://example.test/a");
  await act(async () => root.render(null));
  await mount();
  expect(input("Prompt").value).toBe("Lake ");
  expect(input("Seed").value).toBe("12");
  await click("aiLab.generate");
  expect(h.post).not.toHaveBeenCalled();
  await click("aiLab.confirm");
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    modelId: "model",
    presetId: "preset",
    input: { prompt: "Lake ", seed: 12, references: ["https://example.test/a"] },
  });
});
it("recovers an uncertain paid job after restart without duplicate POST", async () => {
  await mount();
  await click("Image preset");
  await change("Prompt", "Lake");
  h.post.mockRejectedValueOnce(new Error("lost response"));
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(host.textContent).toContain("aiLab.pending");
  const key = h.post.mock.calls[0][1].data.idempotencyKey;
  jobs = [{ ...job, idempotencyKey: key }];
  await act(async () => root.render(null));
  await mount();
  await click("aiLab.recover");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("aiLab.pending");
});
it("does not enable paid submission when entitlement/catalogue read fails", async () => {
  h.get.mockRejectedValue(new Error("catalog unavailable"));
  await mount();
  expect(host.textContent).toContain("catalog unavailable");
  expect(button("aiLab.generate").disabled).toBe(true);
});
it("hides private history after access is revoked and ignores late catalog success", async () => {
  jobs = [job];
  await mount();
  await click("aiLab.history");
  expect(host.textContent).toContain("Lake");
  h.get.mockImplementation(async (path) => {
    if (path === "/ai/jobs") throw new ApiRequestError("DENIED", "Access revoked", 403);
    return path === "/ai/models" ? catalog : { entitlement: { rank: 0 } };
  });
  await click("common.retry");
  expect(host.textContent).toContain("Access revoked");
  expect(host.textContent).not.toContain("Lake");
});
it("loads a job and confirms cancellation through the official endpoint", async () => {
  jobs = [job];
  h.post.mockResolvedValue({ ...job, status: "cancelled" });
  await mount();
  await click("aiLab.history");
  await click("Image model · aiLab.status.in_queue");
  await click("aiLab.cancel");
  expect(h.post).not.toHaveBeenCalled();
  await click("aiLab.confirm");
  expect(h.post.mock.calls[0][0]).toBe(`/ai/jobs/${job.id}/cancel`);
});
it("hides private work when backgrounded and retires it on account changes", async () => {
  jobs = [job];
  await mount();
  await click("aiLab.history");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  h.focused = true;
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});

it("keeps an uncertain retry visible after remount and disables further paid writes", async () => {
  const failed = {
    ...job,
    status: "failed",
    error: { userMessage: "Provider failed", retryable: true },
  };
  jobs = [failed];
  const oldGet = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) =>
    path === `/ai/jobs/${job.id}` ? failed : oldGet(path, ...args)
  );
  await mount();
  await click("Image preset");
  await change("Prompt", "Lake");
  await click("aiLab.history");
  await click("Image model · aiLab.status.failed");
  h.post.mockRejectedValueOnce(new Error("retry reply lost"));
  await click("aiLab.retryJob");
  await click("aiLab.confirm");
  expect(host.textContent).toContain("aiLab.retryPending");
  await act(async () => root.render(null));
  await mount();
  expect(host.textContent).toContain("aiLab.retryPending");
  expect(button("aiLab.generate").disabled).toBe(true);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("aiLab.clear")).toBeUndefined();
  await click("aiLab.recoverRetry");
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.post.mock.calls.map(([path]) => path)).toEqual([
    `/ai/jobs/${job.id}/retry`,
    `/ai/jobs/${job.id}/retry`,
  ]);
  expect(host.textContent).not.toContain("aiLab.retryPending");
  expect(input("Prompt").value).toBe("Lake");
});
it("preserves the draft when a new catalog schema requires explicit reset", async () => {
  await mount();
  await click("Image preset");
  await change("Prompt", "Keep my words");
  const oldGet = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) =>
    path === "/ai/models"
      ? { ...catalog, models: [{ ...model, schemaVersion: "2" }] }
      : oldGet(path, ...args)
  );
  await click("common.retry");
  expect(host.textContent).toContain("aiLab.schemaChanged");
  expect(button("aiLab.generate").disabled).toBe(true);
  expect(input("Prompt").value).toBe("Keep my words");
  await click("aiLab.reset");
  await click("aiLab.back");
  expect(input("Prompt").value).toBe("Keep my words");
  await click("aiLab.reset");
  await click("aiLab.confirm");
  expect(input("Prompt").value).toBe("");
});

it("recovers uploaded reference confirmation after remount without reuploading", async () => {
  const put = vi.fn().mockResolvedValue({ ok: true });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///image.png", name: "image.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put });
  h.post
    .mockResolvedValueOnce({
      uploadUrl: "https://storage.test/upload",
      method: "PUT",
      headers: {},
      storageKey: "staging/image",
    })
    .mockRejectedValueOnce(Error("Confirmation offline"));
  await mount();
  await click("Image preset");
  await change("Prompt", "Lake");
  await change("References", "https://storage.test/existing.png");
  await click("aiLab.uploadImage");
  expect(host.textContent).toContain("Confirmation offline");
  expect(host.textContent).toContain("aiLab.uploadPending");
  expect(button("aiLab.generate").disabled).toBe(true);
  await act(async () => root.render(null));
  await mount();
  h.post.mockResolvedValueOnce({
    mediaAssetId: "22222222-2222-4222-8222-222222222222",
    storageKey: "final/image",
    url: "https://storage.test/final.png",
  });
  await click("aiLab.confirmUpload");
  expect(h.pick).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledTimes(1);
  expect(input("References").value).toBe(
    "https://storage.test/existing.png\nhttps://storage.test/final.png"
  );
  expect(input("Prompt").value).toBe("Lake");
  expect(host.textContent).not.toContain("aiLab.uploadPending");
  expect(button("aiLab.uploadImage").disabled).toBe(true);
  expect(button("aiLab.generate").disabled).toBe(false);
});
it("discards an unfinished attachment only after confirmation and preserves the draft", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///image.png", name: "image.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: vi.fn().mockResolvedValue({ ok: true }) });
  h.post
    .mockResolvedValueOnce({
      uploadUrl: "https://storage.test/upload",
      method: "PUT",
      headers: {},
      storageKey: "staging/image",
    })
    .mockRejectedValueOnce(Error("Confirmation offline"));
  await mount();
  await click("Image preset");
  await change("Prompt", "Lake");
  await click("aiLab.uploadImage");
  await click("aiLab.discardUpload");
  await click("aiLab.back");
  expect(host.textContent).toContain("aiLab.uploadPending");
  await click("aiLab.discardUpload");
  await click("aiLab.confirm");
  expect(host.textContent).not.toContain("aiLab.uploadPending");
  expect(input("Prompt").value).toBe("Lake");
  expect(button("aiLab.generate").disabled).toBe(false);
  expect(h.post).toHaveBeenCalledTimes(2);
});
const useObjectImageCatalog = () => {
  const objectModel = {
    ...model,
    input_schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: model.input_schema.properties.prompt,
        referenceImages: {
          type: "array",
          title: "Reference images",
          maxItems: 2,
          "x-ui": { control: "image_upload" },
          items: {
            type: "object",
            properties: { url: { type: "string", format: "uri" } },
            required: ["url"],
            additionalProperties: true,
          },
        },
      },
    },
  };
  h.get.mockImplementation(async (path) =>
    path === "/ai/models"
      ? { ...catalog, models: [objectModel] }
      : path.includes("entitlement")
        ? { entitlement: { rank: 0 } }
        : { jobs: [], nextCursor: null }
  );
};
it("uploads official object references, inserts a mention and submits verified asset bindings", async () => {
  useObjectImageCatalog();
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a.png", name: "a.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: vi.fn().mockResolvedValue({ ok: true }) });
  h.post
    .mockResolvedValueOnce({
      uploadUrl: "https://storage.test/upload",
      method: "PUT",
      headers: {},
      storageKey: "staging/a",
    })
    .mockRejectedValueOnce(Error("Confirm offline"));
  await mount();
  await click("Image preset");
  await change("Prompt", "Paint");
  await click("aiLab.uploadImage");
  await act(async () => root.render(null));
  await mount();
  h.post.mockResolvedValueOnce({
    mediaAssetId: job.id,
    storageKey: "final/a",
    url: "https://storage.test/a.png",
  });
  await click("aiLab.confirmUpload");
  expect(input("Reference images 1").value).toBe("https://storage.test/a.png");
  await click("aiLab.mention");
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(h.post.mock.calls.at(-1)![1].data).toMatchObject({
    input: { referenceImages: [{ url: "https://storage.test/a.png", assetId: job.id }] },
    referenceBindings: [{ assetId: job.id, refId: job.id, kind: "image", label: "Image1" }],
    promptDocument: {
      version: 1,
      nodes: [
        { type: "text", text: "Paint " },
        { type: "asset_ref", refId: job.id, label: "Image1" },
      ],
    },
  });
});
it("edits structured reference rows without JSON and keeps removed mentions from rebinding", async () => {
  useObjectImageCatalog();
  await mount();
  await click("Image preset");
  await change("Prompt", "Paint");
  await click("aiLab.addReferenceUrl");
  await change("Reference images 1", "https://cdn.test/a");
  await click("aiLab.mention");
  await click("aiLab.removeReference");
  await click("aiLab.addReferenceUrl");
  await change("Reference images 1", "https://cdn.test/b");
  expect(host.textContent).toContain("Image2");
  await click("aiLab.generate");
  expect(host.textContent).toContain("aiLab.missingReference");
  expect(h.post).not.toHaveBeenCalled();
  await change("Prompt", "Paint @Image2");
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(h.post.mock.calls[0][1].data.referenceBindings[0]).toMatchObject({
    label: "Image2",
    url: "https://cdn.test/b",
  });
});

const team = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Team",
  isDefault: false,
  role: "editor" as const,
  accessScope: "workspace" as const,
};
it("keeps drafts and uncertain paid submissions separate when switching workspaces", async () => {
  await mount(team);
  await click("Image preset");
  await change("Prompt", "Team draft");
  h.post.mockRejectedValueOnce(Error("lost response"));
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(h.post.mock.calls[0][1].data.workspaceId).toBe(team.id);
  expect(host.textContent).toContain("aiLab.pending");
  const other = { ...team, id: "44444444-4444-4444-8444-444444444444" };
  await mount(other);
  expect(host.textContent).not.toContain("aiLab.pending");
  await click("Image preset");
  await change("Prompt", "Other draft");
  await mount(team);
  expect(input("Prompt").value).toBe("Team draft");
  expect(host.textContent).toContain("aiLab.pending");
  await mount(other);
  expect(input("Prompt").value).toBe("Other draft");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("retains previous personal drafts when the explicit default workspace is selected", async () => {
  await mount();
  await click("Image preset");
  await change("Prompt", "Existing personal draft");
  await mount({ ...team, isDefault: true });
  expect(input("Prompt").value).toBe("Existing personal draft");
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(h.post.mock.calls[0][1].data.workspaceId).toBe(team.id);
});
it("keeps workspace viewers read-only for paid submissions and job mutations", async () => {
  jobs = [{ ...job, workspaceId: team.id }];
  h.get.mockImplementation(async (path) =>
    path === "/ai/models"
      ? catalog
      : path.includes("entitlement")
        ? { entitlement: { rank: 0 } }
        : path === "/ai/jobs"
          ? { jobs, nextCursor: null }
          : { ...job, workspaceId: team.id }
  );
  await mount({ ...team, role: "viewer" });
  await click("Image preset");
  await change("Prompt", "View only");
  expect(button("aiLab.generate").disabled).toBe(true);
  await click("aiLab.history");
  await click("Image model · aiLab.status.in_queue");
  expect(button("aiLab.cancel").disabled).toBe(true);
  expect(h.post).not.toHaveBeenCalled();
});

it("does not replay an old personal request against a different selected default workspace", async () => {
  await mount({ ...team, isDefault: true });
  await click("Image preset");
  await change("Prompt", "Old workspace");
  h.post.mockRejectedValueOnce(Error("lost response"));
  await click("aiLab.generate");
  await click("aiLab.confirm");
  await mount({ ...team, id: "44444444-4444-4444-8444-444444444444", isDefault: true });
  await click("aiLab.recover");
  expect(host.textContent).toContain("aiLab.workspaceRequestMismatch");
  expect(h.post).toHaveBeenCalledTimes(1);
});

it("restores video confirmation and exact metadata, then submits video mentions once", async () => {
  const videoModel = {
    ...model,
    type: "video",
    input_schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: model.input_schema.properties.prompt,
        referenceVideos: {
          type: "array",
          title: "Reference videos",
          maxItems: 2,
          items: {
            type: "object",
            properties: { url: { type: "string", format: "uri" } },
            additionalProperties: false,
          },
          "x-ui": { control: "video_upload", mediaKind: "video", maxCombinedDurationSeconds: 15 },
        },
      },
    },
  };
  const videoCatalog = {
    ...catalog,
    models: [videoModel],
    presets: [{ ...catalog.presets[0], type: "video", label: "Video preset" }],
  };
  h.get.mockImplementation(async (path) =>
    path === "/ai/models"
      ? videoCatalog
      : path === "/billing/entitlement/me"
        ? { entitlement: { rank: 100 } }
        : { jobs: [], nextCursor: null }
  );
  await mount();
  await click("aiLab.video");
  await change("Prompt", "Animate");
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a.mov", name: "a.mov", mimeType: "video/quicktime" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: vi.fn().mockResolvedValue({ ok: true }) });
  h.probe.mockResolvedValue({ durationSeconds: 2.125, width: 640, height: 480 });
  h.post
    .mockResolvedValueOnce({
      uploadUrl: "https://storage.test/a",
      method: "PUT",
      headers: {},
      storageKey: "video/a",
    })
    .mockRejectedValueOnce(Error("confirmation lost"));
  await click("aiLab.uploadVideo");
  expect(host.textContent).toContain("aiLab.uploadPending");
  await act(async () => root.render(null));
  await mount();
  h.post.mockResolvedValueOnce({
    mediaAssetId: job.id,
    storageKey: "video/a",
    url: "https://storage.test/a.mov",
  });
  await click("aiLab.confirmUpload");
  expect(h.pick).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(h.records.get("ai-lab-draft:alice:composer")!);
  expect(saved.values.referenceVideos[0]).toMatchObject({
    durationSeconds: 2.125,
    bytes: 100,
    width: 640,
    height: 480,
  });
  await click("aiLab.mention");
  await click("aiLab.generate");
  h.post.mockResolvedValueOnce({ ...job, type: "video" });
  await click("aiLab.confirm");
  expect(h.post.mock.calls.at(-1)![1].data).toMatchObject({
    input: { referenceVideos: [{ url: "https://storage.test/a.mov" }] },
    referenceBindings: [{ kind: "video", label: "Video1", assetId: job.id }],
    promptDocument: {
      nodes: [
        { type: "text", text: "Animate " },
        { type: "asset_ref", refId: job.id, label: "Video1" },
      ],
    },
  });
});

it("restores audio confirmation and exact duration, then submits audio references for video generation", async () => {
  const videoModel = {
    ...model,
    type: "video",
    input_schema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: model.input_schema.properties.prompt,
        referenceAudios: {
          type: "array",
          title: "Reference audio",
          maxItems: 2,
          items: {
            type: "object",
            properties: { url: { type: "string", format: "uri" } },
            additionalProperties: false,
          },
          "x-ui": { control: "audio_upload", mediaKind: "audio", maxCombinedDurationSeconds: 15 },
        },
      },
    },
  };
  const videoCatalog = {
    ...catalog,
    models: [videoModel],
    presets: [{ ...catalog.presets[0], type: "video", label: "Video preset" }],
  };
  h.get.mockImplementation(async (path) =>
    path === "/ai/models"
      ? videoCatalog
      : path === "/billing/entitlement/me"
        ? { entitlement: { rank: 100 } }
        : { jobs: [], nextCursor: null }
  );
  await mount();
  await click("aiLab.video");
  await change("Prompt", "Animate");
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a.wav", name: "a.wav", mimeType: "audio/wav" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: vi.fn().mockResolvedValue({ ok: true }) });
  h.probe.mockResolvedValue({ durationSeconds: 2.125, width: 640, height: 480 });
  h.post
    .mockResolvedValueOnce({
      uploadUrl: "https://storage.test/a",
      method: "PUT",
      headers: {},
      storageKey: "audio/a",
    })
    .mockRejectedValueOnce(Error("confirmation lost"));
  await click("aiLab.uploadAudio");
  expect(host.textContent).toContain("aiLab.uploadPending");
  await act(async () => root.render(null));
  await mount();
  h.post.mockResolvedValueOnce({
    mediaAssetId: job.id,
    storageKey: "audio/a",
    url: "https://storage.test/a.wav",
  });
  await click("aiLab.confirmUpload");
  expect(h.pick).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(h.records.get("ai-lab-draft:alice:composer")!);
  expect(saved.values.referenceAudios[0]).toMatchObject({
    durationSeconds: 2.125,
    bytes: 100,
  });
  await click("aiLab.mention");
  await click("aiLab.generate");
  h.post.mockResolvedValueOnce({ ...job, type: "video" });
  await click("aiLab.confirm");
  expect(h.post.mock.calls.at(-1)![1].data).toMatchObject({
    input: { referenceAudios: [{ url: "https://storage.test/a.wav" }] },
    referenceBindings: [{ kind: "audio", label: "Audio1", assetId: job.id }],
    promptDocument: {
      nodes: [
        { type: "text", text: "Animate " },
        { type: "asset_ref", refId: job.id, label: "Audio1" },
      ],
    },
  });
});

it.each(["platform", "story"] as const)(
  "isolates %s project drafts and pending paid requests and rechecks permission",
  async (kind) => {
    const workspace = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Team",
      isDefault: false,
      accessScope: "project_only" as const,
      role: "viewer" as const,
    };
    const id = "44444444-4444-4444-8444-444444444444",
      other = "55555555-5555-4555-8555-555555555555";
    const project = {
      id,
      kind,
      title: "Project",
      workspaceId: workspace.id,
      canGenerate: true,
      ...(kind === "platform" ? { projectId: id } : { storyProjectId: id }),
    };
    let editable = true;
    const base = h.get.getMockImplementation()!;
    h.get.mockImplementation(async (path, options) =>
      path === `/${kind === "platform" ? "projects" : "story-projects"}/${id}`
        ? kind === "platform"
          ? {
              project: {
                id,
                workspaceId: workspace.id,
                name: "Project",
                status: "active",
                role: editable ? "editor" : "viewer",
              },
            }
          : {
              id,
              workspaceId: workspace.id,
              title: "Project",
              status: "active",
              capabilities: editable ? ["story.read", "story.generate"] : ["story.read"],
            }
        : base(path, options)
    );
    await mount(workspace, project);
    await click("Image preset");
    await change("Prompt", "Project A draft");
    editable = false;
    await click("aiLab.generate");
    await click("aiLab.confirm");
    expect(h.post).not.toHaveBeenCalled();
    expect(host.textContent).toContain("aiLab.projectReadOnly");
    editable = true;
    h.post.mockRejectedValueOnce(Error("response lost"));
    await click("aiLab.generate");
    await click("aiLab.confirm");
    expect(h.post.mock.calls.at(-1)![1].data).toMatchObject({
      workspaceId: workspace.id,
      [kind === "platform" ? "projectId" : "storyProjectId"]: id,
    });
    expect(host.textContent).toContain("aiLab.recover");
    await mount(workspace, {
      ...project,
      id: other,
      ...(kind === "platform" ? { projectId: other } : { storyProjectId: other }),
    });
    expect(host.textContent).not.toContain("aiLab.recover");
    await click("Image preset");
    await change("Prompt", "Project B draft");
    await mount(workspace, project);
    expect(input("Prompt").value).toBe("Project A draft");
    expect(host.textContent).toContain("aiLab.recover");
    expect(h.post).toHaveBeenCalledTimes(1);
  }
);

it("reviews changed Skills before charging, persists overrides and recovers the original selection", async () => {
  const workspace = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Team",
    isDefault: false,
    accessScope: "workspace" as const,
    role: "editor" as const,
  };
  const id = "44444444-4444-4444-8444-444444444444",
    skill = "55555555-5555-4555-8555-555555555555";
  const project = {
    id,
    projectId: id,
    kind: "platform" as const,
    workspaceId: workspace.id,
    title: "Creative",
    canGenerate: true,
  };
  let revision = 1;
  const base = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) => {
    if (path === `/projects/${id}`)
      return {
        project: {
          id,
          workspaceId: workspace.id,
          name: "Creative",
          status: "active",
          role: "editor",
        },
      };
    if (path === `/project-skills/platform/${id}/installations`)
      return {
        ownerKind: "platform",
        projectId: id,
        projectRevision: revision,
        installations: [
          {
            id: skill,
            name: "Lighting",
            pinnedVersionId: skill,
            revision,
            status: "active",
            version: {
              version: "1.0",
              checksum: "sha",
              capabilities: ["image_generation"],
              projectKinds: [],
              workbenchModes: [],
            },
            defaults: [{ scope: "image_generation", sourceSurface: null, workbenchMode: null }],
          },
        ],
      };
    return base(path, options);
  });
  await mount(workspace, project);
  await click("Image preset");
  await change("Prompt", "Lake");
  await click("aiLab.skills (1)");
  await click("✓ Lighting · 1.0 · aiLab.skillDefault");
  expect(host.textContent).toContain("aiLab.skills (0)");
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount(workspace, project);
  expect(host.textContent).toContain("aiLab.skills (0)");
  await click("aiLab.generate");
  revision++;
  await click("aiLab.confirm");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("aiLab.skillsChanged");
  expect(host.textContent).toContain("Lighting");
  h.post.mockRejectedValueOnce(Error("lost response"));
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(h.post).toHaveBeenCalledTimes(1);
  const sent = h.post.mock.calls[0]![1].data;
  expect(sent.skillSelection).toEqual({
    includeInstallationIds: [],
    excludeInstallationIds: [skill],
  });
  expect(sent.input.prompt).toBe("Lake");
  expect(button("Lighting · 1.0 · aiLab.skillDefault").disabled).toBe(true);
  jobs = [
    { ...job, idempotencyKey: sent.idempotencyKey, workspaceId: workspace.id, projectId: id },
  ];
  revision++;
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount(workspace, project);
  await click("aiLab.recover");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("aiLab.recover");
});

function useAudioCatalog() {
  const previous = h.get.getMockImplementation()!;
  const audioJob = {
    ...job,
    type: "audio",
    modelId: "audio-model",
    status: "completed",
    outputs: [{ id: "sound", type: "audio", url: "https://example.test/sound.mp3" }],
  };
  h.get.mockImplementation(async (path, options) => {
    if (path === "/ai/models")
      return {
        ...catalog,
        models: [
          ...catalog.models,
          { ...model, id: "audio-model", name: "Audio model", type: "audio" },
        ],
        presets: [
          ...catalog.presets,
          {
            ...catalog.presets[0],
            id: "audio-preset",
            label: "Audio preset",
            type: "audio",
            modelIds: ["audio-model"],
          },
        ],
      };
    if (path === `/ai/jobs/${job.id}`) return audioJob;
    return previous(path, options);
  });
  return audioJob;
}
it("restores the audio composer and confirms generation before playing its result", async () => {
  const audioJob = useAudioCatalog();
  h.post.mockImplementation(async () => {
    jobs = [audioJob];
    return { request_id: job.id, status: "in_queue" };
  });
  await mount();
  await click("aiLab.audio");
  await change("Prompt", "Quiet piano");
  await act(async () => root.render(null));
  await mount();
  expect(input("Prompt").value).toBe("Quiet piano");
  expect(h.get).toHaveBeenCalledWith(
    "/ai/jobs",
    expect.objectContaining({ params: expect.objectContaining({ type: "audio" }) })
  );
  await click("aiLab.generate");
  expect(h.post).not.toHaveBeenCalled();
  await click("aiLab.confirm");
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    modelId: "audio-model",
    presetId: "audio-preset",
    input: { prompt: "Quiet piano" },
  });
  await click("Audio model · aiLab.status.completed");
  expect(host.textContent).toContain("Audio playback: https://example.test/sound.mp3");
  await click("aiLab.openResult");
  expect(h.open).toHaveBeenCalledWith("https://example.test/sound.mp3");
});
it("recovers a lost audio submission after reopening without sending another paid request", async () => {
  const audioJob = useAudioCatalog();
  await mount();
  await click("aiLab.audio");
  await change("Prompt", "Quiet piano");
  h.post.mockRejectedValueOnce(Error("Response lost"));
  await click("aiLab.generate");
  await click("aiLab.confirm");
  jobs = [{ ...audioJob, idempotencyKey: h.post.mock.calls[0][1].data.idempotencyKey }];
  await act(async () => root.render(null));
  await mount();
  await click("aiLab.recover");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("aiLab.pending");
  await click("Audio model · aiLab.status.completed");
  expect(host.textContent).toContain("Audio playback: https://example.test/sound.mp3");
});

it("reports completed audio with no playable output and clears the warning after refresh", async () => {
  const audioJob = useAudioCatalog();
  const previous = h.get.getMockImplementation()!;
  let ready = false;
  h.get.mockImplementation(async (path, options) =>
    path === `/ai/jobs/${job.id}`
      ? { ...audioJob, outputs: ready ? audioJob.outputs : [] }
      : previous(path, options)
  );
  jobs = [{ ...audioJob, outputs: [] }];
  await mount();
  await click("aiLab.audio");
  await click("aiLab.history");
  await click("Audio model · aiLab.status.completed");
  expect(host.textContent).toContain("aiLab.audioNoOutput");
  expect(button("aiLab.retryJob")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
  ready = true;
  await click("Audio model · aiLab.status.completed");
  expect(host.textContent).not.toContain("aiLab.audioNoOutput");
  expect(host.textContent).toContain("Audio playback:");
  expect(h.post).not.toHaveBeenCalled();
});
it("does not mistake an image output for playable audio", async () => {
  const audioJob = useAudioCatalog();
  const previous = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) =>
    path === `/ai/jobs/${job.id}`
      ? {
          ...audioJob,
          outputs: [{ id: "image", type: "image", url: "https://example.test/cover.png" }],
        }
      : previous(path, options)
  );
  jobs = [audioJob];
  await mount();
  await click("aiLab.audio");
  await click("aiLab.history");
  await click("Audio model · aiLab.status.completed");
  expect(host.textContent).toContain("aiLab.audioNoOutput");
  expect(host.textContent).not.toContain("Audio playback:");
});

it("clears recovered catalog errors on explicit refresh without a paid request", async () => {
  const get = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) => {
    if (path === "/ai/models") throw new Error("Catalog temporarily unavailable");
    return get(path, ...args);
  });
  await mount();
  expect(host.textContent).toContain("Catalog temporarily unavailable");
  h.get.mockImplementation(get);
  await click("common.retry");
  expect(host.textContent).not.toContain("Catalog temporarily unavailable");
  expect(button("Image preset")).toBeDefined();
  expect(h.post).not.toHaveBeenCalled();
});
it("recovers history reads without treating them as generation retries", async () => {
  const get = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) => {
    if (path === "/ai/jobs") throw new Error("History temporarily unavailable");
    return get(path, ...args);
  });
  await mount();
  await click("aiLab.history");
  expect(host.textContent).toContain("History temporarily unavailable");
  expect(host.textContent).not.toContain("aiLab.empty");
  h.get.mockImplementation(get);
  jobs = [job];
  await click("common.retry");
  expect(host.textContent).not.toContain("History temporarily unavailable");
  expect(host.textContent).toContain("Lake");
  expect(h.post).not.toHaveBeenCalled();
});

for (const outcome of [true, false, "rejected"] as const) {
  it(`copies a result prompt with honest feedback: ${outcome}`, async () => {
    const audioJob = useAudioCatalog();
    jobs = [audioJob];
    const get = h.get.getMockImplementation()!;
    h.get.mockImplementation(async (path, options) =>
      path === `/ai/jobs/${job.id}` ? audioJob : get(path, options)
    );
    if (outcome === "rejected") h.copy.mockRejectedValue(new Error("Clipboard unavailable"));
    else h.copy.mockResolvedValue(outcome);
    await mount();
    await click("aiLab.audio");
    await click("aiLab.history");
    await click("Audio model · aiLab.status.completed");
    await click("aiLab.copyPrompt");
    expect(h.copy).toHaveBeenCalledWith(audioJob.prompt);
    expect(host.textContent?.includes("aiLab.promptCopied")).toBe(outcome === true);
    if (outcome === false) expect(host.textContent).toContain("aiLab.copyPromptFailed");
    if (outcome === "rejected") expect(host.textContent).toContain("Clipboard unavailable");
    expect(h.post).not.toHaveBeenCalled();
  });
}

it("shows selected result metadata using its catalog model name without submitting a job", async () => {
  const completed = {
    ...job,
    status: "completed",
    createdAt: "2026-10-02T12:00:00Z",
    outputs: [
      {
        id: "image",
        type: "image",
        url: "https://example.test/image.png",
        width: 1440,
        height: 1080,
      },
    ],
  };
  jobs = [completed];
  const get = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) =>
    path === `/ai/jobs/${job.id}` ? completed : get(path, options)
  );
  await mount();
  await click("aiLab.history");
  await click("Image model · aiLab.status.completed");
  expect(host.textContent).toContain("aiLab.resultResolution: 1440 × 1080");
  expect(host.textContent).toContain("aiLab.resultRatio: 4:3");
  expect(host.textContent).toContain("aiLab.resultCreated:");
  expect(host.textContent).not.toContain("aiLab.resultDuration:");
  expect(h.post).not.toHaveBeenCalled();
});

it.each(["disabled", "schema", "price", "access"])(
  "rechecks %s changes before creating a charged request",
  async (kind) => {
    await mount();
    await click("Image preset");
    await change("Prompt", "Keep this prompt");
    const originalGet = h.get.getMockImplementation()!;
    h.get.mockImplementation(async (path, ...args) => {
      if (path !== "/ai/models") return originalGet(path, ...args);
      return {
        ...catalog,
        models: [
          {
            ...model,
            ...(kind === "disabled"
              ? { enabled: false }
              : kind === "schema"
                ? { schemaVersion: "2" }
                : kind === "access"
                  ? { access: { allowed: false } }
                  : {}),
          },
        ],
        presets:
          kind === "price"
            ? [
                {
                  ...catalog.presets[0],
                  billingPolicy: { mode: "charge", preflightCost: 8, displayCurrency: "points" },
                },
              ]
            : catalog.presets,
      };
    });
    await click("aiLab.generate");
    await click("aiLab.confirm");
    expect(h.post).not.toHaveBeenCalled();
    expect(host.textContent).toContain("aiLab.catalogChanged");
    expect(input("Prompt").value).toBe("Keep this prompt");
    if (kind === "price") {
      await click("aiLab.generate");
      await click("aiLab.confirm");
      expect(h.post).toHaveBeenCalledOnce();
    }
  }
);

it("requires explicit removal of obsolete settings without erasing the prompt", async () => {
  await mount();
  await click("Image preset");
  await change("Prompt", "Keep my words");
  await change("Seed", "0");
  const originalGet = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) =>
    path === "/ai/models"
      ? {
          ...catalog,
          models: [
            {
              ...model,
              input_schema: {
                ...model.input_schema,
                properties: { prompt: model.input_schema.properties.prompt },
              },
            },
          ],
        }
      : originalGet(path, ...args)
  );
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("aiLab.unsupportedSavedSettings");
  expect(host.textContent).toContain('seed: "0"');
  await click("aiLab.generate");
  expect(h.post).not.toHaveBeenCalled();
  // Test translations return keys; each removal keeps the other values intact.
  while (button("aiLab.removeSavedSetting")) {
    await click("aiLab.removeSavedSetting");
    expect(input("Prompt").value).toBe("Keep my words");
  }
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.post.mock.calls[0][1].data.input).toEqual({ prompt: "Keep my words" });
});

it("keeps the confirmed retry target when another history row is selected", async () => {
  const failed = {
    ...job,
    status: "failed",
    error: { userMessage: "Provider failed", retryable: true },
  };
  const other = { ...failed, id: "22222222-2222-4222-8222-222222222222", prompt: "Other job" };
  jobs = [failed, other];
  const oldGet = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) => {
    if (path === `/ai/jobs/${failed.id}`) return failed;
    if (path === `/ai/jobs/${other.id}`) return other;
    return oldGet(path, ...args);
  });
  await mount();
  await click("aiLab.history");
  await click("Image model · aiLab.status.failed");
  await click("aiLab.retryJob");
  await act(async () =>
    [...host.querySelectorAll("button")]
      .filter((b) => b.textContent === "Image model · aiLab.status.failed")[1]
      .click()
  );
  expect(host.textContent).toContain("Other job");
  await click("aiLab.confirm");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0][0]).toBe(`/ai/jobs/${failed.id}/retry`);
});

it("cancels the original confirmed job when history selection changes", async () => {
  const other = { ...job, id: "22222222-2222-4222-8222-222222222222", prompt: "Other queued job" };
  jobs = [job, other];
  const oldGet = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) => {
    if (path === `/ai/jobs/${job.id}`) return job;
    if (path === `/ai/jobs/${other.id}`) return other;
    return oldGet(path, ...args);
  });
  h.post.mockImplementation(async (path) => {
    expect(path).toBe(`/ai/jobs/${job.id}/cancel`);
    return { ...job, status: "cancelled", stage: "cancelled" };
  });
  await mount();
  await click("aiLab.history");
  await click("Image model · aiLab.status.in_queue");
  await click("aiLab.cancel");
  await act(async () =>
    [...host.querySelectorAll("button")]
      .filter((b) => b.textContent === "Image model · aiLab.status.in_queue")[1]
      .click()
  );
  expect(host.textContent).toContain("Other queued job");
  expect(host.textContent).toContain("Lake");
  await click("aiLab.confirm");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0][0]).toBe(`/ai/jobs/${job.id}/cancel`);
});

it.each(["background", "route exit", "account change"])(
  "handles a reference picker across %s",
  async (transition) => {
    let resolvePick!: (value: unknown) => void;
    h.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePick = resolve;
        })
    );
    const put = vi.fn().mockResolvedValue({ ok: true });
    h.selected.mockResolvedValue({ size: 100, put });
    h.post
      .mockResolvedValueOnce({
        uploadUrl: "https://storage.test/upload",
        method: "PUT",
        headers: {},
        storageKey: "staging/image",
      })
      .mockResolvedValueOnce({
        mediaAssetId: "22222222-2222-4222-8222-222222222222",
        storageKey: "final/image",
        url: "https://storage.test/final.png",
      });
    await mount();
    await click("Image preset");
    await change("Prompt", "Keep this prompt");
    await click("aiLab.uploadImage");
    if (transition === "background") h.active = false;
    else if (transition === "route exit") h.focused = false;
    else h.generation = 2;
    await mount();
    expect(host.textContent).toBe("");
    if (transition === "background") {
      h.active = true;
      await mount();
    }
    await act(async () =>
      resolvePick({
        canceled: false,
        assets: [{ uri: "file:///image.png", name: "image.png", mimeType: "image/png" }],
      })
    );
    if (transition === "background") {
      expect(input("Prompt").value).toBe("Keep this prompt");
      expect(input("References").value).toBe("https://storage.test/final.png");
      expect(put).toHaveBeenCalledTimes(1);
      expect(h.post.mock.calls.every(([path]) => path.startsWith("/media/"))).toBe(true);
    } else {
      expect(h.post).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    }
  }
);

it("pauses job polling during background and preserves selected history on return", async () => {
  vi.useFakeTimers();
  try {
    jobs = [job];
    await mount();
    await click("aiLab.history");
    await click("Image model · aiLab.status.in_queue");
    expect(button("aiLab.cancel")).toBeDefined();
    h.active = false;
    await mount();
    const reads = h.get.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(16000));
    expect(h.get).toHaveBeenCalledTimes(reads);
    h.active = true;
    await mount();
    expect(h.get.mock.calls.length).toBeGreaterThan(reads);
    expect(button("aiLab.cancel")).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

it("isolates canvas composer drafts and saves card identity before paid submission", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  const workspaceId = "33333333-3333-4333-8333-333333333333";
  const project = {
    id,
    storyProjectId: id,
    kind: "story" as const,
    workspaceId,
    title: "Story",
    canGenerate: true,
  };
  const base = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) =>
    path === `/story-projects/${id}`
      ? { id, workspaceId, title: "Story", status: "active", capabilities: ["story.generate"] }
      : base(path, options)
  );
  const beforeSubmit = vi.fn(async () => {});
  const canvas = {
    documentId: "55555555-5555-4555-8555-555555555555",
    nodeId: "card-one",
    mode: "image" as const,
    seed: { prompt: "Original card prompt", modelId: "model", settings: {}, references: {} },
    beforeSubmit,
    beforeRetry: vi.fn(async () => {}),
    afterReceipt: vi.fn(async () => {}),
  };
  await mount(undefined, project, canvas);
  expect(button("aiLab.video")).toBeUndefined();
  await click("Image preset");
  expect(input("Prompt").value).toBe("Original card prompt");
  await change("Prompt", "Canvas lake");
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(beforeSubmit).toHaveBeenCalledOnce();
  expect(canvas.afterReceipt).toHaveBeenCalledOnce();
  expect(h.post).toHaveBeenCalledOnce();
  expect(beforeSubmit.mock.invocationCallOrder[0]).toBeLessThan(
    h.post.mock.invocationCallOrder[0]!
  );
  expect(h.post.mock.calls[0]![1].data).toMatchObject({
    workspaceId,
    storyProjectId: id,
    documentId: canvas.documentId,
    documentBlockId: "card-one",
    sourceSurface: "fizzstudio-canvas",
    input: { prompt: "Canvas lake" },
  });
  await mount(undefined, project, { ...canvas, nodeId: "card-two" });
  expect(input("Prompt")).toBeNull();
  await mount(undefined, project, canvas);
  expect(input("Prompt").value).toBe("Canvas lake");
});
it("does not submit a canvas job when saving its recovery identity fails", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  const workspaceId = "33333333-3333-4333-8333-333333333333";
  const project = {
    id,
    storyProjectId: id,
    kind: "story" as const,
    workspaceId,
    title: "Story",
    canGenerate: true,
  };
  const base = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) =>
    path === `/story-projects/${id}`
      ? { id, workspaceId, title: "Story", status: "active", capabilities: ["story.generate"] }
      : base(path, options)
  );
  const canvas = {
    documentId: "55555555-5555-4555-8555-555555555555",
    nodeId: "card-one",
    mode: "image" as const,
    beforeSubmit: vi.fn(async (): Promise<void> => {
      throw Error("Card save interrupted");
    }),
    beforeRetry: vi.fn(async () => {}),
    afterReceipt: vi.fn(async () => {}),
  };
  await mount(undefined, project, canvas);
  await click("Image preset");
  await change("Prompt", "Lake");
  await click("aiLab.generate");
  await click("aiLab.confirm");
  expect(host.textContent).toContain("Card save interrupted");
  expect(h.post).not.toHaveBeenCalled();
  expect(input("Prompt").value).toBe("Lake");
  const original = canvas.beforeSubmit.mock.calls[0];
  canvas.beforeSubmit.mockResolvedValueOnce(undefined);
  await click("aiLab.recover");
  expect(canvas.beforeSubmit.mock.calls[1]).toEqual(original);
  expect(h.post).toHaveBeenCalledOnce();
});

vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
