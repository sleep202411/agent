import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpisodeManagement } from "./episode-management";
vi.mock("./episode-delivery", () => ({ EpisodeDelivery: () => <span>episode delivery</span> }));
vi.mock("./episode-organization", () => ({
  EpisodeOrganization: () => <span>organize episodes</span>,
}));
const h = vi.hoisted(() => ({
  generation: 1,
  access: vi.fn(),
  rows: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./episode-create-api", () => ({ fetchEpisodeCreateAccess: h.access }));
vi.mock("./episode-create", () => ({
  EpisodeCreate: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close create</button>
  ),
}));
vi.mock("./episode-management-api", async (original) => ({
  ...(await original<typeof import("./episode-management-api")>()),
  fetchCrewEpisodes: h.rows,
  updateEpisodeMetadata: h.update,
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
    root.render(<EpisodeManagement crewId="crew" userId="user" generation={1} onClose={h.close} />)
  );
async function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const episode = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  number: 1,
  title: "Pilot",
  synopsis: "",
  status: "completed",
  version: 4,
  durationSeconds: 30,
  plannedReleaseAt: "2026-10-01T10:10:10.123Z",
  taskProgress: { completed: 4, total: 6, pendingReview: 2 },
};
async function edit() {
  await render();
  await act(async () => button("episodeManagement.edit").click());
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue(true);
  h.rows.mockResolvedValue([episode]);
  h.update.mockResolvedValue({ ...episode, version: 5 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("shows approved and pending-review counts for completed episodes", async () => {
  await render();
  expect(host.textContent).toContain("4/6");
  expect(host.textContent).toContain("episodeManagement.pending");
  expect(host.textContent).toContain("episodeManagement.status_completed");
});
it("keeps the list readable without offering editing to viewers", async () => {
  h.access.mockResolvedValue(false);
  await render();
  expect(host.textContent).toContain("Pilot");
  expect(button("episodeManagement.edit")).toBeUndefined();
  expect(button("episodeCreate.title")).toBeUndefined();
});
it("saves only edited metadata and preserves timestamp precision", async () => {
  await edit();
  expect(button("episodeManagement.save").disabled).toBe(true);
  await enter("episodeCreate.name", "New Pilot");
  await act(async () => {
    button("episodeManagement.save").click();
    button("episodeManagement.save").click();
  });
  expect(h.update).toHaveBeenCalledExactlyOnceWith(
    episode,
    {
      expectedVersion: 4,
      title: "New Pilot",
      synopsis: "",
      number: 1,
      durationSeconds: 30,
      plannedReleaseAt: episode.plannedReleaseAt,
    },
    1
  );
  expect(host.textContent).toContain("episodeManagement.saved");
});
it("blocks invalid calendar dates", async () => {
  await edit();
  await enter("episodeManagement.release", "2026-02-30 10:00");
  expect(button("episodeManagement.save").disabled).toBe(true);
});
it("requires a list refresh after an uncertain/conflicting update", async () => {
  h.update.mockRejectedValue(new Error("Version conflict"));
  await edit();
  await enter("episodeCreate.name", "New Pilot");
  await act(async () => button("episodeManagement.save").click());
  expect(host.textContent).toContain("Version conflict");
  expect(button("episodeManagement.save").disabled).toBe(true);
  await act(async () => button("episodeManagement.back").click());
  expect(h.rows).toHaveBeenCalledTimes(2);
});
it("returns from native creation to a refreshed episode list", async () => {
  await render();
  await act(async () => button("episodeCreate.title").click());
  await act(async () => button("close create").click());
  expect(h.rows).toHaveBeenCalledTimes(2);
});
it("does not write after the account changes", async () => {
  await edit();
  await enter("episodeCreate.name", "New Pilot");
  h.generation = 2;
  await act(async () => button("episodeManagement.save").click());
  expect(h.update).not.toHaveBeenCalled();
});

it("opens delivery history for viewers without metadata editing rights", async () => {
  h.access.mockResolvedValue(false);
  await render();
  await act(async () => button("episodeDelivery.title").click());
  expect(host.textContent).toContain("episode delivery");
});

it("opens organization for production managers", async () => {
  await render();
  await act(async () => button("episodeOrganization.title").click());
  expect(host.textContent).toContain("organize episodes");
});
