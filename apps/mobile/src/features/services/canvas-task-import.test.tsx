import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasTaskImport } from "./canvas-task-import";
const h = vi.hoisted(() => ({ generation: 1, fetch: vi.fn(), stage: vi.fn(), close: vi.fn() }));
vi.mock("./canvas-task-import-api", async (original) => ({
  ...(await original<typeof import("./canvas-task-import-api")>()),
  fetchCanvasTaskPreview: h.fetch,
}));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
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
const id = "11111111-1111-4111-8111-111111111111";
const preview = {
  crewId: "crew",
  projectId: id,
  title: "Story",
  sourceRevision: 4,
  sourceHash: "a".repeat(64),
  plotTree: { nodes: [{ id: "scene", type: "scene", content: { title: "Opening" } }] },
};
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const render = () =>
  act(async () =>
    root.render(
      <CanvasTaskImport crewId="crew" generation={1} onClose={h.close} onStage={h.stage} />
    )
  );
const change = (value: string) =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue(preview);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("reviews scenes then stages without applying, and clears stale preview when the link changes", async () => {
  await render();
  await change(`https://studio.fizzdragon.com/story-studio/projects/${id}/canvas`);
  await act(async () => button("canvasImport.preview").click());
  expect(host.textContent).toContain("Opening");
  expect(h.stage).not.toHaveBeenCalled();
  await act(async () => button("canvasImport.stage").click());
  expect(h.stage).toHaveBeenCalledWith(preview);
  await change("invalid");
  expect(host.textContent).not.toContain("Opening");
  await act(async () => button("canvasImport.preview").click());
  expect(host.textContent).toContain("canvasImport.invalidLink");
  expect(h.fetch).toHaveBeenCalledTimes(1);
});
it("discards late preview after sign-out", async () => {
  let resolve!: (v: unknown) => void;
  h.fetch.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await change(`https://studio.fizzdragon.com/story-studio/projects/${id}/canvas`);
  await act(async () => button("canvasImport.preview").click());
  h.generation++;
  await act(async () => resolve(preview));
  await render();
  expect(host.textContent).toBe("");
  expect(h.stage).not.toHaveBeenCalled();
});
it("does not allow staging an empty canvas", async () => {
  h.fetch.mockResolvedValue({ ...preview, plotTree: { nodes: [] } });
  await render();
  await change(`https://studio.fizzdragon.com/story-studio/projects/${id}/canvas`);
  await act(async () => button("canvasImport.preview").click());
  expect(button("canvasImport.stage").disabled).toBe(true);
});
