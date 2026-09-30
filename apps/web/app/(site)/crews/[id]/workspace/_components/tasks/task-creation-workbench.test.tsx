vi.mock("./workbench-canvas-import", () => ({
  WorkbenchCanvasImport: ({ onStage }: { onStage: (batch: unknown) => void }) => (
    <button
      onClick={() =>
        onStage({
          key: "canvas:project",
          title: "Canvas Batch",
          path: "/batch",
          body: { sourceRevision: 3, sourceHash: "hash" },
          items: [{ title: "Scene One" }, { title: "Scene Two" }],
        })
      }
    >
      Stage Canvas
    </button>
  ),
}));
vi.mock("./workbench-asset-upload", () => ({ WorkbenchAssetUpload: () => <div data-upload /> }));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import { TaskCreationWorkbench } from "./task-creation-workbench";
import type { CrewTaskProjectDTO } from "@/app/(site)/crews/_hooks/types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  taskLoading: false,
  taskMore: false,
  create: vi.fn(),
  post: vi.fn(),
  invalidate: vi.fn(),
  episode: vi.fn(),
  refresh: vi.fn(),
  episodeId: null as string | null,
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: (ns: string) => (key: string) =>
    ns.endsWith("workbench")
      ? ((en.crewTaskProject.workbench as Record<string, string>)[key] ?? key)
      : key,
}));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { post: state.post } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "user" } }) }));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("../../_hooks/use-crew-assets", () => ({
  useCrewAssets: () => ({ data: { items: [{ id: "folder", name: "Scripts" }] } }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCreateCrewTask: () => ({ mutateAsync: state.create }),
  useCreateCrewEpisode: () => ({ mutateAsync: state.episode }),
  useCrewEpisodes: () => ({
    refetch: state.refresh,
    data: [
      {
        id: "ep",
        number: 1,
        title: "Pilot",
        status: "planned",
        taskProgress: { total: 2, completed: 1 },
      },
    ],
  }),
  useCrewTaskView: () => ({
    data: [],
    refetch: state.refresh,
    isLoading: state.taskLoading,
    hasNextPage: state.taskMore,
  }),
}));
vi.mock("./episode-template-preview", () => ({
  EpisodeTemplatePreview: ({ episodeId }: { episodeId: string }) => (
    <div data-testid="episode-preview">{episodeId}</div>
  ),
}));
vi.mock("./task-quick-create", () => ({
  TaskQuickCreate: ({
    open,
    onStage,
    presetEpisodeId,
  }: {
    open: boolean;
    onStage: (input: unknown) => void;
    presetEpisodeId: string | null;
  }) =>
    open ? (
      <button
        onClick={() => {
          state.episodeId = presetEpisodeId;
          onStage({
            title: "Storyboard",
            description: "Brief",
            priority: "normal",
            assignees: [],
            episodeId: presetEpisodeId,
          });
        }}
      >
        Stage Draft
      </button>
    ) : null,
}));
let root: Root;
let host: HTMLDivElement;
const project = { views: [{ filters: {} }] } as CrewTaskProjectDTO;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.post.mockReset().mockResolvedValue({ taskIds: ["one", "two"] });
  state.create.mockReset().mockResolvedValue({ id: "created" });
  state.refresh.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(canManage = true, active = true) {
  await act(async () =>
    root.render(
      <TaskCreationWorkbench
        crewId="crew"
        crewName="Crew"
        project={project}
        members={[]}
        canManage={canManage}
        canManageEpisodes={canManage}
        active={active}
        onSelectTask={() => undefined}
      />
    )
  );
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function stage() {
  await click("Create Task");
  await click("Stage Draft");
}
it("stages without posting and submits once despite rapid confirmation clicks", async () => {
  await render();
  await stage();
  expect(state.create).not.toHaveBeenCalled();
  await act(async () => {
    button("Create All Tasks").click();
    button("Create All Tasks").click();
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Created");
  expect(button("Create All Tasks").disabled).toBe(true);
});
it("stops after an uncertain response and never resubmits a confirmed task", async () => {
  state.create
    .mockResolvedValueOnce({ id: "one" })
    .mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await stage();
  await stage();
  await stage();
  await click("Create All Tasks");
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Connection lost");
  expect(host.textContent).toContain("Check Creation Result");
  expect(button("Create All Tasks").disabled).toBe(true);
});
it("passes the chosen episode to the draft and retains it across view switches", async () => {
  await render();
  await click("Production Episodes");
  await click("Add Episode Task");
  await click("Stage Draft");
  expect(state.episodeId).toBe("ep");
  await render(true, false);
  await render();
  expect(host.textContent).toContain("Storyboard");
  await click("Create All Tasks");
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ episodeId: "ep" }));
});
it("shows assets and production to viewers without creation controls", async () => {
  await render(false);
  expect(button("Create Task")).toBeUndefined();
  expect(host.textContent).toContain("Scripts");
  expect(host.textContent).toContain("Pilot");
  expect(state.create).not.toHaveBeenCalled();
});
it("removes a draft before confirmation", async () => {
  await render();
  await stage();
  await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
  expect(button("Create All Tasks").disabled).toBe(true);
  expect(state.create).not.toHaveBeenCalled();
});

it("opens the selected episode template without creating tasks", async () => {
  await render();
  await click("Production Episodes");
  await click("Stage Standard Tasks");
  expect(host.querySelector('[data-testid="episode-preview"]')?.textContent).toBe("ep");
  expect(state.create).not.toHaveBeenCalled();
});
it("hides template creation from members without task management permission", async () => {
  await render(false);
  expect(button("Stage Standard Tasks")).toBeUndefined();
});

it.each(["taskLoading", "taskMore"] as const)(
  "withholds counters while %s is incomplete",
  async (key) => {
    state[key] = true;
    try {
      await render();
      const progress = host.querySelector('section[aria-label="Approved / Total Tasks"]');
      expect(progress?.textContent).toContain("—");
      expect(progress?.textContent).not.toContain("0/0");
    } finally {
      state[key] = false;
    }
  }
);

it("keeps existing task tables out of creation and anchors confirmation in the footer", async () => {
  await render();
  expect(host.textContent).not.toContain("Production Tasks");
  expect(host.querySelector("footer")?.textContent).toContain("Create All Tasks");
  expect(button("Production Episodes").getAttribute("aria-expanded")).toBe("false");
  await click("Production Episodes");
  expect(button("Production Episodes").getAttribute("aria-expanded")).toBe("true");
});
it("discards only staged drafts without sending a create request", async () => {
  await render();
  await stage();
  await click("Discard");
  expect(button("Create All Tasks").disabled).toBe(true);
  expect(state.create).not.toHaveBeenCalled();
});

it("stages batches without writing and retries the exact reviewed command", async () => {
  await render();
  await click("Stage Canvas");
  expect(host.textContent).toContain("Scene One");
  expect(state.post).not.toHaveBeenCalled();
  state.post.mockRejectedValueOnce(new Error("Connection lost"));
  await click("Create All Tasks");
  expect(host.textContent).toContain("Connection lost");
  await click("Create All Tasks");
  expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0]);
  expect(button("Create All Tasks").disabled).toBe(true);
});

it("keeps confirmed individual tasks out of batch retries and refreshes all affected crew views", async () => {
  await render();
  await stage();
  await click("Stage Canvas");
  state.post.mockRejectedValueOnce(new Error("Connection lost"));
  await click("Create All Tasks");
  expect(state.create).toHaveBeenCalledTimes(1);
  await click("Create All Tasks");
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledTimes(2);
  expect(state.invalidate.mock.calls.map(([filter]) => filter.queryKey)).toEqual([
    ["crew", "tasks", "crew"],
    ["crew", "production", "crew", "overview"],
    ["crew", "production", "crew", "activity"],
    ["crew", "production", "crew", "episodes"],
    ["crew", "task-center"],
  ]);
});
