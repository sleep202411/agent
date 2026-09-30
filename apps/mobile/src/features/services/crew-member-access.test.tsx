import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewMemberAccess } from "./crew-member-access";
const h = vi.hoisted(() => ({ generation: 1, remove: vi.fn(), close: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./crew-member-access-api", () => ({ updateCrewMemberAccess: h.remove }));
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
const member = {
  id: "member",
  crewId: "crew",
  userId: "recipient",
  status: "active" as const,
  isOwner: false,
  version: 1,
  joinedAt: "2026-09-30T00:00:00Z",
  positions: [],
  policyKeys: [],
};
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = (isOwner = false) =>
  act(async () =>
    root.render(
      <CrewMemberAccess
        crewId="crew"
        userId="actor"
        generation={1}
        member={{ ...member, isOwner }}
        name="Artist"
        onClose={h.close}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("reviews the selected policies before saving", async () => {
  await render();
  expect(button("memberAccess.review")!.disabled).toBe(true);
  await click("memberAccess.both");
  await click("memberAccess.review");
  expect(h.remove).not.toHaveBeenCalled();
  await click("memberAccess.confirm");
  expect(h.remove).toHaveBeenCalledWith("crew", "actor", 1, member, ["admin", "finance"]);
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("protects the owner", async () => {
  await render(true);
  expect(button("memberAccess.review")).toBeUndefined();
});
it("locks failed attempts until refreshed", async () => {
  h.remove.mockRejectedValue(new Error("Version conflict"));
  await render();
  await click("crewMembers.finance");
  await click("memberAccess.review");
  await click("memberAccess.confirm");
  expect(host.textContent).toContain("Version conflict");
  expect(button("memberAccess.confirm")!.disabled).toBe(true);
  await click("crewTasks.back");
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("blocks duplicate saves and navigation during a request", async () => {
  let finish!: () => void;
  h.remove.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await click("crewMembers.admin");
  await click("memberAccess.review");
  await act(async () => {
    button("memberAccess.confirm")!.click();
    button("memberAccess.confirm")!.click();
  });
  expect(h.remove).toHaveBeenCalledTimes(1);
  expect(button("crewTasks.back")!.disabled).toBe(true);
  await act(async () => finish());
});
it("rejects stale account actions", async () => {
  await render();
  await click("crewMembers.finance");
  await click("memberAccess.review");
  h.generation = 2;
  await click("memberAccess.confirm");
  expect(h.remove).not.toHaveBeenCalled();
});
it("allows revising the selection before confirming", async () => {
  await render();
  await click("crewMembers.finance");
  await click("memberAccess.review");
  await click("memberAccess.edit");
  await click("crewMembers.admin");
  await click("memberAccess.review");
  await click("memberAccess.confirm");
  expect(h.remove).toHaveBeenCalledWith("crew", "actor", 1, member, ["admin"]);
});
