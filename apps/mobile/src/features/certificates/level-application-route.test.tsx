import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CertificationApplicationScreen from "@/app/certification-application";
const h = vi.hoisted(() => ({
  level: "13" as string | undefined,
  status: "anonymous",
  focused: true,
  login: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ level: h.level }),
  useRouter: () => ({ replace: h.replace, back: h.back, push: h.push }),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: 1, user: { userId: "actor" } }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/lib/navigation", () => ({ toHref: (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("@/features/certificates/level-application", () => ({
  LevelApplicationForm: ({
    lockedLevelId,
    userId,
    onClose,
  }: {
    lockedLevelId?: number;
    userId: string;
    onClose: () => void;
  }) => (
    <button onClick={onClose}>
      {lockedLevelId ?? "all"}:{userId}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<CertificationApplicationScreen />));
beforeEach(() => {
  vi.resetAllMocks();
  h.level = "13";
  h.status = "anonymous";
  h.focused = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("renders a stable server shell without trusting query parameters", () => {
  expect(renderToString(<CertificationApplicationScreen />)).toBe("<span>Loading</span>");
});
it("continues login back to the requested certification", async () => {
  await render();
  expect(host.textContent).toContain("auth.signIn");
  await act(async () => [...host.querySelectorAll("button")].at(-1)!.click());
  h.login.mock.calls[0][0].onAuthenticated();
  expect(h.replace).toHaveBeenCalledWith("/certification-application?level=13");
});
it("rejects invalid certification parameters before asking for login", async () => {
  h.level = "../other";
  await render();
  expect(host.textContent).toContain("levelApplication.unavailable");
  expect(h.login).not.toHaveBeenCalled();
});
it("opens the account-scoped form and returns to its originating screen", async () => {
  h.status = "authenticated";
  await render();
  expect(host.textContent).toContain("13:actor");
  await act(async () => [...host.querySelectorAll("button")].at(-1)!.click());
  expect(h.back).toHaveBeenCalledOnce();
});
it("opens the general certification selector when no level is locked", async () => {
  h.status = "authenticated";
  h.level = undefined;
  await render();
  expect(host.textContent).toContain("all:actor");
});

it("links certification guidance to native Academy", async () => {
  h.status = "authenticated";
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.push).toHaveBeenCalledWith("/courses");
});
