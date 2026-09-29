import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ConversationFile } from "./conversation-file";
const h = vi.hoisted(() => ({ access: vi.fn(), open: vi.fn(), active: true, generation: 1 }));
vi.mock("@/features/crew-assets/api", () => ({ fetchCrewAssetAccess: h.access }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = () =>
  act(async () => root.render(<ConversationFile mediaAssetId="media" name="Clip" />));
const click = () => host.querySelector("button")!.click();
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("resolves access on each open, guards rapid taps and never renders the signed URL", async () => {
  let finish!: (v: unknown) => void;
  h.access
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    )
    .mockResolvedValue({ url: "https://files.test/new" });
  await render();
  expect(h.access).not.toHaveBeenCalled();
  await act(async () => {
    click();
    click();
  });
  expect(h.access).toHaveBeenCalledTimes(1);
  await act(async () => finish({ url: "https://files.test/signed" }));
  expect(h.open).toHaveBeenCalledWith("https://files.test/signed");
  expect(host.textContent).not.toContain("https:");
  await act(async () => click());
  expect(h.access).toHaveBeenCalledTimes(2);
  expect(h.open).toHaveBeenLastCalledWith("https://files.test/new");
});
it("aborts backgrounded opens and permits a fresh request when returning", async () => {
  let finish!: (v: unknown) => void;
  h.access
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    )
    .mockResolvedValue({ url: "https://files.test/new" });
  await render();
  await act(async () => click());
  const signal = h.access.mock.calls[0][1];
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ url: "https://files.test/stale" }));
  expect(h.open).not.toHaveBeenCalled();
  h.active = true;
  await render();
  await act(async () => click());
  expect(h.open).toHaveBeenCalledWith("https://files.test/new");
});
it("does not open for a changed account and keeps access failures retryable", async () => {
  h.access.mockRejectedValueOnce(new Error("Access revoked"));
  await render();
  await act(async () => click());
  expect(host.textContent).toContain("Access revoked");
  expect(host.querySelector("button")!.disabled).toBe(false);
  let finish!: (v: unknown) => void;
  h.access.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await act(async () => click());
  h.generation++;
  await act(async () => finish({ url: "https://files.test/stale" }));
  expect(h.open).not.toHaveBeenCalled();
});
