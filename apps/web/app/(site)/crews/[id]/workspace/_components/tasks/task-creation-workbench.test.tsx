vi.mock("./workbench-canvas-import", () => ({
  WorkbenchCanvasImport: ({ onStage }: { onStage: (batch: unknown) => void }) => (
    <button
      onClick={() =>
        onStage({
          key: "canvas:project",
          title: "Canvas Batch",
          path: "/crews/crew/canvas-task-import/story-projects/project/apply",
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
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const state = vi.hoisted(() => ({
  userId: "user",
  assetQuery: vi.fn(),
  tasks: [] as Array<{
    id: string;
    parentId: null;
    status: "approved" | "open";
    assetCategory: string;
  }>,
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
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    const text = ns.endsWith("workbench")
      ? ((en.crewTaskProject.workbench as Record<string, string>)[key] ?? key)
      : key;
    return text.replace(/{(\w+)}/g, (_, name) => String(values?.[name] ?? name));
  },
}));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { post: state.post } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.userId } }) }));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("../../_hooks/use-crew-assets", () => ({
  useCrewAssets: (_crew: string, query: unknown, enabled: boolean) => {
    state.assetQuery(query, enabled);
    return { data: { items: [{ id: "folder", name: "Scripts", kind: "folder" }] } };
  },
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
    data: state.tasks,
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
    initialInput,
  }: {
    open: boolean;
    initialInput?: { title: string };
    onStage: (input: unknown) => void;
    presetEpisodeId: string | null;
  }) =>
    open ? (
      <button
        onClick={() => {
          state.episodeId = presetEpisodeId;
          onStage({
            title: initialInput ? "Revised Script" : "Storyboard",
            taskKind: "script",
            description: "Brief",
            priority: "normal",
            assignees: [],
            episodeId: presetEpisodeId,
          });
        }}
      >
        {initialInput ? "Save Draft" : "Stage Draft"}
      </button>
    ) : null,
}));
let root: Root;
let host: HTMLDivElement;
const project = { views: [{ filters: {} }] } as CrewTaskProjectDTO;
beforeEach(() => {
  window.localStorage.clear();
  state.userId = "user";
  state.assetQuery.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.post.mockReset().mockResolvedValue({ taskIds: ["one", "two"] });
  state.create.mockReset().mockResolvedValue({ id: "created" });
  state.refresh.mockReset();
  state.tasks = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(canManage = true, active = true, crewId = "crew") {
  await act(async () =>
    root.render(
      <TaskCreationWorkbench
        crewId={crewId}
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
  expect(button("Create All Tasks")).toBeUndefined();
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
it("retains staged tasks across view switches", async () => {
  await render();
  await stage();
  await render(true, false);
  await render();
  expect(host.textContent).toContain("Storyboard");
  await click("Create All Tasks");
  expect(state.create).toHaveBeenCalledTimes(1);
});
it("shows assets and production to viewers without creation controls", async () => {
  await render(false);
  expect(button("Create Task")).toBeUndefined();
  expect(host.textContent).toContain("Scripts");
  expect(host.querySelector("[role=dialog]")).toBeNull();
  await click("Production Episodes");
  expect(host.querySelector("[role=dialog]")?.textContent).toContain("Pilot");
  expect(button("Preview Tasks")).toBeUndefined();
  expect(button("Create Episode")).toBeUndefined();
  expect(state.create).not.toHaveBeenCalled();
});
it("removes a draft before confirmation", async () => {
  await render();
  await stage();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Remove Storyboard"]')!.click()
  );
  expect(button("Create All Tasks")).toBeUndefined();
  expect(state.create).not.toHaveBeenCalled();
});

it("opens the selected episode template without creating tasks", async () => {
  await render();
  await click("Choose Episode");
  await click("Preview Tasks");
  expect(host.querySelector('[data-testid="episode-preview"]')?.textContent).toBe("ep");
  expect(state.create).not.toHaveBeenCalled();
});
it("hides template creation from members without task management permission", async () => {
  await render(false);
  expect(button("Preview Tasks")).toBeUndefined();
});

it.each(["taskLoading", "taskMore"] as const)(
  "withholds counters while %s is incomplete",
  async (key) => {
    state[key] = true;
    try {
      await render();
      const progress = host.querySelector('section[aria-label="Approved / Created Tasks"]');
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
  expect(host.querySelector("footer")).toBeNull();
  await stage();
  expect(host.querySelector("footer")?.textContent).toContain("Create All Tasks");
  expect(button("Choose Episode").getAttribute("aria-expanded")).toBe("false");
  await click("Choose Episode");
  expect(button("Choose Episode").getAttribute("aria-expanded")).toBe("true");
});
it("discards only staged drafts without sending a create request", async () => {
  await render();
  await stage();
  await click("Discard");
  expect(button("Create All Tasks")).toBeUndefined();
  expect(state.create).not.toHaveBeenCalled();
});

it("stages batches without writing and retries the exact reviewed command", async () => {
  await render();
  await click("Production");
  await click("Stage Canvas");
  expect(host.textContent).toContain("Scene One");
  expect(state.post).not.toHaveBeenCalled();
  state.post.mockRejectedValueOnce(new Error("Connection lost"));
  await click("Create All Tasks");
  expect(host.textContent).toContain("Connection lost");
  await click("Create All Tasks");
  expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0]);
  expect(button("Create All Tasks")).toBeUndefined();
});

it("keeps confirmed individual tasks out of batch retries and refreshes all affected crew views", async () => {
  await render();
  await stage();
  await click("Production");
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

it("edits a staged card in place without creating or duplicating a task", async () => {
  await render();
  await stage();
  await click("Storyboard");
  await click("Save Draft");
  expect(host.textContent).toContain("Revised Script");
  expect(host.textContent).not.toContain("Storyboard");
  expect(state.create).not.toHaveBeenCalled();
  await click("Create All Tasks");
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ title: "Revised Script" }));
});
it("shows saved progress separately from two staged scripts and updates on removal", async () => {
  state.tasks = [{ id: "old", parentId: null, status: "approved", assetCategory: "scripts" }];
  await render();
  await stage();
  await stage();
  const progress = () => host.querySelector('section[aria-label="Approved / Created Tasks"]')!;
  expect(progress().textContent).toContain("1/1");
  expect(progress().textContent).toContain("2 To Create");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Remove Storyboard"]')!.click()
  );
  expect(progress().textContent).toContain("1/1");
  expect(progress().textContent).toContain("1 To Create");
});
it("starts with zero saved counts and opens episode selection immediately", async () => {
  await render();
  expect(host.querySelectorAll('section[aria-label="Approved / Created Tasks"] dd')).toHaveLength(
    8
  );
  expect(
    [...host.querySelectorAll('section[aria-label="Approved / Created Tasks"] dd')].every(
      (node) => node.textContent === "0/0"
    )
  ).toBe(true);
  await click("Choose Episode");
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Pilot");
  expect(button("Stage Standard Tasks")).toBeUndefined();
});

async function remount() {
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
}
it("restores edited drafts after unmount and keeps accounts isolated", async () => {
  await render();
  await stage();
  await click("Storyboard");
  await click("Save Draft");
  await remount();
  expect(host.textContent).toContain("Revised Script");
  state.userId = "another-user";
  await render();
  expect(host.textContent).not.toContain("Revised Script");
  state.userId = "user";
  await render();
  expect(host.textContent).toContain("Revised Script");
  await click("Discard");
  await remount();
  expect(host.textContent).not.toContain("Revised Script");
});
it("restores confirmed tasks as links without offering duplicate creation", async () => {
  await render();
  await stage();
  await click("Create All Tasks");
  await remount();
  expect(host.textContent).toContain("Open Task");
  expect(button("Create All Tasks")).toBeUndefined();
  expect(state.create).toHaveBeenCalledTimes(1);
});
it("restores an interrupted create as uncertain instead of retrying", async () => {
  let resolve!: (value: { id: string }) => void;
  state.create.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await stage();
  await click("Create All Tasks");
  await remount();
  expect(host.textContent).toContain("Check Creation Result");
  expect(button("Create Task").disabled).toBe(true);
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ id: "created" }));
});
it("opens all accessible asset search separately from collapsed progress", async () => {
  await render();
  const toggle = button("Approved / Created Tasks");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await click("Approved / Created Tasks");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await click("Search Assets…");
  expect(state.assetQuery).toHaveBeenLastCalledWith(
    { source: "recent", sort: "name", query: undefined },
    true
  );
  expect(host.querySelector('[role="dialog"] a')?.getAttribute("href")).toContain("asset=folder");
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Search Assets…"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "nested"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(state.assetQuery).toHaveBeenLastCalledWith(
    { source: "recent", sort: "name", query: "nested" },
    true
  );
});
it("restores a reviewed batch without altering its idempotent command", async () => {
  await render();
  await click("Production");
  await click("Stage Canvas");
  state.post.mockRejectedValueOnce(new Error("Connection lost"));
  await click("Create All Tasks");
  await remount();
  expect(host.textContent).toContain("Scene One");
  await click("Create All Tasks");
  expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0]);
});

it("isolates drafts by Crew and retains them when switching back", async () => {
  await render();
  await stage();
  await render(true, true, "another-crew");
  expect(host.textContent).not.toContain("Storyboard");
  await render();
  expect(host.textContent).toContain("Storyboard");
});
it("keeps the draft and does not send an unrecorded create when browser storage fails", async () => {
  await render();
  const storage = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  try {
    await stage();
    expect(host.textContent).toContain("Drafts could not be saved");
    expect(host.textContent).toContain("Storyboard");
    await click("Create All Tasks");
    expect(state.create).not.toHaveBeenCalled();
  } finally {
    storage.mockRestore();
  }
});
it("does not overwrite unreadable saved drafts with an empty or new session", async () => {
  const key = "fizz:workbench:v1:user:crew";
  window.localStorage.setItem(key, "broken JSON");
  await render();
  await stage();
  expect(host.textContent).toContain("Drafts could not be saved");
  expect(window.localStorage.getItem(key)).toBe("broken JSON");
});
it("lets users dismiss a checked uncertain notice without retrying or deleting a server task", async () => {
  state.create.mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await stage();
  await click("Create All Tasks");
  await click("I checked Tasks — dismiss this notice");
  expect(button("Create Task").disabled).toBe(false);
  expect(state.create).toHaveBeenCalledTimes(1);
  await remount();
  expect(host.textContent).not.toContain("Check Creation Result");
});
