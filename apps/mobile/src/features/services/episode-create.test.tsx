import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpisodeCreate } from "./episode-create";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), create: vi.fn(), close: vi.fn() }));
vi.mock("./episode-create-api", async (original) => ({
  ...(await original<typeof import("./episode-create-api")>()),
  fetchEpisodeCreateAccess: h.access,
  createEpisode: h.create,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = () =>
  act(async () =>
    root.render(<EpisodeCreate crewId="crew" userId="user" generation={1} onClose={h.close} />)
  );
async function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue(true);
  h.create.mockResolvedValue({ number: 1, title: "Pilot" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("prevents empty titles then creates exactly once with a valid title", async () => {
  await render();
  expect(button("episodeCreate.confirm").disabled).toBe(true);
  await enter("episodeCreate.name", "Pilot");
  expect(button("episodeCreate.confirm").disabled).toBe(false);
  await act(async () => {
    button("episodeCreate.confirm").click();
    button("episodeCreate.confirm").click();
  });
  expect(h.create).toHaveBeenCalledExactlyOnceWith("crew", "user", 1, {
    title: "Pilot",
    synopsis: "",
  });
  expect(host.textContent).toContain("episodeCreate.created");
});
it("freezes a failed request instead of allowing a duplicate episode", async () => {
  h.create.mockRejectedValue(new Error("Response lost"));
  await render();
  await enter("episodeCreate.name", "Pilot");
  await act(async () => button("episodeCreate.confirm").click());
  expect(host.textContent).toContain("episodeCreate.uncertain");
  expect(button("episodeCreate.confirm").disabled).toBe(true);
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("does not render creation fields without production permission", async () => {
  h.access.mockResolvedValue(false);
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("episodeCreate.denied");
});
it("blocks a stale account's submit", async () => {
  await render();
  await enter("episodeCreate.name", "Pilot");
  h.generation = 2;
  await act(async () => button("episodeCreate.confirm").click());
  expect(h.create).not.toHaveBeenCalled();
});
