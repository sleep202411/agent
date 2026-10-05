import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ContentReportCreate } from "./content-report-create";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000009" },
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
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
  ActivityIndicator: () => null,
  TextInput: () => null,
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
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

vi.mock("@/data/ip-api", () => ({ reportIpContent: (data: unknown) => h.post(data) }));
vi.mock("@/features/ip-community/ip-report-sheet", () => ({
  IpReportSheet: ({ visible, draft, onChange, onSubmit, onClose, allowBlock }: any) =>
    visible ? (
      <div>
        <span>{draft.description}</span>
        <span>block:{String(allowBlock)}</span>
        <button onClick={() => onChange({ description: "My evidence" })}>edit</button>
        <button onClick={onSubmit}>submit</button>
        <button onClick={onClose}>close</button>
      </div>
    ) : null,
}));
const row = { id: id(1), title: "River film", roomNumber: "123" };
let root: Root, host: HTMLDivElement;
const saved = vi.fn(),
  close = vi.fn();
const mount = () =>
  act(async () =>
    root.render(
      <ContentReportCreate
        userId="a"
        generation={1}
        active={h.active}
        onSaved={saved}
        onClose={close}
      />
    )
  );
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  h.post.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("selects an official target and submits edited details once", async () => {
  await mount();
  await click("River film · 123");
  await click("edit");
  expect(host.textContent).toContain("block:false");
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "submit")!.click();
    [...host.querySelectorAll("button")].find((b) => b.textContent === "submit")!.click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith({
    requestId: id(9),
    targetType: "ip",
    targetId: row.id,
    reason: "copyright",
    description: "My evidence",
  });
  expect(saved).toHaveBeenCalledOnce();
});
it("retains the edited draft across background and failed submission", async () => {
  await mount();
  await click("River film · 123");
  await click("edit");
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(host.textContent).toContain("My evidence");
  h.post.mockRejectedValue(Error("Network interrupted"));
  await click("submit");
  expect(host.textContent).toContain("Network interrupted");
  expect(saved).not.toHaveBeenCalled();
  await click("River film · 123");
  expect(host.textContent).toContain("My evidence");
  h.post.mockResolvedValue(undefined);
  await click("submit");
  expect(h.post.mock.calls[1][0]).toEqual(h.post.mock.calls[0][0]);
});
it("does not complete a replacement account's form", async () => {
  let resolve!: () => void;
  h.post.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await mount();
  await click("River film · 123");
  await click("submit");
  h.generation = 2;
  await act(async () => resolve());
  expect(saved).not.toHaveBeenCalled();
});
