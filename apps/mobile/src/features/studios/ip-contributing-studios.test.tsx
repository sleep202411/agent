import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpContributingStudios } from "./ip-contributing-studios";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  push: vi.fn(),
  login: vi.fn(),
  active: true,
  generation: 1,
  viewer: false,
}));
vi.mock("./ip-studios-api", () => ({ fetchIpStudios: h.fetch }));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "request" } }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    generation: h.generation,
    status: h.viewer ? "authenticated" : "anonymous",
    user: { userId: "viewer" },
  }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ brand: "red", backgroundElement: "black" }),
}));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/navigation", () => ({ toHref: (path: string) => path }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const item = (id: string) => ({
  studio: {
    id,
    name: `Studio ${id}`,
    serviceCount: 2,
    basedIn: { city: "Singapore" },
    remote: true,
  },
  roles: [{ role: "director", customRole: null }],
});
const page = { items: [item("one")], nextCursor: null, requiresLogin: false };
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = async (id = "ip") => {
  await act(async () => root.render(<IpContributingStudios ipId={id} />));
};
const click = async (label: string) => {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
};
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.viewer = false;
  h.fetch.mockResolvedValue(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("shows contributor identity/roles with native profile and selected-studio links", async () => {
  await render();
  expect(host.textContent).toContain("contentGpsDiscovery.contributorRoles.director");
  expect(host.textContent).toContain("contentGpsDiscovery.studioBasedIn");
  await click("Studio one");
  expect(h.push).toHaveBeenLastCalledWith("/creator/one");
  await click("contentGpsDiscovery.studioServices");
  expect(h.push).toHaveBeenLastCalledWith("/creator/one?section=services");
  await click("contentGpsDiscovery.studioDiscovery");
  expect(h.push).toHaveBeenLastCalledWith("/studios?selected=one");
});
it("accumulates valid pages and rejects overlapping relationships", async () => {
  h.fetch
    .mockResolvedValueOnce({ ...page, nextCursor: { afterId: "one", queryId: "q" } })
    .mockResolvedValueOnce({
      ...page,
      items: [item("two")],
      nextCursor: { afterId: "two", queryId: "q" },
    })
    .mockResolvedValue(page);
  await render();
  await click("contentGpsDiscovery.studiosMore");
  expect(host.textContent).toContain("Studio one");
  expect(host.textContent).toContain("Studio two");
  await click("contentGpsDiscovery.studiosMore");
  expect(host.textContent).not.toContain("Studio one");
  expect(host.textContent).not.toContain("Studio two");
  expect(host.textContent).toContain("contentGpsDiscovery.responseMismatch");
});
it("offers login in place at the guest limit", async () => {
  h.fetch.mockResolvedValue({ ...page, requiresLogin: true });
  await render();
  await click("contentGpsDiscovery.studiosLogin");
  expect(h.login).toHaveBeenCalledOnce();
});
it("hides relationships during periodic permission recheck and after failure", async () => {
  vi.useFakeTimers();
  await render();
  let reject!: (reason: Error) => void;
  h.fetch.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(host.textContent).not.toContain("Studio one");
  await act(async () => reject(new Error("IP not found")));
  expect(host.textContent).toContain("IP not found");
  h.fetch.mockResolvedValue({ ...page, items: [] });
  await click("contentGpsDiscovery.retry");
  expect(host.textContent).toContain("contentGpsDiscovery.studiosEmpty");
});
it("aborts requests and removes old relationships when backgrounded or the account changes", async () => {
  await render();
  const signal = h.fetch.mock.calls[0][5];
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toBe("");
  h.active = true;
  h.viewer = true;
  h.generation = 2;
  h.fetch.mockResolvedValue({ ...page, items: [] });
  await render();
  expect(h.fetch).toHaveBeenLastCalledWith(
    { generation: 2, viewerId: "viewer" },
    "ip",
    "en-US",
    null,
    "request",
    expect.any(AbortSignal)
  );
  expect(host.textContent).not.toContain("Studio one");
});
it("ignores a late response after switching IP", async () => {
  let resolve!: (value: unknown) => void;
  h.fetch
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    )
    .mockResolvedValue({ ...page, items: [] });
  await render();
  await render("other");
  await act(async () => resolve(page));
  expect(host.textContent).not.toContain("Studio one");
});
