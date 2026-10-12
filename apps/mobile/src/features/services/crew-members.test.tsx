import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewMembers } from "./crew-members";
vi.mock("./crew-ownership-transfer", () => ({
  CrewOwnershipTransfer: ({ onSuccess }: { onSuccess: () => void }) => (
    <button onClick={onSuccess}>complete transfer</button>
  ),
}));
vi.mock("./crew-member-access", () => ({
  CrewMemberAccess: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close access</button>
  ),
}));
const h = vi.hoisted(() => ({ generation: 1, read: vi.fn(), close: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("./crew-member-positions", () => ({
  CrewMemberPositions: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close positions</button>
  ),
}));
vi.mock("./crew-member-removal", () => ({
  CrewMemberRemoval: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close removal</button>
  ),
}));
vi.mock("./crew-members-api", () => ({ fetchCrewMemberPage: h.read }));
vi.mock("./user-displays", () => ({
  useUserDisplays: () => new Map([["1", { nickname: "Artist" }]]),
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
const member = {
  id: "member",
  crewId: "crew",
  userId: "1",
  status: "active",
  isOwner: true,
  version: 1,
  joinedAt: "2026-09-30T00:00:00Z",
  positions: [
    {
      id: "position",
      title: "Custom Role",
      categoryKey: null,
      isPrimary: true,
      sourcePositionId: null,
    },
  ],
  policyKeys: ["finance"],
};
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(
      <CrewMembers
        crewId="crew"
        userId="1"
        generation={1}
        onClose={h.close}
        onTransferComplete={h.close}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.read.mockResolvedValue({ items: [member], nextCursor: null, total: 1 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("renders member identity, ownership, positions and access policy", async () => {
  await render();
  expect(host.textContent).toContain("Artist");
  expect(host.textContent).toContain("Custom Role");
  expect(host.textContent).toContain("crewMembers.owner");
  expect(host.textContent).toContain("crewMembers.finance");
  expect(host.textContent).toContain("crewMembers.primary");
});
it("paginates without duplicate requests", async () => {
  h.read
    .mockResolvedValueOnce({ items: [member], nextCursor: "next", total: 2 })
    .mockResolvedValueOnce({
      items: [{ ...member, id: "two", userId: "2" }],
      nextCursor: null,
      total: 2,
    });
  await render();
  await act(async () => {
    button("crewAssets.more")!.click();
    button("crewAssets.more")!.click();
  });
  expect(h.read).toHaveBeenCalledTimes(2);
  expect(h.read.mock.calls[1]![3]).toBe("next");
  expect(button("crewAssets.more")).toBeUndefined();
});
it("clears private member data on a failed later page and restarts on refresh", async () => {
  h.read
    .mockResolvedValueOnce({ items: [member], nextCursor: "next", total: 2 })
    .mockRejectedValueOnce(new Error("Access revoked"))
    .mockResolvedValueOnce({ items: [], nextCursor: null, total: 0 });
  await render();
  await click("crewAssets.more");
  expect(host.textContent).not.toContain("Artist");
  expect(host.textContent).toContain("Access revoked");
  await click("thread.refresh");
  expect(h.read.mock.calls[2]![3]).toBeNull();
  expect(host.textContent).toContain("crewMembers.empty");
});
it("rejects duplicate members across pages", async () => {
  h.read.mockResolvedValue({ items: [member], nextCursor: "next", total: 2 });
  await render();
  await click("crewAssets.more");
  expect(host.textContent).toContain("Crew membership changed");
  expect(host.textContent).not.toContain("Artist");
});
it("ignores a late page after account change", async () => {
  let finish!: (v: unknown) => void;
  h.read.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => finish({ items: [member], nextCursor: null, total: 1 }));
  expect(host.textContent).not.toContain("Artist");
});
it("aborts the pending request on unmount", async () => {
  h.read.mockImplementation(() => new Promise(() => {}));
  await render();
  const signal = h.read.mock.calls[0]![4];
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("opens removal only for manageable non-owners and refreshes on return", async () => {
  h.read.mockResolvedValue({
    items: [{ ...member, isOwner: false }],
    nextCursor: null,
    total: 1,
    canManageMembers: true,
  });
  await render();
  await click("crewMembers.remove");
  await click("close removal");
  expect(h.read).toHaveBeenCalledTimes(2);
});
it("protects owners even when the viewer can manage members", async () => {
  h.read.mockResolvedValue({ items: [member], nextCursor: null, total: 1, canManageMembers: true });
  await render();
  expect(button("crewMembers.remove")).toBeUndefined();
});

it("edits positions including the owner and refreshes on return", async () => {
  h.read.mockResolvedValue({ items: [member], nextCursor: null, total: 1, canManageMembers: true });
  await render();
  await click("memberPositions.title");
  await click("close positions");
  expect(h.read).toHaveBeenCalledTimes(2);
});

it("opens access editing only with the specific permission and refreshes on return", async () => {
  h.read.mockResolvedValue({
    items: [{ ...member, isOwner: false }],
    nextCursor: null,
    total: 1,
    canManagePermissions: true,
  });
  await render();
  await click("memberAccess.title");
  await click("close access");
  expect(h.read).toHaveBeenCalledTimes(2);
});
it("hides access editing for ordinary managers and owners", async () => {
  h.read.mockResolvedValue({
    items: [member],
    nextCursor: null,
    total: 1,
    canManagePermissions: true,
    canManageMembers: true,
  });
  await render();
  expect(button("memberAccess.title")).toBeUndefined();
});

it("does not offer access editing with only member management", async () => {
  h.read.mockResolvedValue({
    items: [{ ...member, isOwner: false }],
    nextCursor: null,
    total: 1,
    canManagePermissions: false,
    canManageMembers: true,
  });
  await render();
  expect(button("memberAccess.title")).toBeUndefined();
  expect(button("memberPositions.title")).toBeDefined();
});

it("routes confirmed transfer out of the workspace", async () => {
  h.read.mockResolvedValue({
    items: [{ ...member, userId: "other", isOwner: false }],
    nextCursor: null,
    total: 1,
    canTransferOwnership: true,
  });
  await render();
  await click("crewTransfer.title");
  await click("complete transfer");
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("hides ownership transfer from ordinary managers", async () => {
  h.read.mockResolvedValue({
    items: [{ ...member, userId: "other", isOwner: false }],
    nextCursor: null,
    total: 1,
    canManageMembers: true,
  });
  await render();
  expect(button("crewTransfer.title")).toBeUndefined();
});
