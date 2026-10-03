import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AssetCandidatePicker } from "./story-asset-candidate-picker";
const h = vi.hoisted(() => ({
  focused: true,
  load: vi.fn(),
  pick: vi.fn(),
  read: vi.fn(),
  resume: vi.fn(),
  clear: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: 1, user: { id: "user" } }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: () => ({}) }));
vi.mock("../api/story-timeline-media", () => ({ fetchTimelineCandidates: h.load }));
vi.mock("../api/story-timeline-upload", () => ({
  timelineUpload: () => ({ read: h.read, pick: h.pick, resume: h.resume, clear: h.clear }),
}));
vi.mock("expo-image", () => ({ Image: () => null }));
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

let root: Root, host: HTMLDivElement;
const image = { asset: { id: "image", kind: "image", previewUrl: null } };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  h.focused = true;
  h.read.mockReturnValue(null);
  h.load.mockResolvedValue([image, { asset: { id: "video", kind: "video" } }]);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const render = async (locked = false) => {
  await act(async () =>
    root.render(
      <AssetCandidatePicker
        projectId="project"
        chapterId="chapter"
        locked={locked}
        onSelect={h.select}
        onClose={h.close}
      />
    )
  );
};
const click = async (label: string) => {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
};
it("shows only images and requires explicit selection", async () => {
  await render();
  expect(host.textContent).not.toContain("assetEdit.useImage 2");
  expect(h.select).not.toHaveBeenCalled();
  await click("assetEdit.useImage 1");
  expect(h.select).toHaveBeenCalledWith("image");
});
it("uploads only images and waits for explicit selection", async () => {
  h.pick.mockResolvedValue({ asset: { id: "uploaded", kind: "image" } });
  await render();
  await click("assetEdit.uploadImage");
  expect(h.pick).toHaveBeenCalledWith(expect.any(AbortSignal), true);
  expect(h.select).not.toHaveBeenCalled();
  await click("assetEdit.useImage 1");
  expect(h.select).toHaveBeenCalledWith("uploaded");
});
it("resumes existing uploads without picking another file", async () => {
  h.read.mockReturnValue({ clientKey: "saved" });
  h.resume.mockResolvedValue(image);
  await render();
  await click("timeline.retryUpload");
  expect(h.resume).toHaveBeenCalledOnce();
  expect(h.pick).not.toHaveBeenCalled();
});
it("disables selection and upload when locked", async () => {
  await render(true);
  await click("assetEdit.useImage 1");
  await click("assetEdit.uploadImage");
  expect(h.select).not.toHaveBeenCalled();
  expect(h.pick).not.toHaveBeenCalled();
});
it("shows fetch failures and permits retry", async () => {
  h.load.mockRejectedValueOnce(Error("Unavailable"));
  await render();
  expect(host.textContent).toContain("Unavailable");
  await click("common.retry");
  expect(host.textContent).toContain("assetEdit.useImage 1");
});

it("retires an unfinished image pick when the route loses focus", async () => {
  let finish!: (value: unknown) => void;
  h.pick.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("assetEdit.uploadImage");
  const signal = h.pick.mock.calls[0][0] as AbortSignal;
  h.focused = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ asset: { id: "retired", kind: "image" } }));
  expect(host.textContent).not.toContain("retired");
  expect(h.select).not.toHaveBeenCalled();
});
