import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewLinkedResources } from "./crew-linked-resources";
const h = vi.hoisted(() => ({
  status: "authenticated",
  generation: 1,
  active: true,
  ips: vi.fn(),
  workspace: vi.fn(),
  films: vi.fn(),
}));
vi.mock("./crew-linked-resources-api", () => ({
  fetchLinkedIps: h.ips,
  fetchLinkedWorkspace: h.workspace,
  fetchLinkedFilms: h.films,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/navigation", () => ({ toHref: (p: string) => p }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = () => act(async () => root.render(<CrewLinkedResources crewId="crew" />));
const click = (name: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === name)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "authenticated";
  h.generation = 1;
  h.active = true;
  h.ips.mockResolvedValue([{ id: "ip" }]);
  h.workspace.mockResolvedValue({ id: "ws", name: "Studio" });
  h.films.mockResolvedValue({ items: [{ id: "film", title: "Film" }], nextCursor: null });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("loads only when expanded and stops after collapse", async () => {
  await render();
  expect(h.ips).not.toHaveBeenCalled();
  await click("crewLinks.title");
  expect(host.textContent).toContain("Film");
  const signal = h.films.mock.calls[0]![4];
  await click("crewLinks.title");
  expect(signal.aborted).toBe(true);
});
it("guests read linked IPs without private workspace requests", async () => {
  h.status = "anonymous";
  await render();
  await click("crewLinks.title");
  expect(h.ips).toHaveBeenCalledTimes(1);
  expect(h.workspace).not.toHaveBeenCalled();
  expect(h.films).not.toHaveBeenCalled();
});
it("does not list workspace films when the IP link is ambiguous", async () => {
  h.ips.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  await render();
  await click("crewLinks.title");
  expect(h.films).not.toHaveBeenCalled();
});
it("clears resources and aborts pending reads when backgrounded", async () => {
  await render();
  await click("crewLinks.title");
  const signal = h.ips.mock.calls[0]![2];
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Film");
});
it("keeps public IPs usable when workspace access fails", async () => {
  h.workspace.mockRejectedValue(new Error("Access denied"));
  await render();
  await click("crewLinks.title");
  expect(host.textContent).toContain("crewLinks.openIp");
  expect(host.textContent).toContain("Access denied");
  expect(h.films).not.toHaveBeenCalled();
});
