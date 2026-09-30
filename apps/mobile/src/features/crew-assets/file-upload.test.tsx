import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AssetFileUpload } from "./file-upload";
const h = vi.hoisted(() => ({
  generation: 1,
  pick: vi.fn(),
  discard: vi.fn(),
  attach: vi.fn(),
  destination: vi.fn(),
  close: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("@/auth/auth-store", () => ({
  getAuthGeneration: () => h.generation,
  subscribeAuth: (listener: () => void) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
  },
}));
vi.mock("./upload", () => ({ pickAndUploadCrewFile: h.pick, discardCrewUpload: h.discard }));
vi.mock("./organization-api", () => ({
  attachOrganizationFile: h.attach,
  validateAssetDestination: h.destination,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    editable: boolean;
  }) => <input disabled={!editable} value={value} onChange={(e) => onChangeText(e.target.value)} />,
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
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const file = { source: "upload", mediaAssetId: "media", name: "Art.png" };
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(
      <AssetFileUpload
        crewId="crew"
        userId="1"
        generation={1}
        parentId={null}
        destination="Root"
        onClose={h.close}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.listeners.clear();
  h.pick.mockResolvedValue(file);
  h.destination.mockResolvedValue(undefined);
  h.attach.mockResolvedValue({});
  h.discard.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("checks destination before picking then requires confirmation to attach", async () => {
  await render();
  await click("thread.uploadFile");
  expect(h.destination).toHaveBeenCalledWith("crew", "1", 1, null);
  expect(h.attach).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Art.png");
  await click("assetUpload.attach");
  expect(h.attach).toHaveBeenCalledWith("crew", "1", 1, {
    name: "Art.png",
    mediaAssetId: "media",
    parentId: null,
  });
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("does not pick for a revoked destination", async () => {
  h.destination.mockRejectedValue(new Error("Permission revoked"));
  await render();
  await click("thread.uploadFile");
  expect(h.pick).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Permission revoked");
});
it("retries the same uploaded media after an uncertain attachment", async () => {
  h.attach.mockRejectedValueOnce(new Error("Lost response"));
  await render();
  await click("thread.uploadFile");
  await click("assetUpload.attach");
  expect(button("assetUpload.discard")).toBeUndefined();
  await click("inbox.retry");
  expect(h.pick).toHaveBeenCalledTimes(1);
  expect(h.attach.mock.calls[0]).toEqual(h.attach.mock.calls[1]);
});
it("discards a staged upload without attaching it", async () => {
  await render();
  await click("thread.uploadFile");
  await click("assetUpload.discard");
  expect(h.discard).toHaveBeenCalledWith("crew", "media");
  expect(h.attach).not.toHaveBeenCalled();
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("keeps cancellation errors visible without losing the staged file", async () => {
  h.discard.mockRejectedValue(new Error("Storage unavailable"));
  await render();
  await click("thread.uploadFile");
  await click("assetUpload.discard");
  expect(host.textContent).toContain("Storage unavailable");
  expect(host.textContent).toContain("Art.png");
  expect(h.close).not.toHaveBeenCalled();
});
it("handles picker cancellation without a mutation", async () => {
  h.pick.mockResolvedValue(null);
  await render();
  await click("thread.uploadFile");
  expect(h.attach).not.toHaveBeenCalled();
  expect(button("crewTasks.back")).toBeDefined();
});
it("aborts uploads on account change and ignores late results", async () => {
  let finish!: (value: unknown) => void;
  h.pick.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  await click("thread.uploadFile");
  h.generation = 2;
  h.listeners.forEach((f) => f());
  expect(h.pick.mock.calls[0]![1].aborted).toBe(true);
  await act(async () => finish(file));
  expect(button("assetUpload.attach")).toBeUndefined();
  expect(h.discard).not.toHaveBeenCalled();
});
it("blocks duplicate taps and navigation during attachment", async () => {
  let finish!: () => void;
  h.attach.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await click("thread.uploadFile");
  await act(async () => {
    button("assetUpload.attach")!.click();
    button("assetUpload.attach")!.click();
  });
  expect(h.attach).toHaveBeenCalledTimes(1);
  expect(button("crewTasks.back")!.disabled).toBe(true);
  await act(async () => finish());
});
it("allows returning after discard fails without silently deleting or attaching", async () => {
  h.discard.mockRejectedValue(new Error("Permission revoked"));
  await render();
  await click("thread.uploadFile");
  await click("assetUpload.discard");
  await click("crewTasks.back");
  expect(h.close).toHaveBeenCalledTimes(1);
  expect(h.attach).not.toHaveBeenCalled();
  expect(h.discard).toHaveBeenCalledTimes(1);
});
