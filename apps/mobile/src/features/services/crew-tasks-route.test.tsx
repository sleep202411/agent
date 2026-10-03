import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CrewChatScreen from "@/app/crew-chat/[id]";
import CrewTasksScreen from "@/app/crew-tasks/[id]";
const h = vi.hoisted(() => ({
  focused: true,
  active: true,
  generation: 1,
  status: "authenticated",
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ id: "crew" }),
  useRouter: () => ({ back: vi.fn() }),
  Stack: { Screen: () => null },
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { id: "user" } }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/features/services/crew-chat", () => ({
  CrewChat: () => <input defaultValue="chat draft" />,
}));
vi.mock("@/features/services/crew-task-browser", () => ({
  CrewTaskBrowser: () => <input aria-label="pending upload" defaultValue="" />,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<CrewTasksScreen />));
beforeEach(() => {
  h.focused = true;
  h.active = true;
  h.generation = 1;
  h.status = "authenticated";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("retains the current task/upload view across file-picker background transitions", async () => {
  await render();
  const input = host.querySelector("input")!;
  input.value = "selected file";
  h.active = false;
  await render();
  expect(host.querySelector("input")).toBe(input);
  h.active = true;
  await render();
  expect(host.querySelector("input")?.value).toBe("selected file");
});
it("retires task state when navigation focus or the account changes", async () => {
  await render();
  const input = host.querySelector("input")!;
  h.generation = 2;
  await render();
  expect(host.querySelector("input")).not.toBe(input);
  h.focused = false;
  await render();
  expect(host.querySelector("input")).toBeNull();
  h.focused = true;
  h.status = "anonymous";
  await render();
  expect(host.querySelector("input")).toBeNull();
});

it("keeps the Crew chat route mounted during native picker handoff but clears it on blur", async () => {
  const renderChat = () => act(async () => root.render(<CrewChatScreen />));
  await renderChat();
  const input = host.querySelector("input")!;
  h.active = false;
  await renderChat();
  expect(host.querySelector("input")).toBe(input);
  h.focused = false;
  await renderChat();
  expect(host.querySelector("input")).toBeNull();
});
