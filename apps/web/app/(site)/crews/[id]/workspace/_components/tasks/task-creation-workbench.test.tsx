vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ src, name }: { src: string; name: string }) => (
    <span role="img" data-src={src} aria-label={name} />
  ),
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map([["assigned-user", { avatar: "https://example.com/avatar.png" }]]),
  displayNameOf: (id: string) => id,
}));
vi.mock("./workbench-canvas-import", () => ({
  WorkbenchCanvasImport: ({ onStage }: { onStage?: unknown }) => (
    <div data-direct-import={onStage === undefined}>Import to Tasks</div>
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
    title?: string;
    description?: string;
    priority?: string;
    taskKind?: string;
    assignees?: { userId: string }[];
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
    onCreated,
    onOpenChange,
    presetEpisodeId,
    presetTaskKind,
    initialInput,
  }: {
    open: boolean;
    initialInput?: { title: string };
    onStage?: (input: unknown) => void;
    onCreated?: () => void;
    onOpenChange: (open: boolean) => void;
    presetEpisodeId: string | null;
    presetTaskKind?: string;
  }) =>
    open ? (
      <button
        onClick={async () => {
          state.episodeId = presetEpisodeId;
          const input = {
            title: initialInput ? "Revised Script" : "Storyboard",
            taskKind: presetTaskKind ?? "script",
            description: "Brief",
            ...{
              workflowStateId: "workflow-open",
              rewardUsdMinor: 10000,
              dueAt: "2099-10-03T00:00:00.000Z",
            },
            priority: "normal",
            assignees: [],
            episodeId: presetEpisodeId,
          };
          if (onStage) onStage(input);
          else {
            await state.create(input);
            onCreated?.();
            onOpenChange(false);
          }
        }}
      >
        {initialInput ? "Save Draft" : "Save Task"}
      </button>
    ) : null,
}));
let publishCallback: ((id: string) => void) | undefined;
let root: Root;
let host: HTMLDivElement;
const project = { views: [{ filters: {} }] } as CrewTaskProjectDTO;
beforeEach(() => {
  publishCallback = undefined;
  window.localStorage.clear();
  state.userId = "user";
  state.assetQuery.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.post.mockReset().mockResolvedValue({ taskIds: ["one", "two"] });
  state.create.mockReset().mockImplementation(async (input) => {
    state.tasks.push({
      ...input,
      id: "created",
      parentId: null,
      status: "open",
      assetCategory: "scripts",
    });
    return { id: "created" };
  });
  state.refresh.mockReset();
  state.tasks = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(
  canManage = true,
  active = true,
  crewId = "crew",
  onPublishTask?: (id: string) => void
) {
  if (onPublishTask) publishCallback = onPublishTask;
  await act(async () =>
    root.render(
      <TaskCreationWorkbench
        crewId={crewId}
        crewName="Crew"
        project={project}
        members={[]}
        canManage={canManage}
        canSubmitAssigned
        canManageEpisodes={canManage}
        active={active}
        onPublishTask={publishCallback}
        onSelectTask={() => undefined}
      />
    )
  );
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label
  )!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function stage() {
  // Recover an existing browser draft; new tasks now save directly.
  const key = `fizz:workbench:v1:${state.userId}:crew`;
  const snapshot = JSON.parse(
    window.localStorage.getItem(key) ?? '{"version":1,"drafts":[],"batches":[]}'
  );
  snapshot.drafts.push({
    id: snapshot.drafts.length + 1,
    state: "staged",
    input: {
      title: "Storyboard",
      description: "Brief",
      ...{
        workflowStateId: "workflow-open",
        rewardUsdMinor: 10000,
        dueAt: "2099-10-03T00:00:00.000Z",
      },
      taskKind: "script",
      priority: "normal",
      assignees: [],
    },
  });
  window.localStorage.setItem(key, JSON.stringify(snapshot));
  await remount();
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
  await click("Production Episodes");
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
  expect(button("Choose Episode")).toBeUndefined();
  await click("Production Episodes");
  expect(host.querySelector("[role=dialog]")).not.toBeNull();
});
it("discards only staged drafts without sending a create request", async () => {
  await render();
  await stage();
  await click("Discard");
  expect(button("Create All Tasks")).toBeUndefined();
  expect(state.create).not.toHaveBeenCalled();
});

it("recovers saved batches and retries the exact reviewed command", async () => {
  seedBatch();
  await render();
  expect(host.textContent).toContain("Canvas Batch");
  expect(state.post).not.toHaveBeenCalled();
  state.post.mockRejectedValueOnce(new Error("Connection lost"));
  await click("Create All Tasks");
  expect(host.textContent).toContain("Connection lost");
  await click("Create All Tasks");
  expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0]);
  expect(button("Create All Tasks")).toBeUndefined();
});

it("keeps confirmed individual tasks out of batch retries and refreshes all affected crew views", async () => {
  seedBatch();
  await render();
  await stage();
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
  await click("Production Episodes");
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
  seedBatch();
  await render();
  state.post.mockRejectedValueOnce(new Error("Connection lost"));
  await click("Create All Tasks");
  await remount();
  expect(host.textContent).toContain("Canvas Batch");
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
  await stage();
  const storage = vi
    .spyOn(
      Object.hasOwn(window.localStorage, "setItem")
        ? window.localStorage
        : Object.getPrototypeOf(window.localStorage),
      "setItem"
    )
    .mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
  try {
    await click("Storyboard");
    await click("Save Draft");
    expect(host.textContent).toContain("Drafts could not be saved");
    expect(host.textContent).toContain("Revised Script");
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

it("shows deadline and named assignee without staging or reward clutter", async () => {
  window.localStorage.setItem(
    "fizz:workbench:v1:user:crew",
    JSON.stringify({
      version: 1,
      batches: [],
      drafts: [
        {
          id: 1,
          state: "staged",
          input: {
            title: "Detailed Script",
            description: "Brief",
            ...{
              workflowStateId: "workflow-open",
              rewardUsdMinor: 10000,
              dueAt: "2099-10-03T00:00:00.000Z",
            },
            priority: "normal",
            taskKind: "script",
            dueAt: "2026-10-03T15:59:59Z",
            assignees: [{ userId: "assigned-user", currency: "USD" }],
          },
        },
      ],
    })
  );
  await render();
  expect(host.textContent).toContain("2026-10-03");
  expect(host.textContent).not.toContain("Reward not set");
  expect(host.textContent).toContain("assigned-user");
  expect(host.textContent).not.toMatch(/\bStaged\b/);
  expect(
    host.querySelector('[role="img"][aria-label="assigned-user"]')?.getAttribute("data-src")
  ).toBe("https://example.com/avatar.png");
  const edit = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Detailed Script"
  )!;
  expect(edit.className).not.toContain("hover:underline");
  expect(edit.querySelector("svg")).toBeNull();
  await act(async () => edit.click());
  expect(button("Save Draft")).toBeDefined();
});

it("saves category-specific tasks directly to the server", async () => {
  await act(async () =>
    root.render(
      <TaskCreationWorkbench
        crewId="crew"
        crewName="Crew"
        project={project}
        members={[]}
        canManage
        canManageEpisodes
        active
        onSelectTask={() => {}}
      />
    )
  );
  const add = host.querySelector<HTMLButtonElement>('button[aria-label="Create Task · Music"]');
  expect(add).not.toBeNull();
  await act(async () => add!.click());
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Save Task")!.click()
  );
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ taskKind: "music" }));
  const music = [...host.querySelectorAll("details")]
    .filter((d) => d.querySelector("summary")?.textContent?.includes("Music"))
    .at(-1);
  expect(music).toBeDefined();
});

it("formats long deadlines in weeks, days and hours", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    window.localStorage.setItem(
      "fizz:workbench:v1:user:crew",
      JSON.stringify({
        version: 1,
        batches: [],
        drafts: [
          {
            id: 1,
            state: "staged",
            input: {
              title: "Future task",
              description: "",
              priority: "normal",
              assignees: [],
              dueAt: new Date(now + 219 * 3600000).toISOString(),
            },
          },
        ],
      })
    );
    await render();
    expect(host.textContent).toContain("1 wks 2 days 3 h remaining");
    expect(host.textContent).not.toContain("219h");
  } finally {
    clock.mockRestore();
  }
});

it("hands a created unassigned task to the recruitment form without publishing automatically", async () => {
  const publish = vi.fn();
  await render(true, true, "crew", publish);
  await stage();
  expect(button("Recruit Creators")).toBeUndefined();
  await click("Create All Tasks");
  expect(publish).not.toHaveBeenCalled();
  await click("Recruit Creators");
  expect(publish).toHaveBeenCalledWith("created");
});

it("counts saved tasks and keeps template previews out of task categories", async () => {
  window.localStorage.setItem(
    "fizz:workbench:v1:user:crew",
    JSON.stringify({
      version: 1,
      drafts: [],
      batches: [
        {
          key: "canvas:project",
          title: "Old template preview",
          path: "/crews/crew/canvas-task-import/story-projects/project/apply",
          body: { sourceRevision: 3, sourceHash: "hash" },
          items: [{ title: "Template item", assetCategory: "scripts" }],
        },
      ],
    })
  );
  await render();
  const scripts = () =>
    [...host.querySelectorAll("details")]
      .filter((d) => d.querySelector("summary")?.textContent?.includes("Scripts"))
      .at(-1)!;
  expect(scripts().querySelector("summary")?.textContent).toMatch(/0$/);
  expect(scripts().textContent).not.toContain("Template item");
  expect(host.textContent).toContain("Saved template drafts (1)");
  state.tasks = [{ id: "saved", parentId: null, status: "open", assetCategory: "scripts" }];
  await render();
  expect(scripts().querySelector("summary")?.textContent).toMatch(/1$/);
});

it("does not resurrect a deleted server task from an old confirmed browser draft", async () => {
  window.localStorage.setItem(
    "fizz:workbench:v1:user:crew",
    JSON.stringify({
      version: 1,
      batches: [],
      drafts: [
        {
          id: 1,
          state: "created",
          taskId: "deleted-task",
          input: {
            title: "Deleted task",
            description: "",
            priority: "normal",
            taskKind: "script",
            assignees: [],
          },
        },
      ],
    })
  );
  await render();
  expect(host.textContent).not.toContain("Deleted task");
  expect(host.querySelector('a[href*="deleted-task"]')).toBeNull();
});

it("lets an assigned non-manager find a saved task for delivery without creation controls", async () => {
  state.tasks = [
    {
      id: "assigned",
      title: "Assigned delivery",
      description: "",
      parentId: null,
      priority: "normal",
      taskKind: "script",
      status: "open",
      assetCategory: "scripts",
      assignees: [{ userId: "user" }],
    },
  ];
  await render(false);
  expect(host.textContent).toContain("Assigned delivery");
  expect(host.textContent).toContain("Open task & submit delivery");
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.getAttribute("aria-label")?.startsWith("Create Task")
    )
  ).toBe(false);
});

function seedBatch() {
  window.localStorage.setItem(
    "fizz:workbench:v1:user:crew",
    JSON.stringify({
      version: 1,
      drafts: [],
      batches: [
        {
          key: "canvas:project",
          title: "Canvas Batch",
          path: "/crews/crew/canvas-task-import/story-projects/project/apply",
          body: { sourceRevision: 3, sourceHash: "hash" },
          items: [{ title: "Scene One" }, { title: "Scene Two" }],
        },
      ],
    })
  );
}
it("imports new canvas tasks directly instead of staging another browser draft", async () => {
  await render();
  await click("Interactive Film Canvas");
  expect(host.querySelector('[data-direct-import="true"]')).not.toBeNull();
  expect(button("Create All Tasks")).toBeUndefined();
});

it("reveals tasks arriving after loading without reopening a manually collapsed group", async () => {
  state.taskLoading = true;
  await render();
  const scripts = () =>
    [...host.querySelectorAll("details")].find((d) =>
      d.querySelector('button[aria-label="Create Task · Scripts"]')
    )!;
  expect(scripts().open).toBe(false);
  state.taskLoading = false;
  state.tasks = [
    {
      id: "loaded",
      parentId: null,
      status: "open",
      assetCategory: "scripts",
      title: "Loaded script",
      description: "Brief",
      ...{
        workflowStateId: "workflow-open",
        rewardUsdMinor: 10000,
        dueAt: "2099-10-03T00:00:00.000Z",
      },
      priority: "normal",
      taskKind: "script",
      assignees: [],
    },
  ];
  await render();
  expect(scripts().open).toBe(true);
  scripts().open = false;
  await render();
  expect(scripts().open).toBe(false);
});
it("does not carry a recovered draft episode into a new category task", async () => {
  window.localStorage.setItem(
    "fizz:workbench:v1:user:crew",
    JSON.stringify({
      version: 1,
      batches: [],
      drafts: [
        {
          id: 1,
          state: "staged",
          input: {
            title: "Episode draft",
            description: "Brief",
            ...{
              workflowStateId: "workflow-open",
              rewardUsdMinor: 10000,
              dueAt: "2099-10-03T00:00:00.000Z",
            },
            priority: "normal",
            taskKind: "script",
            assignees: [],
            episodeId: "ep",
          },
        },
      ],
    })
  );
  await render();
  await click("Edit Episode draft");
  await click("Save Draft");
  await click("Create Task · Music");
  await click("Save Task");
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({ taskKind: "music", episodeId: null })
  );
});
