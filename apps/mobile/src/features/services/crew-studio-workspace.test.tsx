import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewStudioWorkspace } from "./crew-studio-workspace";
const h = vi.hoisted(() => ({
  generation: 1,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./crew-studio-workspace-api", async (original) => ({
  ...(await original<typeof import("./crew-studio-workspace-api")>()),
  fetchCrewStudioWorkspace: h.list,
  initializeCrewStudioWorkspace: h.create,
  linkCrewStudioWorkspace: h.update,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
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
    onChangeText: (v: string) => void;
    editable: boolean;
  }) => <input disabled={!editable} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const workspace = { id: "00000000-0000-4000-8000-000000000001", name: "Studio One" };
const label = { crewId: "crew", workspace: null, legacyProject: null, options: [workspace] };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(async () => button(text)!.click());
const render = () =>
  act(async () =>
    root.render(<CrewStudioWorkspace crewId="crew" userId="1" generation={1} onClose={h.close} />)
  );
const type = (index: number, value: string) =>
  act(async () => {
    const input = host.querySelectorAll("input")[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.list.mockResolvedValue(label);
  h.create.mockResolvedValue(label);
  h.update.mockResolvedValue(label);
  h.remove.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("withholds controls when access fails and allows a fresh read", async () => {
  h.list.mockRejectedValue(new Error("Administrator required"));
  await render();
  expect(button("crewStudio.link")).toBeUndefined();
  expect(host.textContent).toContain("Administrator required");
  h.list.mockResolvedValue(label);
  await click("thread.refresh");
  expect(button("crewStudio.link")).toBeTruthy();
});
it("requires selection and explicit link confirmation", async () => {
  await render();
  expect(button("crewStudio.link")?.disabled).toBe(true);
  await click("Studio One");
  await click("crewStudio.link");
  expect(h.update).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewStudio.linkHelp");
  await click("crewStudio.confirmLink");
  expect(h.update).toHaveBeenCalledWith(label, "1", 1, workspace.id);
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("resets confirmation when selecting a different workspace", async () => {
  const next = { ...workspace, id: "00000000-0000-4000-8000-000000000002", name: "Studio Two" };
  h.list.mockResolvedValue({ ...label, options: [workspace, next] });
  await render();
  await click("Studio One");
  await click("crewStudio.link");
  await click("Studio Two");
  expect(button("crewStudio.confirmLink")).toBeUndefined();
  expect(h.update).not.toHaveBeenCalled();
});
it("confirms initialization only for an unlinked Crew", async () => {
  await render();
  await click("crewStudio.initialize");
  expect(h.create).not.toHaveBeenCalled();
  await click("crewStudio.confirmInitialize");
  expect(h.create).toHaveBeenCalledWith(label, "1", 1);
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("does not offer initialization over a legacy project", async () => {
  h.list.mockResolvedValue({ ...label, legacyProject: { ...workspace, workspace } });
  await render();
  expect(button("crewStudio.initialize")).toBeUndefined();
  expect(host.textContent).toContain("crewStudio.legacy");
});
it("confirms unlinking without deleting a workspace", async () => {
  const linked = { ...label, workspace };
  h.list.mockResolvedValue(linked);
  await render();
  expect(button("crewStudio.initialize")).toBeUndefined();
  await click("crewStudio.unlink");
  expect(h.update).not.toHaveBeenCalled();
  await click("crewStudio.confirmUnlink");
  expect(h.update).toHaveBeenCalledWith(linked, "1", 1, null);
});
it("disables relinking the current workspace", async () => {
  h.list.mockResolvedValue({ ...label, workspace });
  await render();
  await click("Studio One");
  expect(button("crewStudio.link")?.disabled).toBe(true);
});
it("searches options without modifying the link", async () => {
  await render();
  await type(0, "missing");
  expect(button("Studio One")).toBeUndefined();
  await type(0, "studio");
  expect(button("Studio One")).toBeTruthy();
  expect(h.update).not.toHaveBeenCalled();
});
it("prevents duplicate writes and navigation during a write", async () => {
  h.update.mockImplementation(() => new Promise(() => {}));
  await render();
  await click("Studio One");
  await click("crewStudio.link");
  await act(async () => {
    button("crewStudio.confirmLink")!.click();
    button("crewStudio.confirmLink")!.click();
  });
  expect(h.update).toHaveBeenCalledOnce();
  expect(button("thread.refresh")?.disabled).toBe(true);
  expect(button("crewTasks.back")?.disabled).toBe(true);
});
it("locks an uncertain write until refresh", async () => {
  h.update.mockRejectedValue(new Error("Response lost"));
  await render();
  await click("Studio One");
  await click("crewStudio.link");
  await click("crewStudio.confirmLink");
  expect(host.textContent).toContain("Response lost");
  expect(host.textContent).toContain("crewStudio.recheck");
  expect(button("crewStudio.confirmLink")?.disabled).toBe(true);
  await click("thread.refresh");
  expect(h.list).toHaveBeenCalledTimes(2);
  expect(button("crewStudio.link")?.disabled).toBe(true);
});
it("ignores late reads after an account change", async () => {
  let finish!: (v: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.list.mock.calls[0]?.[3] as AbortSignal;
  h.generation = 2;
  await act(async () => finish(label));
  expect(button("crewStudio.link")).toBeUndefined();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("ignores late write callbacks after account replacement", async () => {
  let finish!: (v: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("crewStudio.initialize");
  await click("crewStudio.confirmInitialize");
  h.generation = 2;
  await act(async () => finish(workspace));
  expect(h.list).toHaveBeenCalledOnce();
});
