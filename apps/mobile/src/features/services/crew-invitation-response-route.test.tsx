import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CrewInvitationResponseScreen from "@/app/crew-invitation-response/[id]";
const h = vi.hoisted(() => ({
  id: "abcdef12-3456-4789-8abc-123456789abc" as string | string[],
  status: "anonymous",
  focused: true,
  login: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ id: h.id }),
  useRouter: () => ({ replace: h.replace, back: h.back }),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: 1, user: { userId: "actor" } }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.focused }));
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
vi.mock("@/features/services/crew-invitation-response", () => ({
  CrewInvitationResponse: ({
    invitationId,
    userId,
    onOpenCrew,
  }: {
    invitationId: string;
    userId: string;
    onOpenCrew: (crewId: string) => void;
  }) => (
    <button onClick={() => onOpenCrew("crew")}>
      {invitationId ?? "all"}:{userId}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<CrewInvitationResponseScreen />));
beforeEach(() => {
  vi.resetAllMocks();
  h.id = "abcdef12-3456-4789-8abc-123456789abc";
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
  expect(renderToString(<CrewInvitationResponseScreen />)).toBe("<span>Loading</span>");
});
it("continues login back to the exact invitation", async () => {
  await render();
  expect(host.textContent).toBe("auth.signIn");
  await act(async () => host.querySelector("button")!.click());
  h.login.mock.calls[0][0].onAuthenticated();
  expect(h.replace).toHaveBeenCalledWith(
    "/crew-invitation-response/abcdef12-3456-4789-8abc-123456789abc"
  );
});
it("rejects invalid invitation identity before asking for login", async () => {
  h.id = "../other";
  await render();
  expect(host.textContent).toBe("crewInvitations.notFoundBody");
  expect(h.login).not.toHaveBeenCalled();
});
it("opens the account-scoped invitation and navigates to its Crew", async () => {
  h.status = "authenticated";
  await render();
  expect(host.textContent).toBe("abcdef12-3456-4789-8abc-123456789abc:actor");
  await act(async () => host.querySelector("button")!.click());
  expect(h.replace).toHaveBeenCalledWith("/crew-tasks/crew");
});
it("does not render private invitations without active screen focus", async () => {
  h.status = "authenticated";
  h.focused = false;
  await render();
  expect(host.textContent).toBe("");
});
it("rejects repeated ID parameters before login", async () => {
  h.id = ["abcdef12-3456-4789-8abc-123456789abc", "other"];
  await render();
  expect(host.textContent).toBe("crewInvitations.notFoundBody");
  expect(h.login).not.toHaveBeenCalled();
});
it("normalizes uppercase UUIDs before fetching the invitation", async () => {
  h.status = "authenticated";
  h.id = "ABCDEF12-3456-4789-8ABC-123456789ABC";
  await render();
  expect(host.textContent).toBe("abcdef12-3456-4789-8abc-123456789abc:actor");
});
