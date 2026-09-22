import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  path: "/en-US/profile",
  user: null as null | { id: string },
  open: vi.fn(),
  router: { replace: vi.fn() },
  loading: false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => state.router,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useUserInfo: () => ({ data: state.user, isLoading: state.loading, isFetched: !state.loading }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => "en-US" }));
vi.mock("@/src/lib/auth/native-shell", () => ({ isNativeShell: () => false }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.open }),
}));
import { AuthGate } from "./auth-gate";
let root: Root;
let container: HTMLDivElement;
function render(path = state.path) {
  state.path = path;
  act(() =>
    root.render(
      <AuthGate>
        <span>Page</span>
      </AuthGate>
    )
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.path = "/en-US/profile";
  state.user = null;
  state.loading = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it("prompts again when returning through a public page after session expiry", () => {
  render();
  expect(state.open).toHaveBeenCalledTimes(1);
  render("/en-US/news");
  expect(state.open).toHaveBeenCalledTimes(1);
  render("/en-US/profile");
  expect(state.open).toHaveBeenCalledTimes(2);
});
it("does not reopen the dialog on repeated renders of the same protected visit", () => {
  render();
  render();
  render();
  expect(state.open).toHaveBeenCalledTimes(1);
});
it("waits for user loading and allows a subsequent expiry after sign-in", () => {
  state.loading = true;
  render();
  expect(state.open).not.toHaveBeenCalled();
  state.loading = false;
  render();
  expect(state.open).toHaveBeenCalledTimes(1);
  state.user = { id: "user" };
  render();
  expect(state.open).toHaveBeenCalledTimes(1);
  state.user = null;
  render();
  expect(state.open).toHaveBeenCalledTimes(2);
});
it("prompts separately on another protected route", () => {
  render();
  render("/en-US/crews");
  expect(state.open).toHaveBeenCalledTimes(2);
});
