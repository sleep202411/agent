import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskWorkbench } from "./task-workbench";
import type { TaskDraftInput, TaskDraftReview } from "./task-draft-session";
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("./crew-film-picker", () => ({ CrewFilmPicker: () => null }));
vi.mock("./task-draft-storage", () => ({
  taskDraftStorage: () => ({ read: () => null, write: () => {} }),
}));
const h = vi.hoisted(() => ({
  generation: 10,
  active: true,
  access: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./episode-task-template", () => ({
  EpisodeTaskTemplate: ({
    onStage,
  }: {
    onStage: (episode: { id: string; name: string }, plan: unknown) => void;
  }) => (
    <button
      onClick={() =>
        onStage(
          { id: "11111111-1111-4111-8111-111111111111", name: "Episode 1" },
          {
            templateId: "22222222-2222-4222-8222-222222222222",
            templateVersion: 1,
            episodeVersion: 1,
            name: "Series",
            items: ["Script", "Music"].map((title) => ({
              templateKey: title,
              title,
              roleRequirement: "",
              defaultDependencies: [],
              deliveryFields: [],
            })),
          }
        )
      }
    >
      stage episode
    </button>
  ),
}));
vi.mock("../crew-assets/organization", () => ({
  AssetOrganization: ({ crewId, onClose }: { crewId: string; onClose: () => void }) => (
    <button onClick={onClose}>assets for {crewId}</button>
  ),
}));
vi.mock("./asset-task-progress", () => ({
  AssetTaskProgress: ({ crewId, onClose }: { crewId: string; onClose: () => void }) => (
    <button onClick={onClose}>progress for {crewId}</button>
  ),
}));
vi.mock("./episode-management", () => ({
  EpisodeManagement: ({ crewId, onClose }: { crewId: string; onClose: () => void }) => (
    <button onClick={onClose}>episodes for {crewId}</button>
  ),
}));
vi.mock("./task-create-api", async (original) => ({
  ...(await original<typeof import("./task-create-api")>()),
  createTask: h.create,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
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
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./task-create", () => ({
  TaskCreate: ({
    onStage,
    onClose,
  }: {
    onStage: (data: TaskDraftInput, review: TaskDraftReview) => void;
    onClose: () => void;
  }) => (
    <>
      <button
        onClick={() =>
          onStage(
            {
              title: "Storyboard",
              description: "Episode 1",
              priority: "normal",
              startAt: null,
              dueAt: null,
              parentId: null,
              blockedByTaskIds: [],
              assignees: [],
            },
            { context: ["Episode 1"], assignees: [], customFields: [] }
          )
        }
      >
        stage form
      </button>
      <button onClick={onClose}>cancel form</button>
    </>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = async (label: string) => {
  await act(async () => button(label).click());
};
const render = async () => {
  await act(async () =>
    root.render(
      <TaskWorkbench
        crewId="crew"
        userId="user"
        generation={h.generation}
        onClose={h.close}
        onCreated={h.open}
      />
    )
  );
};
const stage = async () => {
  await click("taskCreate.title");
  await click("stage form");
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation++;
  h.active = true;
  h.access.mockResolvedValue({ canManage: true });
  h.create.mockResolvedValue({ id: "created" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires management access before showing drafts or creation", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(host.textContent).toContain("taskCreate.managerOnly");
  expect(button("taskCreate.title")).toBeUndefined();
});
it("reviews staged task details without writing until Create All", async () => {
  await render();
  expect(button("taskWorkbench.createAll")).toBeUndefined();
  await stage();
  expect(host.textContent).toContain("Storyboard");
  expect(host.textContent).toContain("Episode 1");
  expect(h.create).not.toHaveBeenCalled();
  await click("taskWorkbench.createAll");
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("taskWorkbench.created");
  await click("taskWorkbench.open");
  expect(h.open).toHaveBeenCalledWith("created");
});
it("removes an unsubmitted draft without a server mutation", async () => {
  await render();
  await stage();
  await click("taskWorkbench.remove");
  expect(host.textContent).not.toContain("Storyboard");
  expect(h.create).not.toHaveBeenCalled();
});
it("retains staged drafts when leaving and reopening the screen", async () => {
  await render();
  await stage();
  await act(async () => root.render(null));
  await render();
  expect(host.textContent).toContain("Storyboard");
  expect(h.create).not.toHaveBeenCalled();
});
it("requires two explicit steps to forget an uncertain local attempt", async () => {
  h.create.mockRejectedValueOnce(new Error("Response lost"));
  await render();
  await stage();
  await stage();
  await click("taskWorkbench.createAll");
  expect(button("taskWorkbench.createAll").disabled).toBe(true);
  await click("taskWorkbench.forget");
  expect(host.textContent).toContain("taskWorkbench.forgetHelp");
  expect(button("taskWorkbench.createAll").disabled).toBe(true);
  await click("taskWorkbench.confirmForget");
  await click("taskWorkbench.createAll");
  expect(h.create).toHaveBeenCalledTimes(2);
});
it("locks screen actions while a creation is pending", async () => {
  let resolve!: (v: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await stage();
  await click("taskWorkbench.createAll");
  expect(button("crewTasks.back").disabled).toBe(true);
  expect(button("taskCreate.title").disabled).toBe(true);
  expect(button("assetOrganization.title").disabled).toBe(true);
  expect(button("assetTaskProgress.title").disabled).toBe(true);
  expect(button("episodeManagement.title").disabled).toBe(true);
  expect(button("taskWorkbench.remove")).toBeUndefined();
  await act(async () => resolve({ id: "created" }));
});
it("retains the receipt but stops further creation after unmount", async () => {
  let resolve!: (v: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await stage();
  await stage();
  await click("taskWorkbench.createAll");
  await act(async () => root.render(null));
  await act(async () => resolve({ id: "created" }));
  await render();
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("taskWorkbench.created");
  expect(button("taskWorkbench.createAll").disabled).toBe(false);
});
it("does not expose the old account's drafts", async () => {
  await render();
  await stage();
  h.generation++;
  await render();
  expect(host.textContent).not.toContain("Storyboard");
});
it.each([
  ["assetOrganization.title", "assets for crew"],
  ["assetTaskProgress.title", "progress for crew"],
  ["episodeManagement.title", "episodes for crew"],
])("preserves drafts across %s without creating tasks", async (label, destination) => {
  await render();
  await stage();
  await click(label);
  expect(host.textContent).not.toContain("Storyboard");
  await click(destination);
  expect(host.textContent).toContain("Storyboard");
  expect(h.create).not.toHaveBeenCalled();
});
it("leaves asset and episode browsing accessible to non-managers", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(button("taskCreate.title")).toBeUndefined();
  await click("assetOrganization.title");
  expect(host.textContent).toContain("assets for crew");
});
it("returns the episode preview to the shared workbench without writing tasks", async () => {
  await render();
  await stage();
  await click("episodeTaskTemplate.title");
  await click("stage episode");
  expect(host.textContent).toContain("Storyboard");
  expect(host.textContent).toContain("Script");
  expect(host.textContent).toContain("Music");
  expect(h.create).not.toHaveBeenCalled();
  expect(button("taskWorkbench.createAll").disabled).toBe(false);
});
it("stops queued writes when the screen becomes inactive and retains the completed receipt", async () => {
  let resolve!: (value: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await stage();
  await stage();
  await click("taskWorkbench.createAll");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  await act(async () => resolve({ id: "created" }));
  h.active = true;
  await render();
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("taskWorkbench.created");
  expect(button("taskWorkbench.createAll").disabled).toBe(false);
});

it("keeps the open creation form across background/foreground without staging it", async () => {
  await render();
  await click("taskCreate.title");
  expect(button("stage form")).toBeDefined();
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(button("stage form")).toBeDefined();
  expect(h.create).not.toHaveBeenCalled();
  expect(h.access).toHaveBeenCalledTimes(2);
});
it("closes the preserved editor when management permission was revoked in background", async () => {
  await render();
  await click("taskCreate.title");
  h.active = false;
  await render();
  h.access.mockResolvedValue({ canManage: false });
  h.active = true;
  await render();
  expect(button("stage form")).toBeUndefined();
  expect(host.textContent).toContain("taskCreate.managerOnly");
});
it("stops a batch after its in-flight receipt when backgrounded", async () => {
  let resolve!: (value: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await stage();
  await stage();
  await click("taskWorkbench.createAll");
  h.active = false;
  await render();
  await act(async () => resolve({ id: "created" }));
  h.active = true;
  await render();
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("taskWorkbench.created");
  expect(button("taskWorkbench.createAll").disabled).toBe(false);
});

it("does not resume a paused batch just because the screen foregrounded before its receipt", async () => {
  let resolve!: (value: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await stage();
  await stage();
  await click("taskWorkbench.createAll");
  h.active = false;
  await render();
  h.active = true;
  await render();
  await act(async () => resolve({ id: "created" }));
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(button("taskWorkbench.createAll").disabled).toBe(false);
});

it("reopens and saves a staged card in place without adding a second task", async () => {
  await render();
  await stage();
  await click("taskWorkbench.editDraft");
  await click("stage form");
  expect(
    [...host.querySelectorAll("button")].filter((b) => b.textContent === "taskWorkbench.editDraft")
  ).toHaveLength(1);
  await click("taskWorkbench.createAll");
  expect(h.create).toHaveBeenCalledOnce();
});

it("requires a fresh permission result after returning and preserves drafts through retry", async () => {
  await render();
  await stage();
  h.active = false;
  await render();
  let fail!: (e: Error) => void;
  h.access.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  h.active = true;
  await render();
  expect(button("taskCreate.title")).toBeUndefined();
  expect(host.textContent).not.toContain("Storyboard");
  await act(async () => fail(Error("Permission lookup failed")));
  expect(button("taskCreate.title")).toBeUndefined();
  expect(host.textContent).toContain("Permission lookup failed");
  await click("inbox.retry");
  expect(button("taskCreate.title")).toBeDefined();
  expect(host.textContent).toContain("Storyboard");
  expect(host.textContent).not.toContain("Permission lookup failed");
  expect(h.create).not.toHaveBeenCalled();
});
