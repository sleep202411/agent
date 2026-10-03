import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpAccessPanel } from "./access-panel";
const h = vi.hoisted(() => ({
  signedIn: true,
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  push: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, patch: h.patch, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000004" },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({
    children,
    style,
  }: {
    children: ReactNode;
    style?: { display?: "none" | "flex" };
  }) => <div style={{ display: style?.display }}>{children}</div>,
  ActivityIndicator: () => null,
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
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      readOnly={!editable}
      aria-label={accessibilityLabel}
    />
  ),
}));

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: h.push }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => (
      <>{options.headerRight?.()}</>
    ),
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.signedIn ? "authenticated" : "anonymous",
    user: { userId: "alice" },
    generation: 1,
  }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/features/ip-author/contributors-panel", () => ({ IpContributorsPanel: () => null }));
const id = "11111111-1111-4111-8111-111111111111",
  grantId = "22222222-2222-4222-8222-222222222222";
const owner = {
  id,
  title: "Story",
  createdById: "alice",
  version: 1,
  viewerAccess: { owner: true, canEdit: true, canManageAcl: true, canTransferOwner: true },
};
const editor = {
  ...owner,
  createdById: "456",
  version: 2,
  viewerAccess: { owner: false, canEdit: true, canManageAcl: false, canTransferOwner: false },
};
const grant = {
  id: grantId,
  ipId: id,
  userId: "456",
  permission: "edit",
  grantedById: "alice",
  revokedById: null,
  revokedAt: null,
  createdAt: "2026-10-01T01:00:00Z",
  updatedAt: "2026-10-01T01:00:00Z",
};
function readProfile(ip = owner, grants = [grant]) {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/acl")
      ? { ownerUserId: ip.createdById, grants }
      : path.endsWith("/search")
        ? { users: [{ userId: "789", nickname: "Artist", avatar: null }] }
        : { ip }
  );
}
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpAccessPanel ipId={id} userId="alice" generation={1} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const type = (label: string, value: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.active = true;
  h.focused = true;
  h.signedIn = true;
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  readProfile();
  h.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/transfer-owner")) {
      readProfile(editor);
      return { ipId: id, previousOwnerId: "alice", newOwnerId: "456", oldOwnerKept: true };
    }
    return { grant: { ...grant, id: "33333333-3333-4333-8333-333333333333", userId: "789" } };
  });
  h.del.mockResolvedValue({
    grant: { ...grant, revokedAt: "2026-10-01T02:00:00Z", revokedById: "alice" },
    revoked: true,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("shows editor role without owner-only endpoints or mutation controls", async () => {
  readProfile(editor);
  await mount();
  expect(host.textContent).toContain("ipAccess.editorHint");
  expect(button("ipAccess.grant")).toBeUndefined();
  expect(button("ipAccess.transfer")).toBeUndefined();
  expect(h.get).toHaveBeenCalledTimes(1);
});
it("looks up and selects an account before granting edit permission", async () => {
  vi.useFakeTimers();
  await mount();
  expect(button("ipAccess.confirmGrant").disabled).toBe(true);
  await type("ipContributors.lookup", "artist@example.com");
  await act(async () => vi.advanceTimersByTimeAsync(401));
  await click("Artist · 789");
  await click("ipAccess.confirmGrant");
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("/acl"),
    expect.objectContaining({ data: { userId: "789", permission: "edit" } })
  );
  expect(host.textContent).toContain("ipAccess.saved");
});
it("requires explicit confirmation before revocation and permits cancellation", async () => {
  await mount();
  await click("ipAccess.revoke");
  expect(h.del).not.toHaveBeenCalled();
  await click("common.cancel");
  expect(h.del).not.toHaveBeenCalled();
  await click("ipAccess.revoke");
  await click("ipAccess.confirmRevoke");
  expect(h.del).toHaveBeenCalledTimes(1);
});
it("confirms transfer to the chosen editor, keeps old owner by default and removes owner controls afterwards", async () => {
  await mount();
  await click("ipAccess.transfer");
  expect(h.post).not.toHaveBeenCalled();
  expect(button("☐ ipAccess.removeSelf")).toBeDefined();
  await click("ipAccess.confirmTransfer");
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("/transfer-owner"),
    expect.objectContaining({
      data: { toUserId: "456", removeOldOwner: false, expectedVersion: 1 },
    })
  );
  expect(host.textContent).toContain("ipAccess.transferred");
  expect(host.textContent).toContain("ipAccess.editorHint");
  expect(button("ipAccess.transfer")).toBeUndefined();
});
it("sends self-removal only when selected and handles a confirmed receipt without requiring lost access", async () => {
  h.post.mockResolvedValue({
    ipId: id,
    previousOwnerId: "alice",
    newOwnerId: "456",
    oldOwnerKept: false,
  });
  await mount();
  await click("ipAccess.transfer");
  await click("☐ ipAccess.removeSelf");
  await click("ipAccess.confirmTransfer");
  expect(h.post).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ data: expect.objectContaining({ removeOldOwner: true }) })
  );
  expect(host.textContent).toContain("ipAccess.left");
  expect(host.textContent).toContain("ipAccess.transferred");
  expect(button("ipAccess.transfer")).toBeUndefined();
});
it("recovers lost transfer response after remount without repeating POST", async () => {
  h.post.mockImplementation(async () => {
    readProfile(editor);
    throw new Error("Lost reply");
  });
  await mount();
  await click("ipAccess.transfer");
  await click("ipAccess.confirmTransfer");
  expect(host.textContent).toContain("ipAccess.pending");
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  await click("ipAccess.retry");
  expect(host.textContent).toContain("ipAccess.observed");
  expect(host.textContent).not.toContain("ipAccess.pending");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("never treats a 404 after a lost self-removal transfer as success; explicit acknowledgement only clears local intent", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  h.post.mockImplementation(async () => {
    h.get.mockRejectedValue(new ApiRequestError("IP_NOT_FOUND", "IP not found", 404));
    throw new Error("Lost reply");
  });
  await mount();
  await click("ipAccess.transfer");
  await click("☐ ipAccess.removeSelf");
  await click("ipAccess.confirmTransfer");
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  expect(host.textContent).toContain("ipAccess.unavailable");
  expect(host.textContent).not.toContain("ipAccess.transferred");
  expect(button("ipAccess.retry").disabled).toBe(true);
  expect(button("ipAccess.reviewed").disabled).toBe(true);
  await click("thread.refresh");
  await click("ipAccess.reviewed");
  expect(host.textContent).toContain("ipAccess.resolveHint");
  await click("ipAccess.confirmResolve");
  expect(host.textContent).not.toContain("ipAccess.pending");
  expect(host.textContent).not.toContain("ipAccess.transferred");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("keeps owner changes locked after an unknown grant receipt and hides private data on access loss", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  h.del.mockRejectedValue(new Error("Lost reply"));
  await mount();
  await click("ipAccess.revoke");
  await click("ipAccess.confirmRevoke");
  expect(button("ipAccess.transfer").disabled).toBe(true);
  h.get.mockRejectedValue(new ApiRequestError("IP_NOT_FOUND", "IP not found", 404));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Story");
  expect(button("ipAccess.retry").disabled).toBe(true);
});
it("ignores stale confirmations when transfer permission changes before submission", async () => {
  await mount();
  await click("ipAccess.transfer");
  readProfile(editor);
  await click("ipAccess.confirmTransfer");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Only the IP owner");
  expect(host.textContent).not.toContain("Story");
});
it("hides private access data while inactive and after auth changes", async () => {
  await mount();
  h.active = false;
  await mount();
  expect((host.firstElementChild as HTMLElement).style.display).toBe("none");
  h.active = true;
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});

it("opens editing access from the contributors header only for authenticated users", async () => {
  const { default: Route } = await import("@/app/ip-studio/[id]/contributors");
  await act(async () => root.render(<Route />));
  await click("ipAccess.heading");
  expect(h.push).toHaveBeenCalledWith(`/ip-studio/${id}/access`);
  h.signedIn = false;
  await act(async () => root.render(<Route />));
  expect(button("ipAccess.heading")).toBeUndefined();
});

it("retains the lookup query and selected account through background without granting access", async () => {
  vi.useFakeTimers();
  await mount();
  await type("ipContributors.lookup", "artist@example.com");
  h.active = false;
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(401));
  h.active = true;
  await mount();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipContributors.lookup"]')?.value
  ).toBe("artist@example.com");
  await act(async () => vi.advanceTimersByTimeAsync(401));
  await click("Artist · 789");
  h.active = false;
  await mount();
  expect(button("ipAccess.confirmGrant").disabled).toBe(true);
  h.active = true;
  await mount();
  expect(host.textContent).toContain("Artist · 789");
  expect(h.post).not.toHaveBeenCalled();
  await click("ipAccess.confirmGrant");
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("/acl"),
    expect.objectContaining({ data: { userId: "789", permission: "edit" } })
  );
});
it("retains transfer confirmation through background but still checks current ownership", async () => {
  await mount();
  await click("ipAccess.transfer");
  await click("☐ ipAccess.removeSelf");
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(button("☑ ipAccess.removeSelf")).toBeDefined();
  expect(h.post).not.toHaveBeenCalled();
  readProfile(editor);
  await click("ipAccess.confirmTransfer");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Only the IP owner");
});
it("retires unsent confirmation when leaving the route", async () => {
  await mount();
  await click("ipAccess.transfer");
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(button("ipAccess.confirmTransfer")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
});
