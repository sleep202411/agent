import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewLinkIp } from "./crew-link-ip";
const h = vi.hoisted(() => ({
  status: "authenticated",
  generation: 1,
  access: vi.fn(),
  ips: vi.fn(),
  push: vi.fn(),
  retry: vi.fn(),
  more: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { userId: "actor" } }),
}));
vi.mock("./crew-linked-resources-api", () => ({ fetchCrewIpLinkAccess: h.access }));
vi.mock("@/features/profile/use-my-ips", () => ({ useMyIps: h.ips }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/navigation", () => ({ toHref: (s: string) => s }));
vi.mock("@/lib/api-client", () => ({ ApiRequestError: class extends Error {} }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "span" }));
vi.mock("react-native", () => ({
  View: "div",
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<CrewLinkIp crewId="production-crew" />));
const click = (label: string) =>
  act(async () => {
    const b = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
    expect(b).toBeTruthy();
    b!.click();
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "authenticated";
  h.generation = 1;
  h.access.mockResolvedValue(true);
  h.ips.mockReturnValue({
    items: [{ id: "ip", title: "My Film" }],
    loading: false,
    hasMore: true,
    retry: h.retry,
    loadMore: h.more,
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(async () => root.unmount()));
it("loads owned choices only on intent and routes the exact Crew into the existing editor", async () => {
  await render();
  expect(h.ips).not.toHaveBeenCalled();
  await click("crewLinks.linkIp");
  expect(h.ips).toHaveBeenCalledWith("actor:1");
  await click("crewLinks.more");
  expect(h.more).toHaveBeenCalledTimes(1);
  await click("My Film");
  expect(h.push).toHaveBeenCalledWith("/ip-studio/ip/rights?kind=crew&crewId=production-crew");
});
it("does not load choices for guests or members without management access", async () => {
  h.status = "anonymous";
  await render();
  expect(h.access).not.toHaveBeenCalled();
  h.status = "authenticated";
  h.access.mockResolvedValue(false);
  await render();
  expect(host.querySelector("button")).toBeNull();
  expect(h.ips).not.toHaveBeenCalled();
});
it("reports a failed access check and permits explicit retry", async () => {
  h.access.mockRejectedValueOnce(new Error("Network unavailable"));
  await render();
  expect(host.textContent).toContain("Network unavailable");
  await click("thread.refresh");
  await click("crewLinks.linkIp");
  expect(host.textContent).toContain("My Film");
});
it("does not carry an open picker into a changed account session", async () => {
  await render();
  await click("crewLinks.linkIp");
  h.generation = 2;
  await render();
  expect(host.textContent).not.toContain("My Film");
  await click("crewLinks.linkIp");
  expect(h.ips).toHaveBeenCalledWith("actor:2");
});
