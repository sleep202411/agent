import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelSubmissions } from "./channel-submissions";
vi.mock("./channel-videos", () => ({ ChannelVideos: () => null }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  signedIn: true,
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  login: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: h.signedIn ? "authenticated" : "anonymous" }),
  useAuthGate: () => ({ requireAuth: h.login }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post, patch: h.patch } }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const ip = "11111111-1111-4111-8111-111111111111",
  work = "22222222-2222-4222-8222-222222222222",
  cursor = "33333333-3333-4333-8333-333333333333";
const row = {
  workId: work,
  title: "A public film",
  roomNumber: "123456",
  status: "pending",
  version: 4,
};
const page = { community: true, open: true, canManage: true, items: [row], nextCursor: null };
const own = {
  id: work,
  title: "My eligible film",
  status: "published",
  listingVisibility: "public",
};
let root: Root, host: HTMLDivElement;
const render = (id = ip) => act(async () => root.render(<ChannelSubmissions ipId={id} />));
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = (text: string) => act(async () => button(text).click());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.generation = 1;
  h.active = true;
  h.signedIn = true;
  for (const mock of [h.get, h.post, h.patch, h.login, h.push]) mock.mockReset();
  h.get.mockImplementation(async (path) =>
    path === "/ip-commerce/me/ips" ? { items: [own], nextCursor: null } : page
  );
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("hides the section for ordinary IPs and makes no owner-directory request", async () => {
  h.get.mockResolvedValue({ community: false, open: false, canManage: false, items: [] });
  await render();
  expect(host.textContent).toBe("");
  expect(h.get).toHaveBeenCalledOnce();
});
it("shows public entries, opens their native IP route, and gates guest submissions", async () => {
  h.signedIn = false;
  h.get.mockResolvedValue({ ...page, canManage: false, items: [{ ...row, status: "approved" }] });
  await render();
  await click("A public film");
  expect(h.push).toHaveBeenCalledWith(`/ip/${work}`);
  expect(button("channelSubmissions.approve")).toBeUndefined();
  expect(button("channelSubmissions.close")).toBeUndefined();
  await click("channelSubmissions.submit");
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.post).not.toHaveBeenCalled();
  expect(h.get).toHaveBeenCalledOnce();
});
it("filters eligible works across pages and submits the selected work once", async () => {
  h.get.mockImplementation(async (path, options) => {
    if (path !== "/ip-commerce/me/ips") return { ...page, canManage: false, items: [] };
    if (options.params.cursor) return { items: [own], nextCursor: null };
    return {
      items: [
        { ...own, id: ip },
        { ...own, status: "scheduled" },
        { ...own, listingVisibility: "unlisted" },
      ],
      nextCursor: cursor,
    };
  });
  h.post.mockResolvedValue({ status: "pending" });
  await render();
  await click("channelSubmissions.submit");
  expect(host.textContent).toContain("channelSubmissions.noWorks");
  await click("channelSubmissions.more");
  await click("My eligible film");
  await click("channelSubmissions.send");
  expect(h.post).toHaveBeenCalledExactlyOnceWith(`/ip-commerce/ips/${ip}/submissions`, {
    service: "aurora",
    retry: false,
    data: { workId: work },
  });
  expect(host.textContent).not.toContain("channelSubmissions.choose");
});
it.each(["approved", "rejected"])(
  "reviews with the loaded version and preserves a server conflict",
  async (status) => {
    h.patch.mockRejectedValue(new Error("Submission changed. Refresh before reviewing."));
    await render();
    await click(status === "approved" ? "channelSubmissions.approve" : "channelSubmissions.reject");
    expect(h.patch).toHaveBeenCalledExactlyOnceWith(`/ip-commerce/ips/${ip}/submissions`, {
      service: "aurora",
      retry: false,
      data: { workId: work, status, expectedVersion: 4 },
    });
    expect(host.textContent).toContain("Submission changed. Refresh before reviewing.");
  }
);
it("opens and closes submissions through the owner settings endpoint", async () => {
  h.patch.mockResolvedValue({ open: false });
  await render();
  await click("channelSubmissions.close");
  expect(h.patch).toHaveBeenCalledWith(`/ip-commerce/ips/${ip}/submissions/settings`, {
    service: "aurora",
    retry: false,
    data: { open: false },
  });
});
it("does not repeat an accepted write when the follow-up read fails", async () => {
  await render();
  await click("channelSubmissions.submit");
  await click("My eligible film");
  h.post.mockResolvedValue({ status: "pending" });
  h.get.mockRejectedValue(new Error("Read unavailable"));
  await click("channelSubmissions.send");
  expect(host.textContent).toContain("Read unavailable");
  expect(button("channelSubmissions.close").disabled).toBe(true);
  h.get.mockResolvedValue(page);
  await click("channelSubmissions.refresh");
  expect(h.post).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("A public film");
});
it("retains an uncertain submission choice, reads the latest state, and never auto-resubmits", async () => {
  await render();
  await click("channelSubmissions.submit");
  await click("My eligible film");
  h.post.mockRejectedValue(new Error("Connection lost after submission"));
  await click("channelSubmissions.send");
  expect(host.textContent).toContain("Connection lost after submission");
  expect(host.textContent).toContain("channelSubmissions.choose");
  await click("channelSubmissions.refresh");
  expect(h.post).toHaveBeenCalledOnce();
});
it("keeps a pending write serialized across background and return", async () => {
  const pending = deferred<{ open: boolean }>();
  h.patch.mockReturnValue(pending.promise);
  await render();
  await click("channelSubmissions.close");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  await click("channelSubmissions.close");
  expect(h.patch).toHaveBeenCalledOnce();
  await act(async () => pending.resolve({ open: false }));
  expect(h.get).toHaveBeenCalledTimes(2);
  expect(button("channelSubmissions.close").disabled).toBe(false);
});
it("aborts old reads and does not expose an old account's management state", async () => {
  const old = deferred<typeof page>();
  h.get.mockReturnValueOnce(old.promise);
  await render();
  const signal = h.get.mock.calls[0][1].signal;
  h.generation++;
  h.signedIn = false;
  h.get.mockResolvedValue({ ...page, canManage: false, items: [] });
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(page));
  expect(button("channelSubmissions.close")).toBeUndefined();
  expect(host.textContent).not.toContain("A public film");
});
it("retains the first page when loading more fails and can retry the same cursor", async () => {
  h.get
    .mockResolvedValueOnce({ ...page, nextCursor: cursor })
    .mockRejectedValueOnce(new Error("Next page unavailable"))
    .mockResolvedValueOnce({ ...page, items: [], nextCursor: null });
  await render();
  await click("channelSubmissions.more");
  expect(host.textContent).toContain("A public film");
  expect(host.textContent).toContain("Next page unavailable");
  await click("channelSubmissions.more");
  expect(h.get.mock.calls[2][1].params.cursor).toBe(cursor);
  expect(host.textContent).toContain("A public film");
});
