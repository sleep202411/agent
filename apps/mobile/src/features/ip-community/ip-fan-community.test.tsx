import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpFanCommunity } from "./ip-fan-community";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  join: vi.fn(),
  push: vi.fn(),
  login: vi.fn(),
  invalidate: vi.fn(),
  generation: 1,
  active: true,
  authenticated: true,
}));
vi.mock("./fan-community-api", () => ({ fetchIpFanCommunity: h.get, joinIpFanCommunity: h.join }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
  }),
  useAuthGate: () => ({ requireAuth: h.login }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: h.invalidate }));
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
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = (ipId = "ip") => act(async () => root.render(<IpFanCommunity ipId={ipId} />));
const click = (label = "ipDetail.joinFanGroup") =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === label)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.authenticated = true;
  h.get.mockResolvedValue({ id: "crew", name: "Film crew" });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("guests return to a freshly resolved link after login without joining silently", async () => {
  h.authenticated = false;
  await render();
  await act(async () => click());
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.join).not.toHaveBeenCalled();
  h.authenticated = true;
  h.generation++;
  h.get.mockResolvedValue({ id: "new-crew", name: "Updated" });
  await render();
  await act(async () => click());
  expect(h.join).toHaveBeenCalledExactlyOnceWith("new-crew");
  expect(h.push).toHaveBeenCalledWith("/crew-chat/new-crew?channel=community");
  expect(h.invalidate).toHaveBeenCalledOnce();
});
it("serializes joins, surfaces server errors and retries the same explicit action", async () => {
  await render();
  let reject!: (e: Error) => void;
  h.join.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  await act(async () => {
    click();
    click();
  });
  expect(h.join).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Community temporarily unavailable")));
  expect(host.textContent).toContain("Community temporarily unavailable");
  expect(h.push).not.toHaveBeenCalled();
  h.join.mockResolvedValue(undefined);
  await act(async () => click());
  expect(h.push).toHaveBeenCalledOnce();
});
it("has no entry for an unlinked IP, but a failed lookup has useful recovery", async () => {
  h.get.mockResolvedValue(null);
  await render();
  expect(host.textContent).toBe("");
  h.get.mockRejectedValueOnce(new Error("Origin unavailable"));
  await render("other");
  expect(host.textContent).toContain("Origin unavailable");
  h.get.mockResolvedValue({ id: "crew", name: "Film crew" });
  await act(async () => click("common.retry"));
  expect(host.textContent).toContain("ipDetail.joinFanGroup");
});
it("drops late navigation on blur and resolves changed links on return", async () => {
  await render();
  let resolve!: () => void;
  h.join.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await act(async () => click());
  h.active = false;
  await render();
  await act(async () => resolve());
  expect(h.push).not.toHaveBeenCalled();
  h.get.mockResolvedValue(null);
  h.active = true;
  await render();
  expect(host.textContent).toBe("");
});
it("aborts old lookups and cannot navigate using another viewer's late join", async () => {
  await render();
  const signal = h.get.mock.calls[0][1];
  let resolve!: () => void;
  h.join.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await act(async () => click());
  h.generation++;
  h.get.mockResolvedValue(null);
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve());
  expect(h.push).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
