import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PositionLifecycle } from "./position-lifecycle";
const h = vi.hoisted(() => ({ generation: 1, read: vi.fn(), change: vi.fn(), close: vi.fn() }));
vi.mock("./position-lifecycle-api", () => ({
  fetchLifecyclePosition: h.read,
  changePositionLifecycle: h.change,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white", border: "gray" }) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
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
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

const position = {
  id: "position",
  crewId: "crew",
  taskId: null,
  positionType: "director",
  status: "open" as const,
  targetCount: 2,
  recruitedCount: 0,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key);
const click = async (key: string) => {
  await act(async () => button(key)!.click());
};
const render = async () => {
  await act(async () =>
    root.render(
      <PositionLifecycle position={position} userId="manager" generation={1} onClose={h.close} />
    )
  );
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.read.mockResolvedValue(position);
  h.change.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires confirmation and allows cancel", async () => {
  await render();
  await click("positionLifecycle.remove");
  expect(h.change).not.toHaveBeenCalled();
  expect(host.textContent).toContain("positionLifecycle.confirmRemove");
  await click("positionLifecycle.cancel");
  expect(button("positionLifecycle.freeze")).toBeDefined();
});
it.each(["freeze", "remove"])("submits confirmed %s and hides stale status", async (action) => {
  await render();
  await click("positionLifecycle." + action);
  await click("positionLifecycle.confirm");
  expect(h.change).toHaveBeenCalledWith(position, "manager", 1, action);
  expect(host.textContent).toContain("positionLifecycle.saved");
  expect(host.textContent).not.toContain("positionLifecycle.open");
});
it("offers reopen for frozen positions", async () => {
  h.read.mockResolvedValue({ ...position, status: "frozen" });
  await render();
  await click("positionLifecycle.reopen");
  await click("positionLifecycle.confirm");
  expect(h.change.mock.calls[0][3]).toBe("reopen");
});
it("surfaces rejection and requires refreshed list before another action", async () => {
  h.change.mockRejectedValue(new Error("pending applications"));
  await render();
  await click("positionLifecycle.remove");
  await click("positionLifecycle.confirm");
  expect(host.textContent).toContain("pending applications");
  expect(host.textContent).toContain("positionLifecycle.recheck");
  expect(button("positionLifecycle.confirm")).toBeUndefined();
  await click("nativeApplications.back");
  expect(h.close).toHaveBeenCalledOnce();
});
it("hides controls on permission failure", async () => {
  h.read.mockRejectedValue(new Error("permission denied"));
  await render();
  expect(button("positionLifecycle.remove")).toBeUndefined();
});
it("locks double taps and back during a write", async () => {
  let resolve!: () => void;
  h.change.mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    })
  );
  await render();
  await click("positionLifecycle.freeze");
  await act(async () => {
    button("positionLifecycle.confirm")!.click();
    button("positionLifecycle.confirm")!.click();
  });
  expect(h.change).toHaveBeenCalledOnce();
  expect(button("nativeApplications.back")!.disabled).toBe(true);
  await act(async () => resolve());
});
it("blocks stale account action", async () => {
  await render();
  await click("positionLifecycle.freeze");
  h.generation = 2;
  await click("positionLifecycle.confirm");
  expect(h.change).not.toHaveBeenCalled();
});
