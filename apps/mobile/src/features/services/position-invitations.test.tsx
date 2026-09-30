import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PositionInvitations } from "./position-invitations";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
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
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  positionId: "position",
  inviteeUserId: "creator",
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  applicationId: null,
  expired: false,
  position: {
    id: "position",
    crewId: "crew",
    taskId: null,
    positionType: "Director",
    description: "Create film",
    experienceLevel: "any",
    requiredSkills: ["Editing"],
  },
};
const application = {
  id: "application",
  crewId: "crew",
  positionId: "position",
  applicantId: "creator",
  status: "pending",
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async () => {
  await act(async () =>
    root.render(<PositionInvitations userId="creator" generation={1} onClose={h.close} />)
  );
};
const open = async () => {
  await render();
  await act(async () => host.querySelector("button")!.click());
};
const type = async (key: string, value: string) => {
  await act(async () => {
    const input = host.querySelector(`[aria-label="${key}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path) =>
    path === "/crew-position-invitations" ? { items: [row], nextCursor: null } : row
  );
  h.post.mockResolvedValue(application);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows role details before acceptance", async () => {
  await open();
  expect(host.textContent).toContain("Director");
  expect(host.textContent).toContain("Editing");
  expect(h.post).not.toHaveBeenCalled();
});
it("accepts with optional message and portfolio then shows application explanation", async () => {
  await open();
  await type("crewPositionInvites.message", "Hello");
  await type("crewPositionInvites.portfolio", "https://example.com/work");
  await click("crewPositionInvites.accept");
  expect(h.post).toHaveBeenCalledWith(`/crew-position-invitations/${row.id}/accept`, {
    service: "aurora",
    data: { message: "Hello", portfolioUrl: "https://example.com/work" },
  });
  expect(host.textContent).toContain("crewPositionInvites.acceptedHelp");
  expect(button("crewPositionInvites.accept")).toBeUndefined();
});
it("declines without sending draft application fields", async () => {
  h.post.mockResolvedValue({ id: row.id, status: "declined" });
  await open();
  await type("crewPositionInvites.message", "Draft");
  await click("crewPositionInvites.decline");
  expect(h.post).toHaveBeenCalledWith(`/crew-position-invitations/${row.id}/decline`, {
    service: "aurora",
  });
  expect(button("crewPositionInvites.accept")).toBeUndefined();
});
it("rejects unsafe portfolio before sending", async () => {
  await open();
  await type("crewPositionInvites.portfolio", "javascript:alert(1)");
  await click("crewPositionInvites.accept");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewPositionInvites.invalidPortfolio");
});
it("retries the same response after ambiguous failure", async () => {
  h.post.mockRejectedValueOnce(new Error("Network"));
  await open();
  await type("crewPositionInvites.message", "Hello");
  await click("crewPositionInvites.accept");
  const original = h.post.mock.calls[0];
  expect(button("crewPositionInvites.refresh").disabled).toBe(true);
  expect(host.querySelector("textarea")).toBeNull();
  await click("crewPositionInvites.retry");
  expect(h.post.mock.calls[1]).toEqual(original);
});
it("requires refresh after definitive rejection", async () => {
  h.post.mockRejectedValueOnce(Object.assign(new Error("Closed"), { status: 409 }));
  await open();
  await click("crewPositionInvites.accept");
  expect(button("crewPositionInvites.accept").disabled).toBe(true);
  expect(button("crewPositionInvites.retry")).toBeUndefined();
  await click("crewPositionInvites.refresh");
  expect(button("crewPositionInvites.accept").disabled).toBe(false);
});
it("hides actions on expired invitations", async () => {
  h.get.mockImplementation(async (path) =>
    path === "/crew-position-invitations"
      ? { items: [row], nextCursor: null }
      : { ...row, expired: true }
  );
  await open();
  expect(button("crewPositionInvites.accept")).toBeUndefined();
  expect(host.textContent).toContain("crewPositionInvites.expired");
});
it("blocks repeated taps while pending", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await open();
  await act(async () => {
    button("crewPositionInvites.accept").click();
    button("crewPositionInvites.accept").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("nativeApplications.back").disabled).toBe(true);
  await act(async () => resolve(application));
});
it("does not write after account change", async () => {
  await open();
  h.generation = 2;
  await click("crewPositionInvites.accept");
  expect(h.post).not.toHaveBeenCalled();
});
it("ignores late result after leaving", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await open();
  await click("crewPositionInvites.accept");
  await act(async () => root.render(null));
  await act(async () => resolve(application));
  expect(host.textContent).toBe("");
});
it("paginates inbox with server cursor", async () => {
  h.get
    .mockResolvedValueOnce({ items: [row], nextCursor: row.id })
    .mockResolvedValue({ items: [], nextCursor: null });
  await render();
  await click("crewPositionInvites.more");
  expect(h.get).toHaveBeenLastCalledWith(
    "/crew-position-invitations",
    expect.objectContaining({ params: { limit: 20, cursor: row.id } })
  );
  expect(host.textContent).toContain("crewPositionInvites.empty");
});
it("expires an open preview and clears its clock on exit", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    h.get.mockImplementation(async (path) =>
      path === "/crew-position-invitations"
        ? { items: [row], nextCursor: null }
        : { ...row, expiresAt: "2026-10-01T00:00:01Z" }
    );
    await open();
    expect(button("crewPositionInvites.accept")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button("crewPositionInvites.accept")).toBeUndefined();
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
