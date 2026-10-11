import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ReferencePanel } from "./story-reference-panel";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  submit: vi.fn(),
  pick: vi.fn(),
  resume: vi.fn(),
  pending: null as unknown,
  uploadPending: null as unknown,
  clear: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ status: "authenticated" }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("../context/story-chapter-context", () => ({ useStoryChapterContext: () => ({}) }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ background: "black", backgroundElement: "#111", text: "white" }),
}));
vi.mock("../api/story-references-api", async (original) => ({
  ...(await original<typeof import("../api/story-references-api")>()),
  storyReferences: () => ({ list: h.list }),
}));
vi.mock("../api/story-reference-commands", () => ({
  referenceCommands: () => ({ read: () => h.pending, submit: h.submit, clear: h.clear }),
}));
vi.mock("../api/story-reference-upload", () => ({
  referenceUpload: () => ({
    read: () => h.uploadPending,
    pick: h.pick,
    resume: h.resume,
    clear: h.clear,
  }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  Alert: { alert: vi.fn() },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Image: () => null,
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
    onChangeText: (v: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  Switch: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = "11111111-1111-4111-8111-111111111111";
const version = {
  id: "v",
  slotId: "slot",
  number: 1,
  approved: false,
  reviewRevision: 0,
  asset: {
    id: "a",
    kind: "image",
    status: "ready",
    moderationStatus: "approved",
    previewUrl: null,
  },
  variantId: "variant",
};
const row = {
  id: "slot",
  key: "HERO",
  label: "Hero",
  kind: "character",
  description: "Face",
  required: true,
  rank: 0,
  version: 2,
  status: "candidate",
  versions: [version],
};
let host: HTMLDivElement, root: Root;
const mount = (edit = true, review = true) =>
  act(async () =>
    root.render(
      <ReferencePanel
        scope={{ projectId: id, generation: 1 }}
        userId="u"
        edit={edit}
        review={review}
        close={h.close}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((v) => v.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.pending = null;
  h.uploadPending = null;
  h.list.mockResolvedValue([row]);
  h.submit.mockResolvedValue(undefined);
  h.pick.mockResolvedValue(null);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("distinguishes a read error from an empty pack and offers working refresh", async () => {
  h.list.mockRejectedValueOnce(Error("Access service unavailable"));
  await mount();
  expect(host.textContent).toContain("Access service unavailable");
  expect(host.textContent).not.toContain("references.empty");
  expect(button("references.create").disabled).toBe(true);
  await click("references.refresh");
  expect(host.textContent).toContain("HERO");
  expect(button("references.create").disabled).toBe(false);
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("keeps viewer reads available while disabling edits and reviews", async () => {
  await mount(false, false);
  await click("HERO · Hero · references.status.candidate");
  expect(button("references.upload").disabled).toBe(true);
  expect(button("references.review").disabled).toBe(true);
  expect(button("references.create").disabled).toBe(true);
});
it("opens an existing slot editor with the saved fields", async () => {
  await mount();
  await click("HERO · Hero · references.status.candidate");
  await click("references.edit");
  expect(host.querySelector<HTMLInputElement>('[aria-label="references.label"]')!.value).toBe(
    "Hero"
  );
  await click("references.save");
  expect(h.submit.mock.calls[0][0]).toMatchObject({
    action: "update",
    slotId: "slot",
    version: 2,
    slot: { key: "HERO", label: "Hero" },
  });
});
it("requires passing checks before approval", async () => {
  await mount();
  await click("HERO · Hero · references.status.candidate");
  await click("references.review");
  await click("references.decision.approve");
  expect(button("references.submitReview").disabled).toBe(true);
  const pass = () =>
    [...host.querySelectorAll("button")].filter((v) => v.textContent === "references.check.pass");
  await act(async () => pass()[0].click());
  await act(async () => pass()[1].click());
  await act(async () => pass()[1].click());
  expect(button("references.submitReview").disabled).toBe(false);
  await click("references.submitReview");
  expect(h.submit.mock.calls[0][0]).toMatchObject({
    action: "review",
    slotVersion: 2,
    input: { decision: "approve", expectedReviewRevision: 0 },
  });
});
it("retries saved upload without opening the picker", async () => {
  h.uploadPending = { clientKey: id };
  h.resume.mockImplementation(async () => {
    h.uploadPending = null;
  });
  await mount();
  expect(button("references.create").disabled).toBe(true);
  await click("references.retry");
  expect(h.resume).toHaveBeenCalledOnce();
  expect(h.pick).not.toHaveBeenCalled();
});
it("aborts a pending request on close/unmount and ignores its eventual result", async () => {
  let resolve!: (v: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await mount();
  const signal = h.list.mock.calls[0][0] as AbortSignal;
  await act(() => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve([row]));
  expect(host.textContent).toBe("");
});
it("reuses an existing reference with its actual asset and variant identity", async () => {
  h.list.mockResolvedValue([
    row,
    { ...row, id: "target", key: "STYLE", label: "Style", versions: [] },
  ]);
  await mount();
  await click("STYLE · Style · references.status.candidate");
  await click("Hero · references.version 1");
  expect(h.submit.mock.calls[0][0]).toMatchObject({
    action: "import",
    slotId: "target",
    input: { expectedSlotVersion: 2, source: "import", assetId: "a", variantId: "variant" },
  });
});
