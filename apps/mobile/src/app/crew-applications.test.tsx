import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CrewApplicationsScreen from "./crew-applications";
const h = vi.hoisted(() => ({ status: "authenticated", generation: 1, gate: vi.fn() }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { userId: "creator" } }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ background: "black", text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <span>Web: {path}</span>,
}));
vi.mock("@/features/services/crew-applications", () => ({
  CrewApplications: ({
    userId,
    generation,
    onWeb,
  }: {
    userId: string;
    generation: number;
    onWeb: () => void;
  }) => (
    <button onClick={onWeb}>
      Native: {userId} {generation}
    </button>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = async () => {
  await act(async () => root.render(<CrewApplicationsScreen />));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "authenticated";
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("defers private applications to the existing authentication gate", async () => {
  h.status = "anonymous";
  await render();
  expect(host.textContent).not.toContain("Native:");
  await act(async () => host.querySelector("button")!.click());
  expect(h.gate).toHaveBeenCalledTimes(1);
});
it("waits for account hydration", async () => {
  h.status = "hydrating";
  await render();
  expect(host.textContent).toBe("loading");
});
it("opens remaining Web workflows and returns to native applications", async () => {
  await render();
  expect(host.textContent).toContain("Native: creator 1");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Web: /crews/applications");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Native: creator 1");
});
it("resets the Web session when the account generation changes", async () => {
  await render();
  await act(async () => host.querySelector("button")!.click());
  h.generation = 2;
  await render();
  expect(host.textContent).toContain("Native: creator 2");
  expect(host.textContent).not.toContain("Web:");
});
