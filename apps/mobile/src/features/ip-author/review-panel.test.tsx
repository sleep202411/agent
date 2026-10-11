import type { ReviewSnapshot } from "./review-api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpReviewPanel } from "./review-panel";
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
  key: 10,
  open: vi.fn(),
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
  uuid: { v4: () => `00000000-0000-4000-8000-${String(++h.key).padStart(12, "0")}` },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
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

const id = "11111111-1111-4111-8111-111111111111";
let snapshot: ReviewSnapshot, root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpReviewPanel ipId={id} userId="alice" generation={1} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  snapshot = {
    id,
    version: 1,
    sourceLocale: "en-US",
    title: "Story",
    summary: "Summary",
    status: "draft",
    listingVisibility: "private",
    genreCodes: ["drama"],
    coverAsset: { id },
    trailerAsset: null,
    copyrightOwner: "Alice",
    rightsSummary: { statement: "Original" },
    aiDisclosure: null,
  };
  h.get.mockImplementation(async () => ({ ip: snapshot }));
  h.post.mockImplementation(async () => {
    snapshot = { ...snapshot, version: 2, status: "submitted", listingVisibility: "private" };
    return { ip: snapshot };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows missing requirements and links to each editor", async () => {
  snapshot.summary = "";
  snapshot.coverAsset = null;
  await mount();
  expect(host.textContent).toContain("○ ipReview.require_summary");
  expect(button("ipReview.submit").disabled).toBe(true);
  await click("ipReview.editProfile");
  expect(h.push).toHaveBeenLastCalledWith(`/ip-studio/${id}`);
  await click("ipReview.editMedia");
  expect(h.push).toHaveBeenLastCalledWith(`/ip-studio/${id}/media`);
  await click("ipReview.editRights");
  expect(h.push).toHaveBeenLastCalledWith(`/ip-studio/${id}/rights`);
});
it("requires confirmation and shows submitted status only after a valid receipt", async () => {
  await mount();
  await click("ipReview.submit");
  expect(h.post).not.toHaveBeenCalled();
  await click("common.cancel");
  await click("ipReview.submit");
  await click("ipReview.confirmSubmit");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipReview.saved");
  expect(host.textContent).toContain("ipReview.status: ipReview.submitted");
  expect(button("ipReview.submit")).toBeUndefined();
});
it("preserves uncertain submissions after remount and requires explicit reviewed cleanup", async () => {
  h.post.mockImplementationOnce(async () => {
    snapshot = { ...snapshot, version: 2, status: "submitted" };
    throw Error("Lost response");
  });
  await mount();
  await click("ipReview.submit");
  await click("ipReview.confirmSubmit");
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  await click("common.retry");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain("ipReview.saved");
  expect(button("ipReview.checked")).toBeUndefined();
  await click("thread.refresh");
  await click("ipReview.checked");
  await click("ipReview.confirmClear");
  expect(host.textContent).not.toContain("ipReview.pending");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("freezes the original change summary while a request is pending", async () => {
  h.post.mockRejectedValueOnce(new Error("Offline"));
  await mount();
  await click("ipReview.submit");
  await click("ipReview.confirmSubmit");
  expect(host.querySelector<HTMLInputElement>("input")!.readOnly).toBe(true);
  await click("common.retry");
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
});
it("clears private readiness after access loss or inactivity", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  await mount();
  h.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "Access removed", 403));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Story");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
});

const enterSummary = async () =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="ipReview.summary"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Revised story and credits"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
it("retains the unsent summary while backgrounded and still requires confirmation", async () => {
  await mount();
  await enterSummary();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  await mount();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipReview.summary"]')?.value).toBe(
    "Revised story and credits"
  );
  expect(h.post).not.toHaveBeenCalled();
  await click("ipReview.submit");
  expect(h.post).not.toHaveBeenCalled();
  await click("ipReview.confirmSubmit");
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.post.mock.calls[0][1].data.changeSummary).toBe("Revised story and credits");
});
it("rechecks review eligibility after returning from background", async () => {
  await mount();
  await enterSummary();
  h.active = false;
  await mount();
  snapshot = { ...snapshot, status: "published", version: 2 };
  h.active = true;
  await mount();
  await click("ipReview.submit");
  await click("ipReview.confirmSubmit");
  expect(h.post).not.toHaveBeenCalled();
});
it("retires unsent summary when the route is left", async () => {
  await mount();
  await enterSummary();
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipReview.summary"]')?.value
  ).not.toBe("Revised story and credits");
  expect(h.post).not.toHaveBeenCalled();
});
