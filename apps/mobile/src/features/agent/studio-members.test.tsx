import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StudioMembers } from "./studio-members";
import { StudioMemberWriteError } from "./api/studio-members-api";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  list: vi.fn(),
  change: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./api/studio-members-api", async (original) => ({
  ...(await original<typeof import("./api/studio-members-api")>()),
  fetchStudioMembers: h.list,
  changeStudioMember: h.change,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
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
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} onChange={(e) => onChangeText(e.target.value)} disabled={!editable} />,
}));
const scope = {
  kind: "workspace" as const,
  id: "11111111-1111-4111-8111-111111111111",
  name: "Team",
};
const member = {
  memberId: scope.id,
  userId: "2",
  nickname: "Artist",
  role: "viewer",
  status: "active",
  accessScope: "workspace",
  isOwner: false,
  isSelf: false,
};
const data = { members: [member], canAdd: true, canEdit: true, canRemove: true };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () => root.render(<StudioMembers scope={scope} generation={1} onClose={h.close} />));
const button = (s: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === s);
const click = (s: string) => act(async () => button(s)!.click());
const input = (value: string) =>
  act(async () => {
    const el = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.list.mockResolvedValue(data);
  h.change.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows roster but no mutations for viewers", async () => {
  h.list.mockResolvedValue({ ...data, canAdd: false, canEdit: false, canRemove: false });
  await render();
  expect(host.textContent).toContain("Artist");
  expect(button("studioMembers.add")).toBeUndefined();
  expect(button("studioMembers.edit")).toBeUndefined();
  expect(button("studioMembers.remove")).toBeUndefined();
});
it("reviews contact and role before adding and prevents duplicate taps", async () => {
  await render();
  await input("a@b.com");
  await click("studioMembers.add");
  expect(h.change).not.toHaveBeenCalled();
  expect(host.textContent).toContain("a@b.com");
  await act(async () => {
    button("studioMembers.confirm")!.click();
    button("studioMembers.confirm")!.click();
  });
  expect(h.change).toHaveBeenCalledTimes(1);
  expect(h.change).toHaveBeenCalledWith(
    scope,
    1,
    { kind: "add", account: "a@b.com", role: "viewer" },
    expect.any(AbortSignal)
  );
});
it("explains retained access before removal", async () => {
  await render();
  await click("studioMembers.remove");
  expect(host.textContent).toContain("studioMembers.removeWorkspace");
  expect(h.change).not.toHaveBeenCalled();
  await click("studioMembers.confirm");
  expect(h.change).toHaveBeenCalledWith(
    scope,
    1,
    { kind: "remove", member },
    expect.any(AbortSignal)
  );
});
it("protects owner and project-only rows from removal", async () => {
  h.list.mockResolvedValue({
    ...data,
    members: [
      { ...member, role: "owner", isOwner: true },
      { ...member, memberId: "other", accessScope: "project_only" },
    ],
  });
  await render();
  expect(button("studioMembers.remove")).toBeUndefined();
  await click("studioMembers.edit");
  expect(host.textContent).toContain("studioMembers.promote");
});
it("requires refreshed review after an uncertain write", async () => {
  h.change.mockRejectedValue(new StudioMemberWriteError("Lost response"));
  await render();
  await click("studioMembers.remove");
  await click("studioMembers.confirm");
  expect(button("studioMembers.confirm")!.disabled).toBe(true);
  expect(button("studioMembers.reviewed")!.disabled).toBe(true);
  await click("thread.refresh");
  await click("studioMembers.reviewed");
  expect(button("studioMembers.remove")!.disabled).toBe(false);
});
it("clears private rows on background and account change", async () => {
  await render();
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(host.textContent).toContain("Artist");
  h.generation++;
  await render();
  expect(host.textContent).toBe("");
});
it("reviews a selected role change before submitting", async () => {
  await render();
  await click("studioMembers.edit");
  await click("studioInvites.editor");
  await click("studioMembers.save");
  expect(h.change).not.toHaveBeenCalled();
  await click("studioMembers.confirm");
  expect(h.change).toHaveBeenCalledWith(
    scope,
    1,
    { kind: "role", member, role: "editor" },
    expect.any(AbortSignal)
  );
});
