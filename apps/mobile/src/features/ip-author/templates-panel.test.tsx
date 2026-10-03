import type { TemplatesSnapshot, GenerationTemplate } from "./templates-api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpTemplatesPanel } from "./templates-panel";
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
  pick: vi.fn(),
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
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
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

vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("./selected-media", () => ({ selectedMedia: h.selected }));
const id = "11111111-1111-4111-8111-111111111111",
  templateId = "22222222-2222-4222-8222-222222222222",
  asset = "33333333-3333-4333-8333-333333333333";
const template = (): GenerationTemplate => ({
  id: templateId,
  name: "Poster",
  description: "Description",
  modelId: "image-one",
  promptPrefix: "Prefix",
  promptSuffix: "Suffix",
  requireReferenceImage: true,
  referenceImageHint: "Portrait",
  outputAspectRatio: "1:1",
  logoAssetId: null,
  enabled: true,
  order: 1,
});
let snapshot: TemplatesSnapshot, root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpTemplatesPanel ipId={id} userId="alice" generation={1} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const input = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const change = (label: string, value: string) =>
  act(async () => {
    const node = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
const reopen = async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
};
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  snapshot = { version: 1, templates: [template()] };
  h.get.mockImplementation(async (path) =>
    path === "/ai/models"
      ? {
          models: [
            { id: "image-one", name: "Image One", type: "image" },
            { id: "video-one", name: "Video One", type: "video" },
          ],
        }
      : snapshot
  );
  h.put.mockImplementation(async (_path, { data }) => {
    snapshot = { version: snapshot.version + 1, templates: data.templates };
    return snapshot;
  });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///logo.png", name: "logo.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: async () => ({ ok: true }) });
  h.post.mockImplementation(async (path) =>
    path.endsWith("upload-url")
      ? {
          uploadUrl: "https://storage.test/logo",
          method: "PUT",
          headers: {},
          storageKey: "logo/key",
        }
      : { mediaAssetId: asset, storageKey: "logo/key" }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("edits every field, chooses an official model and preserves the draft across reopening", async () => {
  await mount();
  await change("ipTemplates.name", "New name");
  await change("ipTemplates.description", "Text ");
  await change("ipTemplates.promptPrefix", "Prefix two");
  await change("ipTemplates.promptSuffix", "Suffix two");
  await change("ipTemplates.referenceImageHint", "Guidance");
  await click("ipTemplates.chooseModel");
  await click("Video One");
  await click("16:9");
  await click("✓ ipTemplates.requireReferenceImage");
  await click("✓ ipTemplates.enabled");
  await reopen();
  expect(input("ipTemplates.description").value).toBe("Text ");
  await click("ipTemplates.save");
  expect(h.put.mock.calls[0][1].data.templates[0]).toMatchObject({
    name: "New name",
    description: "Text",
    promptPrefix: "Prefix two",
    promptSuffix: "Suffix two",
    referenceImageHint: "Guidance",
    modelId: "video-one",
    outputAspectRatio: "16:9",
    requireReferenceImage: false,
    enabled: false,
  });
  expect(host.textContent).toContain("ipTemplates.saved");
});
it("adds, reorders and confirms removal without silently saving", async () => {
  await mount();
  await click("ipTemplates.add");
  expect(button("ipTemplates.save").disabled).toBe(true);
  await change("ipTemplates.name", "Second");
  await click("ipTemplates.up");
  expect(host.textContent).toContain("1. Second");
  await click("ipTemplates.remove");
  await click("common.cancel");
  expect(host.textContent).toContain("Second");
  await click("ipTemplates.remove");
  await click("ipTemplates.confirm");
  expect(host.textContent).not.toContain("Second");
  expect(h.put).not.toHaveBeenCalled();
});
it("retains unknown saves after restart and recovers by readback without repeating the write", async () => {
  h.put.mockImplementationOnce(async (_path, { data }) => {
    snapshot = { version: 2, templates: data.templates };
    throw Error("Lost response");
  });
  await mount();
  await click("ipTemplates.save");
  await reopen();
  expect(input("ipTemplates.name").readOnly).toBe(true);
  await click("common.retry");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipTemplates.saved");
});
it("keeps conflicting drafts until refresh, review and explicit replacement", async () => {
  await mount();
  await change("ipTemplates.name", "Mine");
  snapshot = { version: 2, templates: [{ ...template(), name: "Other editor" }] };
  await click("ipTemplates.save");
  expect(h.put).not.toHaveBeenCalled();
  await click("thread.refresh");
  expect(input("ipTemplates.name").value).toBe("Mine");
  expect(host.textContent).toContain("Other editor");
  await click("ipTemplates.reset");
  await click("ipTemplates.confirm");
  expect(input("ipTemplates.name").value).toBe("Other editor");
  expect(host.textContent).not.toContain("ipTemplates.pending");
});
it("resumes logo confirmation after restart without another picker or upload", async () => {
  h.post
    .mockImplementationOnce(async () => ({
      uploadUrl: "https://storage.test/logo",
      method: "PUT",
      headers: {},
      storageKey: "logo/key",
    }))
    .mockRejectedValueOnce(Error("Offline"));
  await mount();
  await click("ipTemplates.uploadLogo");
  expect(host.textContent).toContain("ipTemplates.logoPending");
  await reopen();
  await click("ipTemplates.retryLogo");
  expect(h.pick).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipTemplates.logoAttached");
  await click("ipTemplates.save");
  expect(h.put.mock.calls[0][1].data.templates[0].logoAssetId).toBe(asset);
});
it("does not invent a model when the official catalog is unavailable", async () => {
  h.get.mockImplementation(async (path) => {
    if (path === "/ai/models") throw Error("Catalog offline");
    return snapshot;
  });
  await mount();
  expect(button("ipTemplates.add").disabled).toBe(true);
  expect(host.textContent).toContain("image-one");
  expect(host.textContent).toContain("Catalog offline");
});
it("hides private configuration on access loss, inactivity and auth change", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  await mount();
  h.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "Access removed", 403));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Poster");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
});

it("retains edited fields and the logo picker across backgrounding without saving implicitly", async () => {
  let finish!: (value: unknown) => void;
  h.pick.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  await change("ipTemplates.name", "Edited poster");
  await click("ipTemplates.uploadLogo");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  await act(async () =>
    finish({
      canceled: false,
      assets: [{ uri: "file:///logo.png", name: "logo.png", mimeType: "image/png" }],
    })
  );
  h.active = true;
  await mount();
  expect(input("ipTemplates.name").value).toBe("Edited poster");
  expect(host.textContent).toContain("ipTemplates.logoAttached");
  expect(h.pick).toHaveBeenCalledOnce();
  expect(h.selected).toHaveBeenCalledOnce();
  expect(h.put).not.toHaveBeenCalled();
  await click("ipTemplates.save");
  expect(h.put).toHaveBeenCalledOnce();
  expect(h.put.mock.calls[0][1].data.templates[0]).toMatchObject({
    name: "Edited poster",
    logoAssetId: asset,
  });
});
for (const exit of ["route", "account"] as const) {
  it(`rejects a late logo selection after ${exit} exit`, async () => {
    let finish!: (value: unknown) => void;
    h.pick.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await click("ipTemplates.uploadLogo");
    if (exit === "route") h.focused = false;
    else h.generation = 2;
    await mount();
    await act(async () =>
      finish({
        canceled: false,
        assets: [{ uri: "file:///logo.png", name: "logo.png", mimeType: "image/png" }],
      })
    );
    expect(host.textContent).toBe("");
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });
}
