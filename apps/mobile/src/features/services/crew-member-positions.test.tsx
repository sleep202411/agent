import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewMemberPositions } from "./crew-member-positions";
const h = vi.hoisted(() => ({ generation: 1, save: vi.fn(), close: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./crew-member-positions-api", async (original) => ({
  ...(await original<typeof import("./crew-member-positions-api")>()),
  updateCrewMemberPositions: h.save,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
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
  userId: "2",
  status: "active" as const,
  isOwner: false,
  version: 1,
  joinedAt: "2026-09-30T00:00:00Z",
  positions: [
    {
      id: "position",
      categoryKey: "director",
      title: null,
      isPrimary: true,
      sourcePositionId: null,
    },
  ],
  policyKeys: [],
};
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(
      <CrewMemberPositions
        crewId="crew"
        userId="1"
        generation={1}
        member={member}
        name="Artist"
        onClose={h.close}
      />
    )
  );
const type = (index: number, value: string) =>
  act(async () => {
    const input = host.querySelectorAll("input")[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.save.mockResolvedValue(member);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("edits the existing title and requires confirmation", async () => {
  await render();
  expect(button("assetOrganization.save")!.disabled).toBe(true);
  await type(0, "Lead Director");
  await click("assetOrganization.save");
  expect(h.save).not.toHaveBeenCalled();
  await click("assetOrganization.confirm");
  expect(h.save).toHaveBeenCalledWith("crew", "1", 1, member, [
    { categoryKey: "director", title: "Lead Director" },
  ]);
});
it("requires a title for a newly added custom position", async () => {
  await render();
  await click("memberPositions.add");
  expect(button("assetOrganization.save")!.disabled).toBe(true);
  await type(1, "Assistant");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(h.save.mock.calls[0]![4][1]).toEqual({ categoryKey: null, title: "Assistant" });
});
it("allows clearing positions without removing membership", async () => {
  await render();
  await click("memberPositions.remove");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(h.save.mock.calls[0]![4]).toEqual([]);
});
it("moves the selected position to primary", async () => {
  await render();
  await click("memberPositions.add");
  await type(1, "Producer");
  await click("memberPositions.makePrimary");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(h.save.mock.calls[0]![4][0]).toEqual({ categoryKey: null, title: "Producer" });
});
it("locks after a conflict until returning to fresh membership", async () => {
  h.save.mockRejectedValue(new Error("Conflict"));
  await render();
  await type(0, "Changed");
  await click("assetOrganization.save");
  await click("assetOrganization.confirm");
  expect(button("assetOrganization.confirm")!.disabled).toBe(true);
  expect(host.textContent).toContain("Conflict");
  await click("crewTasks.back");
  expect(h.close).toHaveBeenCalled();
});
it("ignores stale-account writes", async () => {
  await render();
  await type(0, "Changed");
  await click("assetOrganization.save");
  h.generation = 2;
  await click("assetOrganization.confirm");
  expect(h.save).not.toHaveBeenCalled();
});
