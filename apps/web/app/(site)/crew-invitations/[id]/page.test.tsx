import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CrewInvitationPage from "./page";

const state = vi.hoisted(() => ({ userId: null as string | null, loading: false, login: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({
    user: state.userId ? { id: state.userId } : null,
    isLoading: state.loading,
  }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.login }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "invite-1" }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useMyCrewInvitation: () => ({ data: undefined, isLoading: false, isError: false }),
  useAcceptCrewInvitation: () => ({ isPending: false }),
  useDeclineCrewInvitation: () => ({ isPending: false }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function render() {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<CrewInvitationPage />));
}
afterEach(() => {
  act(() => root?.unmount());
  state.userId = null;
  state.loading = false;
  vi.clearAllMocks();
});
it("offers in-place sign-in instead of reporting an invitation missing", () => {
  render();
  expect(container.textContent).toContain("signInRequired");
  expect(container.textContent).not.toContain("notFoundTitle");
  const button = container.querySelector("button");
  expect(button?.textContent).toBe("signIn");
  act(() => button!.click());
  expect(state.login).toHaveBeenCalledOnce();
});
it("waits for the account check before showing an invitation error", () => {
  state.loading = true;
  render();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.textContent).not.toContain("notFoundTitle");
  expect(container.querySelector("button")).toBeNull();
});
it("retains the missing-invitation state for signed-in recipients", () => {
  state.userId = "alice";
  render();
  expect(container.textContent).toContain("notFoundTitle");
  expect(container.textContent).not.toContain("signInRequired");
});
