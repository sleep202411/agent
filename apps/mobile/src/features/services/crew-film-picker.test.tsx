import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewFilmPicker } from "./crew-film-picker";
const h = vi.hoisted(() => ({
  generation: 1,
  fetch: vi.fn(),
  stage: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
}));
vi.mock("./crew-film-api", () => ({ loadCrewFilms: h.fetch, createCrewFilm: h.create }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const workspace = "11111111-1111-4111-8111-111111111111";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = async (label: string) => act(async () => button(label).click());
beforeEach(async () => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue({
    workspaceId: workspace,
    projects: [{ id: "existing", title: "Existing Film" }],
  });
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(<CrewFilmPicker crewId="crew" generation={1} disabled={false} onSelect={h.stage} />)
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function title() {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "New Film"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("selects an existing film without a write", async () => {
  await click("canvasImport.chooseFilm");
  await click("Existing Film");
  expect(h.stage).toHaveBeenCalledWith("existing");
  expect(h.create).not.toHaveBeenCalled();
});
it("creates once and opens the returned native project", async () => {
  await click("canvasImport.chooseFilm");
  await title();
  h.create.mockResolvedValue({ id: "new-film" });
  await act(async () => {
    button("canvasImport.createFilm").click();
    button("canvasImport.createFilm").click();
  });
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(h.stage).toHaveBeenCalledWith("new-film");
  await click("canvasImport.openFilm");
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/agent/[projectId]",
    params: { projectId: "new-film" },
  });
});
it("retains a failed creation warning without offering a duplicate write", async () => {
  await click("canvasImport.chooseFilm");
  await title();
  h.create.mockRejectedValue(new Error("Connection lost"));
  await click("canvasImport.createFilm");
  expect(host.textContent).toContain("canvasImport.checkCreation");
  expect(button("canvasImport.createFilm")).toBeUndefined();
  await click("canvasImport.chooseFilm");
  expect(button("canvasImport.createFilm")).toBeUndefined();
});
it("aborts the pending list and ignores its result after unmount", async () => {
  let finish!: (v: unknown) => void;
  h.fetch.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await click("canvasImport.chooseFilm");
  const signal = h.fetch.mock.calls[0][2] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ workspaceId: workspace, projects: [] }));
  expect(h.stage).not.toHaveBeenCalled();
});
