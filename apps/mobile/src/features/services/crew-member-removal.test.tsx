import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewMemberRemoval } from "./crew-member-removal";
const h = vi.hoisted(() => ({ generation: 1, remove: vi.fn(), close: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./crew-members-api", () => ({ removeCrewMember: h.remove }));
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
      <CrewMemberRemoval
        crewId="crew"
        userId="actor"
        generation={1}
        member={{ ...member, isOwner }}
        name="Artist"
        onClose={h.close}
      />
    )
  );
const type = (value: string) =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
it("requires exact target user ID before removal", async () => {
  await render();
  expect(button("crewMembers.confirmRemove")!.disabled).toBe(true);
  await type("Artist");
  expect(button("crewMembers.confirmRemove")!.disabled).toBe(true);
  await type("recipient");
  await click("crewMembers.confirmRemove");
  expect(h.remove).toHaveBeenCalledWith("crew", "actor", 1, member);
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("prevents owner removal", async () => {
  await render(true);
  expect(button("crewMembers.confirmRemove")).toBeUndefined();
  expect(host.textContent).toContain("crewMembers.ownerProtected");
});
it("locks a failed attempt until returning to a fresh directory", async () => {
  h.remove.mockRejectedValue(new Error("Version changed"));
  await render();
  await type("recipient");
  await click("crewMembers.confirmRemove");
  expect(host.textContent).toContain("Version changed");
  expect(button("crewMembers.confirmRemove")!.disabled).toBe(true);
  await click("crewTasks.back");
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("prevents duplicate requests and blocks navigation while removing", async () => {
  let finish!: () => void;
  h.remove.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await type("recipient");
  await act(async () => {
    button("crewMembers.confirmRemove")!.click();
    button("crewMembers.confirmRemove")!.click();
  });
  expect(h.remove).toHaveBeenCalledTimes(1);
  expect(button("crewTasks.back")!.disabled).toBe(true);
  await act(async () => finish());
});
it("blocks stale-account actions", async () => {
  await render();
  await type("recipient");
  h.generation = 2;
  await click("crewMembers.confirmRemove");
  expect(h.remove).not.toHaveBeenCalled();
});
