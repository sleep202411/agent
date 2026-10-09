import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CrewInviteLinksScreen from "@/app/crew-invite-links";
const h = vi.hoisted(() => ({
  crewId: "crew",
  status: "anonymous",
  focused: true,
  login: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ crewId: h.crewId }),
  useRouter: () => ({ replace: h.replace }),
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
vi.mock("@/features/services/crew-invite-links", () => ({
  CrewInviteLinks: ({
    crewId,
    userId,
    onClose,
  }: {
    crewId: string;
    userId: string;
    onClose: () => void;
  }) => (
    <button onClick={onClose}>
      {crewId}:{userId}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<CrewInviteLinksScreen />));
beforeEach(() => {
  vi.resetAllMocks();
  h.crewId = "crew";
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
  expect(renderToString(<CrewInviteLinksScreen />)).toBe("<span>Loading</span>");
});
it("continues login back to the exact Crew", async () => {
  await render();
  expect(host.textContent).toBe("auth.signIn");
  await act(async () => host.querySelector("button")!.click());
  h.login.mock.calls[0][0].onAuthenticated();
  expect(h.replace).toHaveBeenCalledWith("/crew-invite-links?crewId=crew");
});
it("rejects invalid Crew identity before asking for login", async () => {
  h.crewId = "../other";
  await render();
  expect(host.textContent).toBe("crewLinks.invalidCrew");
  expect(h.login).not.toHaveBeenCalled();
});
it("opens the account-scoped manager and returns to Members", async () => {
  h.status = "authenticated";
  await render();
  expect(host.textContent).toBe("crew:actor");
  await act(async () => host.querySelector("button")!.click());
  expect(h.replace).toHaveBeenCalledWith("/crew-tasks/crew?section=members");
});
it("hides private link management when navigation loses focus", async () => {
  h.status = "authenticated";
  h.focused = false;
  await render();
  expect(host.textContent).toBe("");
});
