import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpContributorsPanel } from "./contributors-panel";
const h = vi.hoisted(() => ({
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
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
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
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
const id = "11111111-1111-4111-8111-111111111111",
  memberId = "22222222-2222-4222-8222-222222222222";
const member = {
  id: memberId,
  displayName: "Original",
  userId: "123",
  role: "writer",
  customRole: null,
  revenueEligible: true,
  revenueShareBps: 3000,
  displayOrder: 0,
};
const snapshot = {
  ip: { id, title: "Story" },
  creatorShareBps: 4000,
  poolAllocatedBps: 3000,
  contributors: [member],
};
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpContributorsPanel ipId={id} userId="alice" generation={1} />));
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
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  h.get.mockResolvedValue(snapshot);
  h.patch.mockResolvedValue({ ...member, displayName: "Edited" });
  h.post.mockResolvedValue({
    ...member,
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "New credit",
    userId: null,
    revenueEligible: false,
    revenueShareBps: null,
  });
  h.del.mockResolvedValue({ removed: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("edits a credit without changing its existing account and share", async () => {
  await mount();
  expect(host.textContent).toContain("Original");
  await click("ipContributors.edit");
  await type("ipContributors.displayName", "Edited");
  await click("ipContributors.save");
  expect(h.patch).toHaveBeenCalledWith(
    expect.stringContaining(memberId),
    expect.objectContaining({
      data: expect.objectContaining({
        displayName: "Edited",
        userId: "123",
        revenueShareBps: 3000,
      }),
    })
  );
  expect(host.textContent).toContain("ipContributors.saved");
});
it("creates a credit-only member, requiring a name and not inventing an account", async () => {
  await mount();
  await click("ipContributors.add");
  expect(button("ipContributors.save").disabled).toBe(true);
  expect(button("☐ ipContributors.eligible").disabled).toBe(true);
  await type("ipContributors.displayName", "New credit");
  await click("ipContributors.save");
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("contributors"),
    expect.objectContaining({
      data: expect.objectContaining({
        displayName: "New credit",
        userId: null,
        revenueEligible: false,
        revenueShareBps: null,
      }),
    })
  );
});
it("requires confirmation for removal and can cancel", async () => {
  await mount();
  await click("ipContributors.remove");
  expect(h.del).not.toHaveBeenCalled();
  await click("common.cancel");
  expect(h.del).not.toHaveBeenCalled();
  await click("ipContributors.remove");
  await click("ipContributors.confirmRemove");
  expect(h.del).toHaveBeenCalledTimes(1);
});
it("blocks invalid shares and total allocation above 100%", async () => {
  h.get.mockResolvedValue({
    ...snapshot,
    poolAllocatedBps: 9000,
    contributors: [
      member,
      { ...member, id: "33333333-3333-4333-8333-333333333333", revenueShareBps: 6000 },
    ],
  });
  await mount();
  await click("ipContributors.edit");
  await type("ipContributors.share", "50");
  expect(button("ipContributors.save").disabled).toBe(true);
  await type("ipContributors.share", "1e2");
  expect(button("ipContributors.save").disabled).toBe(true);
  await type("ipContributors.share", "40");
  expect(button("ipContributors.save").disabled).toBe(false);
});
it("preserves an unresolved creation after remount and requires a fresh list plus confirmation to clear", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await mount();
  await click("ipContributors.add");
  await type("ipContributors.displayName", "New credit");
  await click("ipContributors.save");
  expect(host.textContent).toContain("ipContributors.pending");
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  expect(button("ipContributors.add").disabled).toBe(true);
  expect(button("ipContributors.reviewed").disabled).toBe(true);
  await click("thread.refresh");
  await click("ipContributors.reviewed");
  expect(host.textContent).toContain("ipContributors.resolveHint");
  await click("ipContributors.confirmResolve");
  expect(button("ipContributors.add").disabled).toBe(false);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("does not replay a successful write when its follow-up refresh fails", async () => {
  await mount();
  await click("ipContributors.edit");
  await type("ipContributors.displayName", "Edited");
  h.get.mockResolvedValueOnce(snapshot).mockRejectedValue(new Error("Refresh offline"));
  await click("ipContributors.save");
  expect(host.textContent).toContain("ipContributors.saved");
  expect(host.textContent).toContain("Refresh offline");
  expect(host.textContent).not.toContain("ipContributors.pending");
  expect(h.patch).toHaveBeenCalledTimes(1);
});
it("hides private contributors when the screen is inactive or its auth generation changes", async () => {
  await mount();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
it("hides loaded private content when refresh reports loss of access", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  await mount();
  h.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "No access", 403));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Original");
  expect(host.textContent).toContain("No access");
});

it("retains an unsaved credit across backgrounding without changing account or share", async () => {
  await mount();
  await click("ipContributors.edit");
  await type("ipContributors.displayName", "Edited");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  await mount();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipContributors.displayName"]')?.value
  ).toBe("Edited");
  expect(h.patch).not.toHaveBeenCalled();
  await click("ipContributors.save");
  expect(h.patch).toHaveBeenCalledOnce();
  expect(h.patch.mock.calls[0][1].data).toMatchObject({
    displayName: "Edited",
    userId: "123",
    revenueShareBps: 3000,
  });
});
it("does not save retained edits after permission is revoked in background", async () => {
  await mount();
  await click("ipContributors.edit");
  await type("ipContributors.displayName", "Edited");
  h.active = false;
  await mount();
  const { ApiRequestError } = await import("@/lib/api-client");
  h.get.mockRejectedValue(new ApiRequestError("DENIED", "Access removed", 403));
  h.active = true;
  await mount();
  await click("ipContributors.save");
  expect(h.patch).not.toHaveBeenCalled();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("Access removed");
});
it("retires unsent credit edits on route exit", async () => {
  await mount();
  await click("ipContributors.edit");
  await type("ipContributors.displayName", "Unsent");
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(host.querySelector("input")).toBeNull();
  expect(h.patch).not.toHaveBeenCalled();
});
