import { renderToString } from "react-dom/server";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CrewInviteScreen from "@/app/crew-invite";
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
  useAuth: () => ({ status: h.status, generation: h.generation }),
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
}));
vi.mock("@/features/services/crew-invite-accept", () => ({
  CrewInviteAccept: ({
    initialLink,
    onOpen,
  }: {
    initialLink: string;
    onOpen: (v: unknown) => void;
  }) => (
    <button
      onClick={() =>
        onOpen({
          scope: "crew",
          crewId: "11111111-1111-4111-8111-111111111111",
          targetName: "Team",
          memberId: "member1",
        })
      }
    >
      {initialLink}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<CrewInviteScreen />));
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "anonymous";
  h.generation = 1;
  h.focused = true;
  h.link = `https://fizzdragon.com/crew-invite/${"a".repeat(32)}`;
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
  expect(h.replace).toHaveBeenCalledWith(`/crew-invite?link=${encodeURIComponent(h.link)}`);
  await render();
  expect(host.textContent).toBe(h.link);
});
it("rejects invalid or foreign-region links before prompting login", async () => {
  h.link = `https://fizzdragon.fizzspace.cn/crew-invite/${"a".repeat(32)}`;
  await render();
  expect(h.login).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewJoin.invalidLink");
});
it("opens the accepted workspace natively and replaces old link content", async () => {
  h.status = "authenticated";
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.replace).toHaveBeenCalledWith("/crew-tasks/11111111-1111-4111-8111-111111111111");
  h.link = `https://fizzdragon.com/crew-invite/${"b".repeat(32)}`;
  await render();
  expect(host.textContent).toBe(h.link);
});
it("waits for hydration before prompting", async () => {
  h.status = "hydrating";
  await render();
  expect(h.login).not.toHaveBeenCalled();
  h.status = "anonymous";
  await render();
  expect(h.login).toHaveBeenCalledTimes(1);
});

it("renders a stable server shell without consuming query parameters or prompting login", () => {
  for (const link of [h.link, "invalid"]) {
    h.link = link;
    expect(renderToString(<CrewInviteScreen />)).toBe("<span>Loading</span>");
  }
  expect(h.login).not.toHaveBeenCalled();
});
