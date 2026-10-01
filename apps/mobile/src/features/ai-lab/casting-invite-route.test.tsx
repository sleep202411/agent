import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CastingInviteScreen from "@/app/casting-invite";
const h = vi.hoisted(() => ({
  status: "anonymous",
  generation: 1,
  link: "",
  focused: true,
  login: vi.fn(),
  replace: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { userId: "actor" } }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/lib/navigation", () => ({ toHref: (s: string) => s }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ link: h.link }),
  useRouter: () => ({ replace: h.replace, canGoBack: () => false }),
  useFocusEffect: (fn: () => void) => {
    useEffect(() => {
      if (h.focused) fn();
    }, [fn]);
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ActivityIndicator: () => <span>Loading</span>,
  Linking: { openURL: h.open },
  TextInput: () => <input />,
}));
vi.mock("@/features/ai-lab/casting-accept-panel", () => ({
  CastingAcceptPanel: ({ token }: { token: string }) => <span>{token}</span>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<CastingInviteScreen />));
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "anonymous";
  h.generation = 1;
  h.focused = true;
  h.link = `https://studio.fizzdragon.com/casting/accept?token=${"a".repeat(32)}`;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("opens login once and resumes the same invitation after authentication", async () => {
  await render();
  await render();
  expect(h.login).toHaveBeenCalledTimes(1);
  const options = h.login.mock.calls[0][0];
  h.status = "authenticated";
  options.onAuthenticated();
  expect(h.replace).toHaveBeenCalledWith(`/casting-invite?link=${encodeURIComponent(h.link)}`);
  await render();
  expect(host.textContent).toBe("a".repeat(32));
});
it("rejects invalid or foreign-region links before prompting login", async () => {
  h.link = `https://studio.fizzspace.cn/casting/accept?token=${"a".repeat(32)}`;
  await render();
  expect(h.login).not.toHaveBeenCalled();
  expect(host.textContent).toContain("castingAccept.invalid");
});
it("replaces old invitation content when a new link arrives", async () => {
  h.status = "authenticated";
  await render();
  expect(host.textContent).toBe("a".repeat(32));
  h.link = `https://studio.fizzdragon.com/casting/accept?token=${"b".repeat(32)}`;
  await render();
  expect(host.textContent).toBe("b".repeat(32));
});
it("waits for hydration before prompting", async () => {
  h.status = "hydrating";
  await render();
  expect(h.login).not.toHaveBeenCalled();
  h.status = "anonymous";
  await render();
  expect(h.login).toHaveBeenCalledTimes(1);
});
