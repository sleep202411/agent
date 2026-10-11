import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpisodeTaskTemplate } from "./episode-task-template";
const h = vi.hoisted(() => ({
  generation: 1,
  fields: vi.fn(),
  access: vi.fn(),
  episodes: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./task-custom-fields-api", async (original) => ({
  ...(await original<typeof import("./task-custom-fields-api")>()),
  fetchTaskFieldDefinitions: h.fields,
}));
vi.mock("./task-custom-field-control", () => ({
  TaskCustomFieldControl: ({
    field,
    draft,
    setDraft,
    locked,
  }: {
    field: { name: string };
    draft: string | null;
    setDraft: (value: string) => void;
    locked: boolean;
  }) => (
    <input
      aria-label={field.name}
      value={draft ?? ""}
      disabled={locked}
      onChange={(e) => setDraft(e.target.value)}
    />
  ),
}));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-planning-api", () => ({ fetchTaskPlanningOptions: h.episodes }));
vi.mock("./episode-task-template-api", () => ({
  fetchEpisodeTaskPlan: h.preview,
  applyEpisodeTaskPlan: h.apply,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const plan = {
  templateId: "template",
  templateVersion: 3,
  episodeVersion: 5,
  name: "Series",
  items: [
    {
      templateKey: "script",
      title: "Script",
      roleRequirement: "Writer",
      defaultDependencies: [],
      deliveryFields: [],
    },
  ],
};
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = (initialEpisodeId?: string) =>
  act(async () =>
    root.render(
      <EpisodeTaskTemplate
        initialEpisodeId={initialEpisodeId}
        crewId="crew"
        userId="user"
        generation={1}
        onClose={h.close}
      />
    )
  );
const choose = () => act(async () => button("Episode 1").click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fields.mockResolvedValue([]);
  h.access.mockResolvedValue({ canManage: true });
  h.episodes.mockResolvedValue([{ id: "episode", name: "Episode 1" }]);
  h.preview.mockResolvedValue(plan);
  h.apply.mockResolvedValue({ taskIds: ["task"], replayed: false });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("reviews roles before explicit creation and prevents repeat confirmation", async () => {
  await render();
  await choose();
  expect(host.textContent).toContain("Writer");
  expect(h.apply).not.toHaveBeenCalled();
  await act(async () => {
    button("episodeTaskTemplate.confirm").click();
    button("episodeTaskTemplate.confirm").click();
  });
  expect(h.apply).toHaveBeenCalledExactlyOnceWith("crew", "episode", plan, 1);
  expect(host.textContent).toContain("episodeTaskTemplate.created");
  expect(button("episodeTaskTemplate.confirm")).toBeUndefined();
});
it("does not offer episodes to someone without task management permission", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(h.episodes).not.toHaveBeenCalled();
  expect(host.textContent).toContain("episodeTaskTemplate.denied");
});
it("keeps a failed preview from being confirmed", async () => {
  h.preview.mockRejectedValue(new Error("Canvas import required"));
  await render();
  await choose();
  expect(host.textContent).toContain("Canvas import required");
  expect(button("episodeTaskTemplate.confirm").disabled).toBe(true);
});
it("retries a lost response only on an explicit tap using the same plan", async () => {
  h.apply
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ taskIds: ["task"], replayed: true });
  await render();
  await choose();
  await act(async () => button("episodeTaskTemplate.confirm").click());
  expect(h.apply).toHaveBeenCalledTimes(1);
  await act(async () => button("episodeTaskTemplate.confirm").click());
  expect(h.apply).toHaveBeenCalledTimes(2);
  expect(h.apply.mock.calls[0]).toEqual(h.apply.mock.calls[1]);
  expect(host.textContent).toContain("episodeTaskTemplate.reused");
});
it("ignores confirmation after an account change", async () => {
  await render();
  await choose();
  h.generation = 2;
  await act(async () => button("episodeTaskTemplate.confirm").click());
  expect(h.apply).not.toHaveBeenCalled();
});
it("suppresses late membership results after account replacement", async () => {
  let finish!: (value: unknown) => void;
  h.access.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => finish({ canManage: true }));
  expect(h.episodes).not.toHaveBeenCalled();
  expect(button("Episode 1")).toBeUndefined();
});
it("aborts preview reads on leaving without writing tasks", async () => {
  h.preview.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  await choose();
  const signal = h.preview.mock.calls[0][2] as AbortSignal;
  await act(async () => button("crewTasks.back").click());
  expect(signal.aborted).toBe(true);
  expect(h.apply).not.toHaveBeenCalled();
});
it("stages the reviewed plan without calling the creation endpoint", async () => {
  const onStage = vi.fn();
  await act(async () =>
    root.render(
      <EpisodeTaskTemplate
        crewId="crew"
        userId="user"
        generation={1}
        onClose={h.close}
        onStage={onStage}
      />
    )
  );
  await act(async () => button("Episode 1").click());
  await act(async () => button("taskWorkbench.stageEpisode").click());
  expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ name: "Episode 1" }), plan);
  expect(h.apply).not.toHaveBeenCalled();
});

it("requires fields for every task and retains their values in retries", async () => {
  const fieldId = "11111111-1111-4111-8111-111111111111";
  h.fields.mockResolvedValue([
    { id: fieldId, crewId: "crew", name: "Brief", type: "text", required: true, options: [] },
  ]);
  h.preview.mockResolvedValue({
    ...plan,
    items: [plan.items[0], { ...plan.items[0], templateKey: "music", title: "Music" }],
  });
  h.apply.mockRejectedValue(new Error("Response lost"));
  await render();
  await choose();
  expect(button("episodeTaskTemplate.confirm").disabled).toBe(true);
  const setInput = (i: number, value: string) => {
    const el = host.querySelectorAll("input")[i]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => setInput(0, "Script brief"));
  expect(button("episodeTaskTemplate.confirm").disabled).toBe(true);
  await act(async () => setInput(1, "Music brief"));
  expect(button("episodeTaskTemplate.confirm").disabled).toBe(false);
  await act(async () => button("episodeTaskTemplate.confirm").click());
  expect(h.apply.mock.calls[0][2].taskFields).toEqual([
    { templateKey: "script", values: [{ fieldId, value: "Script brief" }] },
    { templateKey: "music", values: [{ fieldId, value: "Music brief" }] },
  ]);
  expect(host.querySelectorAll("input")[0]!.disabled).toBe(true);
  await act(async () => button("episodeTaskTemplate.confirm").click());
  expect(h.apply.mock.calls[0]).toEqual(h.apply.mock.calls[1]);
});

it("opens the setup episode for review without initializing automatically", async () => {
  await render("episode");
  expect(h.preview).toHaveBeenCalledWith("crew", "episode", expect.any(AbortSignal));
  expect(h.apply).not.toHaveBeenCalled();
  expect(button("episodeTaskTemplate.confirm")).toBeDefined();
});
it("does not substitute another episode after a setup selection disappears", async () => {
  await render("missing");
  expect(h.preview).not.toHaveBeenCalled();
  expect(host.textContent).toContain("selected episode is no longer available");
});
