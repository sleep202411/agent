import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewTaskBrowser } from "./crew-task-browser";
vi.mock("./crew-setup", () => ({
  CrewSetup: ({ onTasks }: { onTasks: () => void }) => (
    <button onClick={onTasks}>setup assignments</button>
  ),
}));
vi.mock("./trust-appeals", () => ({
  TrustAppeals: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close appeals</button>
  ),
}));
const h = vi.hoisted(() => ({
  generation: 1,
  push: vi.fn(),
  close: vi.fn(),
  detail: vi.fn(),
  workbench: vi.fn(),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/navigation", () => ({ toHref: (path: string) => path }));
vi.mock("./project-activity", () => ({
  ProjectActivity: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close activity</button>
  ),
}));
vi.mock("./project-document", () => ({
  ProjectDocument: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close document</button>
  ),
}));
vi.mock("./project-resources", () => ({
  ProjectResources: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close resources</button>
  ),
}));
vi.mock("./project-properties", () => ({
  ProjectProperties: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close properties</button>
  ),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <span>{path}</span>,
}));
vi.mock("./crew-members", () => ({
  CrewMembers: ({
    onClose,
    onTransferComplete,
  }: {
    onClose: () => void;
    onTransferComplete: () => void;
  }) => (
    <>
      <button onClick={onClose}>close members</button>
      <button onClick={onTransferComplete}>transfer complete</button>
    </>
  ),
}));
vi.mock("./episode-management", () => ({
  EpisodeManagement: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close episodes</button>
  ),
}));
vi.mock("./episode-create", () => ({
  EpisodeCreate: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close episode</button>
  ),
}));
vi.mock("./episode-task-template", () => ({
  EpisodeTaskTemplate: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close templates</button>
  ),
}));
vi.mock("./asset-task-progress", () => ({
  AssetTaskProgress: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close progress</button>
  ),
}));
vi.mock("./task-workbench", () => ({
  TaskWorkbench: (props: { onCreated: (id: string) => void }) => {
    h.workbench(props);
    return <button onClick={() => props.onCreated("new")}>create form</button>;
  },
}));
vi.mock("./task-view-browser", () => ({
  TaskViewBrowser: ({
    onSelect,
    onClose,
    viewId,
    onViewChange,
  }: {
    viewId?: string;
    onViewChange: (id: string) => void;
    onSelect: (task: { id: string }) => void;
    onClose: () => void;
  }) => (
    <>
      <span>{viewId}</span>
      <button onClick={() => onViewChange("selected-view")}>change view</button>
      <button onClick={() => onSelect({ id: "task" })}>pick</button>
      <button onClick={onClose}>close</button>
    </>
  ),
}));
vi.mock("../crew-assets/organization", () => ({
  AssetOrganization: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close asset organization</button>
  ),
}));
vi.mock("../crew-assets/studio-media", () => ({
  StudioMedia: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close studio media</button>
  ),
}));
vi.mock("./crew-studio-workspace", () => ({
  CrewStudioWorkspace: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close workspace</button>
  ),
}));
vi.mock("./task-workflow-management", () => ({
  TaskWorkflowManagement: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close workflows</button>
  ),
}));
vi.mock("./task-cycle-management", () => ({
  TaskCycleManagement: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close cycles</button>
  ),
}));
vi.mock("./task-label-management", () => ({
  TaskLabelManagement: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close labels</button>
  ),
}));
vi.mock("./task-field-management", () => ({
  TaskFieldManagement: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>close fields</button>
  ),
}));
vi.mock("./task-detail", () => ({
  TaskDetail: (props: {
    onClose: () => void;
    onOpenWeb: (id: string) => void;
    closeLabel: string;
    taskId: string;
  }) => {
    h.detail(props);
    return (
      <>
        <span>{props.taskId}</span>
        <button onClick={props.onClose}>{props.closeLabel}</button>
        <button onClick={() => props.onOpenWeb("related")}>web</button>
      </>
    );
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
beforeEach(async () => {
  vi.clearAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(<CrewTaskBrowser crewId="crew" userId="1" generation={1} onClose={h.close} />)
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("opens authorized native detail and returns to the task list", async () => {
  await act(async () => button("pick").click());
  expect(h.detail).toHaveBeenLastCalledWith(
    expect.objectContaining({ crewId: "crew", taskId: "task", userId: "1", generation: 1 })
  );
  await act(async () => button("crewTasks.back").click());
  expect(button("pick")).toBeTruthy();
  await act(async () => button("close").click());
  expect(h.close).toHaveBeenCalledOnce();
});
it("continues the currently viewed related task on Web and returns to it", async () => {
  await act(async () => button("pick").click());
  await act(async () => button("web").click());
  expect(host.textContent).toContain("/crews/crew/workspace?tab=tasks&task=related");
  await act(async () => button("taskRelations.backToTask").click());
  expect(h.detail).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "related" }));
});
it("ignores stale task selection after account changes", async () => {
  h.generation = 2;
  await act(async () => button("pick").click());
  expect(h.detail).not.toHaveBeenCalled();
});

it("opens the newly created task directly", async () => {
  await act(async () => button("taskCreate.title").click());
  await act(async () => button("create form").click());
  expect(h.detail).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "new" }));
});

it("opens field settings and returns to the task browser", async () => {
  await act(async () => button("taskFields.title").click());
  await act(async () => button("close fields").click());
  expect(button("pick")).toBeDefined();
});

it("opens native asset progress and returns to the unchanged task browser", async () => {
  await act(async () => button("assetTaskProgress.title").click());
  expect(button("close progress")).toBeDefined();
  await act(async () => button("close progress").click());
  expect(button("pick")).toBeDefined();
});

it("opens native episode templates and returns to the task browser", async () => {
  await act(async () => button("episodeTaskTemplate.title").click());
  expect(button("close templates")).toBeDefined();
  await act(async () => button("close templates").click());
  expect(button("pick")).toBeDefined();
});

it("opens native episode creation and returns to the task browser", async () => {
  await act(async () => button("episodeCreate.title").click());
  expect(button("close episode")).toBeDefined();
  await act(async () => button("close episode").click());
  expect(button("pick")).toBeDefined();
});

it("opens the native episode list and returns to the task browser", async () => {
  await act(async () => button("episodeManagement.title").click());
  expect(button("close episodes")).toBeDefined();
  await act(async () => button("close episodes").click());
  expect(button("pick")).toBeDefined();
});

it("retains the selected saved view after returning from a task", async () => {
  await act(async () => button("change view").click());
  await act(async () => button("pick").click());
  await act(async () => button("crewTasks.back").click());
  expect(host.textContent).toContain("selected-view");
});

it("passes the selected task view into staged creation", async () => {
  await act(async () => button("change view").click());
  await act(async () => button("taskCreate.title").click());
  expect(h.workbench).toHaveBeenLastCalledWith(
    expect.objectContaining({ viewId: "selected-view" })
  );
});

it("opens native label management and returns to tasks", async () => {
  await act(async () => button("taskLabels.title").click());
  expect(button("close labels")).toBeTruthy();
  await act(async () => button("close labels").click());
  expect(button("pick")).toBeTruthy();
});

it("opens native cycle management and returns to tasks", async () => {
  await act(async () => button("taskCycles.title").click());
  expect(button("close cycles")).toBeTruthy();
  await act(async () => button("close cycles").click());
  expect(button("pick")).toBeTruthy();
});

it("opens native workflow management and returns to tasks", async () => {
  await act(async () => button("taskWorkflowManagement.title").click());
  expect(button("close workflows")).toBeTruthy();
  await act(async () => button("close workflows").click());
  expect(button("taskWorkflowManagement.title")).toBeTruthy();
});

it("opens native Studio workspace management and returns to tasks", async () => {
  await act(async () => button("crewStudio.title").click());
  expect(button("close workspace")).toBeTruthy();
  await act(async () => button("close workspace").click());
  expect(button("crewStudio.title")).toBeTruthy();
});

it("opens native Studio media and returns to tasks", async () => {
  await act(async () => button("studioMedia.title").click());
  expect(button("close studio media")).toBeTruthy();
  await act(async () => button("close studio media").click());
  expect(button("studioMedia.title")).toBeTruthy();
});

it("opens asset organization and returns to tasks", async () => {
  await act(async () => button("assetOrganization.title").click());
  expect(button("close asset organization")).toBeTruthy();
  await act(async () => button("close asset organization").click());
  expect(button("assetOrganization.title")).toBeTruthy();
});
it("opens native member directory and returns to tasks", async () => {
  await act(async () => button("crewMembers.title").click());
  expect(button("close members")).toBeTruthy();
  await act(async () => button("close members").click());
  expect(button("pick")).toBeTruthy();
});

it("exits the Crew workspace after ownership transfer", async () => {
  await act(async () => button("crewMembers.title").click());
  await act(async () => button("transfer complete").click());
  expect(h.close).toHaveBeenCalledTimes(1);
});

it("opens project properties and returns to tasks", async () => {
  await act(async () => button("projectProperties.title").click());
  await act(async () => button("close properties").click());
  expect(button("pick")).toBeTruthy();
});

it("opens native project resources and returns", async () => {
  await act(async () => button("projectResources.title").click());
  await act(async () => button("close resources").click());
  expect(button("pick")).toBeTruthy();
});

it("opens project overview and returns to the existing task browser", async () => {
  await act(async () => button("projectDocument.title").click());
  expect(button("close document")).toBeDefined();
  await act(async () => button("close document").click());
  expect(button("pick")).toBeDefined();
});
it("opens project activity and returns to the existing task browser", async () => {
  await act(async () => button("projectActivity.title").click());
  expect(button("close activity")).toBeDefined();
  await act(async () => button("close activity").click());
  expect(button("pick")).toBeDefined();
});

it("opens trust appeals from the native task menu and returns without entering the Web fallback", async () => {
  expect(button("trustAppeals.queue")).toBeDefined();
  await act(async () => button("trustAppeals.queue").click());
  expect(button("close appeals")).toBeDefined();
  expect(host.textContent).not.toContain("/workspace");
  await act(async () => button("close appeals").click());
  expect(button("pick")).toBeDefined();
});
it("does not open appeal data after an account switch", async () => {
  h.generation = 2;
  await act(async () => button("trustAppeals.queue").click());
  expect(button("close appeals")).toBeUndefined();
});
it("opens a notification's initial task through the normal authorized detail component", async () => {
  await act(async () =>
    root.render(
      <CrewTaskBrowser
        key="notification"
        crewId="crew"
        userId="1"
        generation={1}
        initialTaskId="notification-task"
        onClose={h.close}
      />
    )
  );
  expect(h.detail).toHaveBeenLastCalledWith(
    expect.objectContaining({
      crewId: "crew",
      taskId: "notification-task",
      generation: 1,
      userId: "1",
    })
  );
});
it("opens the native member panel for member notification destinations", async () => {
  await act(async () =>
    root.render(
      <CrewTaskBrowser
        key="members-link"
        crewId="crew"
        userId="1"
        generation={1}
        initialSection="members"
        onClose={h.close}
      />
    )
  );
  expect(button("close members")).toBeTruthy();
  expect(h.detail).not.toHaveBeenCalled();
  await act(async () => button("close members").click());
  expect(button("close members")).toBeUndefined();
});

it("opens both native chat channels and blocks stale-account navigation", async () => {
  await act(async () =>
    root.render(<CrewTaskBrowser crewId="crew" userId="1" generation={1} onClose={h.close} />)
  );
  await act(async () => button("thread.teamChat").click());
  expect(h.push).toHaveBeenLastCalledWith("/crew-chat/crew?channel=team");
  await act(async () => button("thread.communityChat").click());
  expect(h.push).toHaveBeenLastCalledWith("/crew-chat/crew?channel=community");
  h.generation = 2;
  await act(async () => button("thread.teamChat").click());
  expect(h.push).toHaveBeenCalledTimes(2);
});

it("opens guided Crew setup from existing task tools and returns for assignments", async () => {
  await act(async () => button("crewSetup.title").click());
  expect(button("setup assignments")).toBeDefined();
  await act(async () => button("setup assignments").click());
  expect(button("pick")).toBeDefined();
});

it("opens guided setup directly after successful Crew creation", async () => {
  await act(async () =>
    root.render(
      <CrewTaskBrowser
        key="created"
        crewId="crew"
        userId="1"
        generation={1}
        initialSection="setup"
        onClose={h.close}
      />
    )
  );
  expect(button("setup assignments")).toBeDefined();
  await act(async () => button("setup assignments").click());
  expect(button("pick")).toBeDefined();
});
it("opens the workspace editor directly from Crew resources", async () => {
  await act(async () =>
    root.render(
      <CrewTaskBrowser
        crewId="crew"
        userId="1"
        generation={1}
        key="studio-entry"
        initialSection="studio"
        onClose={h.close}
      />
    )
  );
  expect(button("close workspace")).toBeDefined();
  await act(async () => button("close workspace").click());
  expect(h.close).toHaveBeenCalledTimes(1);
});
