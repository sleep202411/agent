import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Screen from "./[id]";
vi.mock("@/components/authed-web-view", () => ({ AuthedWebView: () => <span>Web</span> }));
const h = vi.hoisted(() => ({
  status: "authenticated",
  active: true,
  generation: 1,
  id: "crew",
  gate: vi.fn(),
  back: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { userId: "manager" } }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: h.id }),
  useRouter: () => ({ back: h.back }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ background: "black", text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/features/services/application-review", () => ({
  ApplicationReview: ({
    crewId,
    generation,
    onClose,
    onWeb,
  }: {
    crewId: string;
    generation: number;
    onClose: () => void;
    onWeb: () => void;
  }) => (
    <>
      <button onClick={onClose}>
        {crewId}:{generation}
      </button>
      <button aria-label="Web" onClick={onWeb} />
    </>
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
  await act(async () => root.render(<Screen />));
};
beforeEach(() => {
  vi.clearAllMocks();
  h.status = "authenticated";
  h.active = true;
  h.id = "crew";
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("gates anonymous access", async () => {
  h.status = "anonymous";
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.gate).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("crew:");
});
it("waits for hydration", async () => {
  h.status = "hydrating";
  await render();
  expect(host.textContent).toBe("loading");
});
it("hides private content while inactive", async () => {
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
});
it("scopes the screen and returns to Crew", async () => {
  await render();
  expect(host.textContent).toBe("crew:1");
  await act(async () => host.querySelector("button")!.click());
  expect(h.back).toHaveBeenCalledOnce();
  h.generation = 2;
  await render();
  expect(host.textContent).toBe("crew:2");
});

it("resets the Web workflow on account change", async () => {
  await render();
  await act(async () => (host.querySelector('[aria-label="Web"]') as HTMLButtonElement).click());
  expect(host.textContent).toContain("Web");
  h.generation = 2;
  await render();
  expect(host.textContent).toBe("crew:2");
});
