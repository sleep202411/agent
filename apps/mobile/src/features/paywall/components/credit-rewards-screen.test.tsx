import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreditRewardsScreen } from "./credit-rewards-screen";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  authenticated: true,
  get: vi.fn(),
  post: vi.fn(),
  login: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: String(h.generation) },
  }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (_: string, user: string) => ({
    read: () => h.records.get(user) ?? null,
    write: (v: string) => h.records.set(user, v),
  }),
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => (k: string) => k }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: () => null,
}));
const id = "00000000-0000-4000-8000-000000000001";
const campaign = {
  id,
  name: "Creator reward",
  description: null,
  endsAt: null,
  computeCreditAmount: 10,
  claimed: false,
};
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <CreditRewardsScreen />
      </StrictMode>
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.authenticated = true;
  h.records.clear();
  h.get.mockImplementation(async (path: string) =>
    path.includes("campaigns") ? { items: [campaign] } : { accounts: [] }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("does not read or claim rewards for a guest", async () => {
  h.authenticated = false;
  await render();
  expect(h.get).not.toHaveBeenCalled();
  await act(async () => button("login.signIn").click());
  expect(h.login).toHaveBeenCalledOnce();
});
it("keeps pending confirmation visible after blur and return", async () => {
  let finish!: (v: unknown) => void;
  h.post.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await render();
  await act(async () => {
    button("creditRewards.claim").click();
    button("creditRewards.claim").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  const signal = h.post.mock.calls[0][1].signal as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({
      granted: {
        grantType: "compute_credits",
        currency: "compute_point",
        amount: "10",
        workspaceId: id,
      },
      alreadyClaimed: false,
    })
  );
  h.active = true;
  await render();
  expect(host.textContent).toContain("creditRewards.pending");
  expect(button("creditRewards.claim").disabled).toBe(true);
});
it("does not leak a previous account's pending reward or success into its replacement", async () => {
  let finish!: (v: unknown) => void;
  h.post.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await render();
  await act(async () => button("creditRewards.claim").click());
  h.generation = 2;
  await render();
  await act(async () =>
    finish({
      granted: {
        grantType: "compute_credits",
        currency: "compute_point",
        amount: "10",
        workspaceId: id,
      },
      alreadyClaimed: false,
    })
  );
  expect(host.textContent).not.toContain("creditRewards.success");
  expect(host.textContent).not.toContain("creditRewards.pending");
  expect(h.records.get("1")).toContain(id);
  expect(h.records.has("2")).toBe(false);
});
