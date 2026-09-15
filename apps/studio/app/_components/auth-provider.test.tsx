// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-provider";
const state = vi.hoisted(() => ({ logout: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  logout: state.logout,
  getAuthUser: state.getAuthUser,
  isAuthUnavailableError: () => false,
}));
vi.mock("./login-dialog", () => ({ LoginDialog: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  vi.resetAllMocks();
});
it("clears the user immediately and cannot erase replacement authentication on late logout completion", async () => {
  let finish!: () => void;
  state.logout.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["fizzstudio", "auth", "me"];
  client.setQueryData(key, { id: "alice" });
  root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof useAuth>;
  function Probe() {
    current = useAuth();
    return null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>
    )
  );
  const originalCheck = current.isCurrentAccount;
  expect(originalCheck("alice")).toBe(true);
  let pending!: Promise<void>;
  await act(async () => {
    pending = current.signOut();
  });
  expect(client.getQueryData(key)).toBeNull();
  expect(originalCheck("alice")).toBe(false);
  expect(state.getAuthUser).not.toHaveBeenCalled();
  await act(async () => {
    client.setQueryData(key, { id: "bob" });
    finish();
    await pending;
  });
  expect(client.getQueryData(key)).toEqual({ id: "bob" });
  expect(originalCheck("alice")).toBe(false);
  expect(originalCheck("bob")).toBe(true);
});
