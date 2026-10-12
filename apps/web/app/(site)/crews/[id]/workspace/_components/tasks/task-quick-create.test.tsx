// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CreateCrewTaskInput,
  CrewMemberDTO,
  CrewTaskDTO,
  CrewTaskProjectDTO,
  CrewTaskViewDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { TaskQuickCreate } from "./task-quick-create";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  create: vi.fn(),
  draft: vi.fn(),
  resetDraft: vi.fn(),
  resetCreate: vi.fn(),
}));

vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: "local-creator" } }),
}));
vi.mock("./task-delivery-upload", () => ({
  TaskDeliveryUpload: ({
    onUploaded,
    onBusyChange,
  }: {
    onUploaded: (file: { id: string; name: string }) => void;
    onBusyChange: (busy: boolean) => void;
  }) => (
    <>
      <button onClick={() => onBusyChange(true)}>Start contract upload</button>
      <button
        onClick={() => {
          onBusyChange(false);
          onUploaded({ id: "contract-file", name: "Terms.pdf" });
        }}
      >
        Finish contract upload
      </button>
    </>
  ),
}));
vi.mock("@/app/(site)/crews/_components/required-skills-select", () => ({
  RequiredSkillsSelect: () => null,
}));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ selected, onSelect }: { selected?: Date; onSelect: (date?: Date) => void }) => (
    <input
      type="date"
      aria-label="Calendar selection"
      value={
        selected
          ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`
          : ""
      }
      onChange={(event) =>
        onSelect(event.target.value ? new Date(`${event.target.value}T12:00:00`) : undefined)
      }
    />
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/src/i18n/i18n", async () => {
  const catalog = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useLocale: () => "en-US",
    useTranslations:
      (namespace: string) =>
      (key: string, args: Record<string, unknown> = {}) => {
        const value = `${namespace}.${key}`
          .split(".")
          .reduce<unknown>(
            (current, segment) => (current as Record<string, unknown>)?.[segment],
            catalog
          );
        return typeof value === "string"
          ? value.replace(/\{\{?(\w+)\}?\}/g, (_, name: string) => String(args[name] ?? name))
          : key;
      },
  };
});
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map([["member-1", { userId: "member-1", nickname: "Isaac" }]]),
  displayNameOf: (userId: string) => (userId === "member-1" ? "Isaac" : userId),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCreateCrewTask: () => ({
    mutateAsync: state.create,
    reset: state.resetCreate,
    isPending: false,
  }),
  useDraftCrewTask: () => ({
    mutateAsync: state.draft,
    reset: state.resetDraft,
    data: null,
    isPending: false,
  }),
  useCrewEpisodes: () => ({
    data: [
      { id: "episode-one", number: 1, title: "Opening", status: "active" },
      { id: "episode-two", number: 2, title: "Opening", status: "active" },
    ],
    isLoading: false,
  }),
  useCrewTaskKindTemplates: () => ({ data: { items: [] }, isLoading: false }),
  useCrewTaskOptions: () => ({ data: [] }),
  CREW_TASK_KINDS: [
    "script",
    "gameplay",
    "plot_tree",
    "art",
    "storyboard",
    "voice",
    "music",
    "edit",
    "qa",
    "other",
  ],
  CREW_TASK_KIND_MESSAGE_KEYS: {
    script: "taskKindScript",
    gameplay: "taskKindGameplay",
    plot_tree: "taskKindPlotTree",
    art: "taskKindArt",
    storyboard: "taskKindStoryboard",
    voice: "taskKindVoice",
    music: "taskKindMusic",
    edit: "taskKindEdit",
    qa: "taskKindQa",
    other: "taskKindOther",
  },
}));

const member = {
  id: "crew-member-1",
  crewId: "crew-1",
  userId: "member-1",
  status: "active",
  joinedVia: "invitation",
  isOwner: false,
  positions: [],
  policyKeys: [],
  joinedAt: "2026-08-01T00:00:00.000Z",
  removedAt: null,
  version: 1,
} as CrewMemberDTO;

const project = {
  crewId: "crew-1",
  cycles: [],
  fields: [],
  labels: [],
  workflowStates: [
    {
      id: "workflow-open",
      systemKey: "open",
      semantic: "open",
      archived: false,
    },
  ],
} as unknown as CrewTaskProjectDTO;

const view = {
  id: "view-backlog",
  filters: {},
} as unknown as CrewTaskViewDTO;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderQuickCreate(
  onCreated = vi.fn(),
  onOpenChange = vi.fn(),
  taskProject = project,
  context: {
    open?: boolean;
    initialInput?: CreateCrewTaskInput;
    onSave?: (input: CreateCrewTaskInput) => Promise<CrewTaskDTO>;
    crewId?: string;
    crewName?: string;
    parentId?: string;
    activeView?: CrewTaskViewDTO;
    presetEpisodeId?: string;
    onStage?: (input: CreateCrewTaskInput) => void;
    onCreateStaged?: (input: CreateCrewTaskInput) => Promise<CrewTaskDTO>;
    onPublishTask?: (taskId: string) => void;
    onInviteTask?: (task: CrewTaskDTO) => void;
  } = {}
) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() =>
    root!.render(
      <TaskQuickCreate
        open
        onOpenChange={onOpenChange}
        presetTaskKind="script"
        crewId="crew-1"
        members={[member]}
        project={taskProject}
        activeView={view}
        onCreated={onCreated}
        {...context}
      />
    )
  );
  if (context.open === false) return;
  const brief = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Brief"]');
  if (brief && !brief.value) act(() => fill(brief, "Deliver a reviewable task."));
  const reward = document.querySelector<HTMLInputElement>('input[aria-label="Reward (USD)"]');
  if (reward && !reward.value) act(() => fill(reward, "100"));
  if (!context.initialInput?.dueAt) {
    act(() => click(document.querySelector('button[aria-label="Due Date"]')!));
    const date = document.querySelector<HTMLInputElement>('input[aria-label="Calendar selection"]');
    if (date) act(() => fill(date, "2099-10-03"));
  }
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string) {
  const match = [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label)
  );
  if (!match) throw new Error(`No button labelled “${label}”.`);
  return match;
}

function exactButton(label: string) {
  const match = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!match) throw new Error(`No button exactly labelled “${label}”.`);
  return match;
}

beforeEach(() => {
  // jsdom has no layout scrolling; Radix uses this when focusing select options.
  Element.prototype.scrollIntoView = vi.fn();
  state.create.mockReset();
  state.draft.mockReset();
  state.resetDraft.mockReset();
  state.create.mockResolvedValue({ id: "task-created" } as CrewTaskDTO);
  state.draft.mockResolvedValue({
    title: "Finish the first-act storyboard",
    description: "Deliver a reviewable storyboard.",
    priority: "high",
    startDate: null,
    dueDate: "2026-08-07",
    estimatePoints: 8,
    computeBudgetPoints: 500,
    revisionLimit: null,
    cycleId: null,
    parentId: null,
    blockedByTaskIds: [],
    assigneeUserIds: ["member-1"],
    questions: [],
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("TaskQuickCreate", () => {
  it.each(["missing", "cancelled"])(
    "ignores a %s cycle in the saved view default",
    async (kind) => {
      const taskProject = {
        ...project,
        cycles: [
          { id: "current", name: "Current", status: "active" },
          ...(kind === "cancelled" ? [{ id: "stale", name: "Old", status: "cancelled" }] : []),
        ],
      } as unknown as CrewTaskProjectDTO;
      renderQuickCreate(vi.fn(), vi.fn(), taskProject, {
        activeView: { ...view, filters: { cycleIds: ["stale"] } },
      });
      act(() =>
        fill(
          document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
          "Review a shot"
        )
      );
      await act(async () => {
        click(exactButton("Create"));
      });
      expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ cycleId: "current" }));
    }
  );

  it("uses Backlog when a stale view cycle has no active replacement", async () => {
    renderQuickCreate(vi.fn(), vi.fn(), project, {
      activeView: { ...view, filters: { cycleIds: ["removed"] } },
    });
    act(() =>
      fill(
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
        "Review a shot"
      )
    );
    await act(async () => {
      click(exactButton("Create"));
    });
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ cycleId: null }));
  });

  it("retains a valid filtered cycle ahead of the active default", async () => {
    const taskProject = {
      ...project,
      cycles: [
        { id: "current", name: "Current", status: "active" },
        { id: "planned", name: "Upcoming", status: "planned" },
      ],
    } as unknown as CrewTaskProjectDTO;
    renderQuickCreate(vi.fn(), vi.fn(), taskProject, {
      activeView: { ...view, filters: { cycleIds: ["planned"] } },
    });
    act(() =>
      fill(
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
        "Review a shot"
      )
    );
    await act(async () => {
      click(exactButton("Create"));
    });
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ cycleId: "planned" }));
  });

  it("recomputes an implicit cycle after refresh without losing the title or assignee", async () => {
    const taskProject = {
      ...project,
      cycles: [
        { id: "current", name: "Current", status: "active" },
        { id: "filtered", name: "Filtered", status: "planned" },
      ],
    } as unknown as CrewTaskProjectDTO;
    const context = { activeView: { ...view, filters: { cycleIds: ["filtered"] } } };
    renderQuickCreate(vi.fn(), vi.fn(), taskProject, context);
    act(() =>
      fill(
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
        "Keep my assignment"
      )
    );
    await act(async () => click(document.querySelector('button[aria-label="Assignees"]')!));
    const assignee = [...document.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent?.trim() === "Isaac"
    );
    await act(async () => click(assignee!));
    renderQuickCreate(
      vi.fn(),
      vi.fn(),
      {
        ...taskProject,
        cycles: taskProject.cycles.map((cycle) =>
          cycle.id === "filtered" ? { ...cycle, status: "cancelled" } : cycle
        ),
      },
      context
    );
    await act(async () => click(exactButton("Create")));
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Keep my assignment",
        cycleId: "current",
        assignees: [{ userId: "member-1", currency: "USD" }],
      })
    );
  });

  it("creates a minimal task from the compact issue composer", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderQuickCreate(onCreated, onOpenChange);

    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!;
    act(() => fill(input, "Review episode one animatic"));
    await act(async () => {
      click(exactButton("Create"));
      await Promise.resolve();
    });

    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Review episode one animatic",
        description: "Deliver a reviewable task.",
        priority: "normal",
        workflowStateId: "workflow-open",
        assignees: [],
      })
    );
    expect(onCreated).toHaveBeenCalledWith({ id: "task-created" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resets the composer without closing it when create another is enabled", async () => {
    const onOpenChange = vi.fn();
    renderQuickCreate(vi.fn(), onOpenChange);

    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!;
    act(() => {
      fill(input, "Create a second storyboard pass");
      click(document.querySelector('button[role="switch"]')!);
    });
    await act(async () => {
      click(exactButton("Create"));
      await Promise.resolve();
    });

    expect(state.create).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(input.value).toBe("");
  });

  it("keeps AI output as an editable draft until the user confirms", async () => {
    renderQuickCreate();

    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!;
    act(() => fill(input, "Isaac should finish the first-act storyboard next Friday"));

    await act(async () => {
      click(button("Organize with AI"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.draft).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("Finish the first-act storyboard");
    expect(state.create).not.toHaveBeenCalled();

    await act(async () => {
      click(exactButton("Create"));
      await Promise.resolve();
    });
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Finish the first-act storyboard",
        description: "Deliver a reviewable storyboard.",
        estimatePoints: null,
      })
    );
    expect(state.create.mock.calls[0]![0]).not.toHaveProperty("computeBudgetPoints");
  });
  it.each(["Task Title", "Task Brief"])(
    "preserves edits to %s made while AI preparation runs",
    async (label) => {
      let finish!: (value: unknown) => void;
      state.draft.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      renderQuickCreate();
      const title = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Task Title"]'
      )!;
      act(() => fill(title, "Original prompt"));

      await act(async () => click(button("Organize with AI")));
      const input = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
      act(() => fill(input, "Newer user text"));
      await act(async () =>
        finish({
          title: "Old AI title",
          description: "Old AI brief",
          priority: "high",
          assigneeUserIds: [],
          dueDate: null,
          questions: [],
        })
      );
      expect(input.value).toBe("Newer user text");
      expect(title.value).not.toBe("Old AI title");
      await act(async () => click(exactButton("Create")));
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: label === "Task Title" ? "Newer user text" : "Original prompt",
          description: label === "Task Brief" ? "Newer user text" : "Deliver a reviewable task.",
        })
      );
    }
  );

  it.each(["deadline", "priority", "assignee"])(
    "preserves a %s choice made during AI preparation",
    async (field) => {
      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      let finish!: (value: unknown) => void;
      state.draft.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      renderQuickCreate(vi.fn(), vi.fn(), {
        ...project,
        cycles: [{ id: "cycle-user", name: "Chosen cycle", status: "planned" }],
      } as unknown as CrewTaskProjectDTO);
      const title = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Task Title"]'
      )!;
      act(() => fill(title, "Current title"));

      await act(async () => click(button("Organize with AI")));
      if (field === "deadline") {
        await act(async () => click(document.querySelector('button[aria-label="Due Date"]')!));
        act(() =>
          fill(document.querySelector<HTMLInputElement>('input[type="date"]')!, futureDate)
        );
      } else {
        const label = field === "priority" ? "Priority" : "Assignees";
        await act(async () => click(document.querySelector(`button[aria-label="${label}"]`)!));
        const text = field === "priority" ? "Low" : "Isaac";
        const option = [...document.querySelectorAll('[role="option"]')].find(
          (item) => item.textContent?.trim() === text
        );
        expect(option).toBeDefined();
        await act(async () => click(option!));
      }
      await act(async () =>
        finish({
          title: "Old AI title",
          description: "Old AI brief",
          priority: "high",
          assigneeUserIds: [],
          cycleId: null,
          dueDate: "2026-09-01",
          questions: [],
        })
      );
      expect(title.value).toBe("Current title");
      await act(async () => click(exactButton("Create")));
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ...(field === "deadline"
            ? { dueAt: new Date(`${futureDate}T23:59:59`).toISOString() }
            : {}),
          ...(field === "priority" ? { priority: "low" } : {}),
          ...(field === "assignee" ? { assignees: [{ userId: "member-1", currency: "USD" }] } : {}),
        })
      );
    }
  );

  it("ignores AI results from a closed composer session", async () => {
    let finish!: (value: unknown) => void;
    state.draft.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderQuickCreate(onCreated, onOpenChange);
    act(() =>
      fill(
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
        "Old prompt"
      )
    );

    await act(async () => click(button("Organize with AI")));
    renderQuickCreate(onCreated, onOpenChange, project, { open: false });
    renderQuickCreate(onCreated, onOpenChange);
    const title = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!;
    expect(title.value).toBe("");
    act(() => fill(title, "New session"));
    await act(async () =>
      finish({
        title: "Old AI title",
        description: "Old AI brief",
        priority: "normal",
        assigneeUserIds: [],
        questions: [],
      })
    );
    expect(title.value).toBe("New session");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not clear a new composer or release its pending guard when an old creation finishes", async () => {
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    state.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    );
    state.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finishNew = resolve;
      })
    );
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderQuickCreate(onCreated, onOpenChange);
    act(() =>
      fill(
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
        "Old task"
      )
    );
    act(() => click(exactButton("Create")));
    renderQuickCreate(onCreated, onOpenChange, project, { open: false });
    renderQuickCreate(onCreated, onOpenChange);
    const title = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!;
    act(() => fill(title, "New task"));
    act(() => click(exactButton("Create")));
    expect(state.create).toHaveBeenCalledTimes(2);
    await act(async () => finishOld({ id: "old-task" }));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(title.value).toBe("New task");
    act(() => click(exactButton("Create")));
    expect(state.create).toHaveBeenCalledTimes(2);
    await act(async () => finishNew({ id: "new-task" }));
    expect(onCreated).toHaveBeenCalledExactlyOnceWith({ id: "new-task" });
  });

  it.each([{ crewId: "crew-2" }, { parentId: "parent-2" }])(
    "clears draft text when the creation context changes: %j",
    (context) => {
      renderQuickCreate();
      act(() =>
        fill(
          document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
          "Previous context"
        )
      );
      renderQuickCreate(vi.fn(), vi.fn(), project, context);
      expect(
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!.value
      ).toBe("");
    }
  );

  it.each(["ctrlKey", "metaKey"] as const)(
    "ignores repeated %s+Enter while task creation is pending and allows a retry after failure",
    async (modifier) => {
      let fail!: (error: Error) => void;
      state.create.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          fail = reject;
        })
      );
      renderQuickCreate();
      const input = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Task Title"]'
      )!;
      act(() => fill(input, "Create only once"));
      const shortcut = () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            [modifier]: true,
            bubbles: true,
          })
        );
      act(() => {
        shortcut();
        shortcut();
        click(exactButton("Create"));
      });
      expect(state.create).toHaveBeenCalledTimes(1);
      await act(async () => fail(new Error("Temporary failure")));
      expect(input.value).toBe("Create only once");
      await act(async () => {
        shortcut();
      });
      expect(state.create).toHaveBeenCalledTimes(2);
    }
  );

  it("ignores creation shortcuts and repeated draft requests until AI preparation finishes", async () => {
    let finish!: (draft: unknown) => void;
    state.draft.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    renderQuickCreate();
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!;
    act(() => fill(input, "Prepare this task"));

    act(() => {
      click(button("Organize with AI"));
      click(button("Organize with AI"));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
      );
    });
    expect(state.draft).toHaveBeenCalledTimes(1);
    expect(state.create).not.toHaveBeenCalled();
    await act(async () =>
      finish({
        title: "Prepared title",
        description: "Prepared brief",
        priority: "normal",
        assigneeUserIds: ["member-1"],
        questions: [],
      })
    );
    await act(async () => click(exactButton("Create")));
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Prepared title",
        description: "Prepared brief",
      })
    );
  });
  it.each(["", "2099-09-25"])("respects the user changing a deadline to %s", async (date) => {
    renderQuickCreate();
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!;
    act(() => fill(input, "Prepare storyboard"));
    await act(async () => click(button("Organize with AI")));
    await act(async () => click(document.querySelector('button[aria-label="Due Date"]')!));
    const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    act(() => fill(dateInput, date));
    await act(async () => click(exactButton("Create")));
    if (!date) {
      expect(state.create).not.toHaveBeenCalled();
      return;
    }
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: date ? new Date(`${date}T23:59:59`).toISOString() : null,
      })
    );
  });
  it("shows a custom workflow name instead of its generic semantic status", () => {
    renderQuickCreate(vi.fn(), vi.fn(), {
      ...project,
      workflowStates: [
        {
          ...project.workflowStates[0]!,
          id: "custom-review",
          systemKey: null,
          semantic: "open",
          name: "Producer briefing",
        },
      ],
    });
    expect(document.body.textContent).toContain("Producer briefing");
  });
});

it("submits a manually selected assignee and preserves it after server rejection", async () => {
  state.create
    .mockRejectedValueOnce(new Error("Every assignee must be an active crew member."))
    .mockResolvedValueOnce({ id: "task-created" });
  renderQuickCreate();
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Assigned task"
    )
  );
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Assignees"]');
  expect(trigger).not.toBeNull();
  await act(async () =>
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  );
  const option = [...document.querySelectorAll('[role="option"]')].find((element) =>
    element.textContent?.includes("Isaac")
  );
  expect(option).toBeDefined();
  await act(async () =>
    option!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  );
  await act(async () => click(exactButton("Create")));
  expect(state.create).toHaveBeenLastCalledWith(
    expect.objectContaining({ assignees: [expect.objectContaining({ userId: "member-1" })] })
  );
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!.value
  ).toBe("Assigned task");
  await act(async () => click(exactButton("Create")));
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.create.mock.calls[1]![0].assignees).toEqual(
    state.create.mock.calls[0]![0].assignees
  );
});

it("stages once without posting and preserves the preset episode", async () => {
  const stage = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, { presetEpisodeId: "episode-one", onStage: stage });
  act(() => fill(document.querySelector<HTMLTextAreaElement>("textarea")!, "Review storyboard"));
  await act(async () => {
    click(exactButton("Add task"));
    click(exactButton("Add task"));
  });
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Review storyboard", episodeId: "episode-one" })
  );
  expect(state.create).not.toHaveBeenCalled();
});

it("reopens a staged task, saves edits and preserves unexposed planning fields", async () => {
  const stage = vi.fn();
  const input: CreateCrewTaskInput = {
    title: "Script",
    description: "Original brief",
    priority: "high",
    taskKind: "script",
    workflowStateId: "workflow-open",
    episodeId: "episode-one",
    cycleId: null,
    labelIds: [],
    assignees: [{ userId: "member-1", currency: "USD", rewardAmountMinor: 500 }],
    estimatePoints: 8,
    paymentTerms: "monthly",
    rewardUsdMinor: 3025,
    profitShareBps: 250,
    revisionLimit: 2,
    startAt: "2026-10-01T02:00:00.000Z",
    dueAt: "2099-10-03T15:59:59.000Z",
    blockedByTaskIds: ["previous"],
    customFieldValues: [{ fieldId: "brief", value: "Keep me" }],
  };
  renderQuickCreate(vi.fn(), vi.fn(), project, { initialInput: input, onStage: stage });
  const areas = document.querySelectorAll("textarea");
  expect(areas[0]?.value).toBe("Script");
  expect(areas[1]?.value).toBe("Original brief");
  await act(async () => {
    fill(areas[0]!, "Updated Script");
    fill(areas[1]!, "Updated brief");
  });
  await act(async () => click(exactButton("Save Changes")));
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage).toHaveBeenCalledWith(
    expect.objectContaining({ ...input, title: "Updated Script", description: "Updated brief" })
  );
  expect(state.create).not.toHaveBeenCalled();
});

it("saves reward and restored profit share exactly", async () => {
  const stage = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, { onStage: stage });
  act(() => {
    fill(document.querySelector<HTMLTextAreaElement>("textarea")!, "Paid script");
    fill(document.querySelector<HTMLInputElement>('input[aria-label="Reward (USD)"]')!, "30.25");
    fill(document.querySelector<HTMLInputElement>('input[aria-label="Profit share (%)"]')!, "2.5");
  });
  await act(async () => click(exactButton("Add task")));
  expect(stage).toHaveBeenCalledWith(
    expect.objectContaining({ rewardUsdMinor: 3025, profitShareBps: 250 })
  );
});

it.each(["-1", "1000000001", "0.001", "abc", "1e3"])(
  "rejects invalid reward input %s without replacing the previous amount",
  async (value) => {
    const stage = vi.fn();
    renderQuickCreate(vi.fn(), vi.fn(), project, { onStage: stage });
    act(() => {
      fill(document.querySelector<HTMLTextAreaElement>("textarea")!, "Paid script");
      fill(document.querySelector<HTMLInputElement>('input[aria-label="Reward (USD)"]')!, value);
    });
    await act(async () => click(exactButton("Add task")));
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({ rewardUsdMinor: 10000 }));
    expect(state.create).not.toHaveBeenCalled();
  }
);

it("preserves a staged effort estimate when AI organizes the brief", async () => {
  const stage = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, {
    initialInput: {
      title: "Script",
      description: "Original brief",
      priority: "normal",
      assignees: [],
      estimatePoints: 13,
    },
    onStage: stage,
  });
  await act(async () => {
    click(button("Organize with AI"));
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => click(exactButton("Save Changes")));
  expect(stage).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Finish the first-act storyboard",
      description: "Deliver a reviewable storyboard.",
      estimatePoints: 13,
    })
  );
});

it("rejects an expired deadline restored from a saved draft", async () => {
  const stage = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, {
    onStage: stage,
    initialInput: {
      title: "Expired task",
      description: "Brief",
      priority: "normal",
      assignees: [],
      dueAt: "2000-01-01T23:59:59.000Z",
    } as CreateCrewTaskInput,
  });
  await act(async () => click(exactButton("Save Changes")));
  expect(stage).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
});

it("saves and opens the publishing form directly from Recruit Creators", async () => {
  const publish = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, { onPublishTask: publish });
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Open role"
    )
  );
  await act(async () => {
    click(exactButton("Recruit Creators"));
    await Promise.resolve();
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledWith("task-created");
});

it("lets recruitment replace a selected assignee before publishing", async () => {
  const publish = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, { onPublishTask: publish });
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Open role"
    )
  );
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Assignees"]')!;
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  );
  const option = [...document.querySelectorAll('[role="option"]')].find((element) =>
    element.textContent?.includes("Isaac")
  )!;
  await act(async () =>
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  );
  await act(async () => {
    click(exactButton("Recruit Creators"));
    await Promise.resolve();
  });
  expect(state.create).toHaveBeenLastCalledWith(expect.objectContaining({ assignees: [] }));
  expect(publish).toHaveBeenCalledWith("task-created");
});

it("omits episode editing while preserving the task's episode association", async () => {
  renderQuickCreate(vi.fn(), vi.fn(), project, { presetEpisodeId: "episode-two" });
  expect(document.querySelector('[aria-label="Episode"]')).toBeNull();
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Episode task"
    )
  );
  await act(async () => click(exactButton("Create")));
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ episodeId: "episode-two" }));
});
it("blocks a stale episode instead of silently assigning a different episode", async () => {
  renderQuickCreate(vi.fn(), vi.fn(), project, { presetEpisodeId: "deleted-episode" });
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Episode task"
    )
  );
  await act(async () => click(exactButton("Create")));
  expect(state.create).not.toHaveBeenCalled();
});

it("recruits a staged draft through the durable workbench creation path", async () => {
  const publish = vi.fn(),
    stage = vi.fn();
  const createStaged = vi.fn().mockResolvedValue({ id: "staged-created" });
  renderQuickCreate(vi.fn(), vi.fn(), project, {
    onPublishTask: publish,
    onStage: stage,
    onCreateStaged: createStaged,
  });
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Recruit editor"
    )
  );
  await act(async () => click(exactButton("Recruit Creators")));
  expect(createStaged).toHaveBeenCalledTimes(1);
  expect(createStaged).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Recruit editor", assignees: [] })
  );
  expect(state.create).not.toHaveBeenCalled();
  expect(stage).not.toHaveBeenCalled();
  expect(publish).toHaveBeenCalledWith("staged-created");
});

it("attaches the uploaded contract and blocks creation while it uploads", async () => {
  renderQuickCreate();
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Contract task"
    )
  );
  await act(async () => click(exactButton("Start contract upload")));
  expect(exactButton("Create").disabled).toBe(true);
  await act(async () => click(exactButton("Finish contract upload")));
  expect(document.body.textContent).toContain("Terms.pdf");
  await act(async () => click(exactButton("Create")));
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({ contractAssetNodeId: "contract-file" })
  );
});
it("clears interrupted upload state when switching crews", async () => {
  renderQuickCreate();
  await act(async () => click(exactButton("Start contract upload")));
  renderQuickCreate(vi.fn(), vi.fn(), project, { crewId: "crew-2" });
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "New crew task"
    )
  );
  expect(exactButton("Create").disabled).toBe(false);
  await act(async () => click(exactButton("Create")));
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ contractAssetNodeId: null }));
});

it.each(["Task Brief", "Reward (USD)"])("blocks an empty required %s", async (label) => {
  renderQuickCreate();
  act(() =>
    fill(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!, "Task")
  );
  act(() =>
    fill(
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!,
      ""
    )
  );
  await act(async () => click(exactButton("Create")));
  expect(state.create).not.toHaveBeenCalled();
});

it("keeps assignment visible and names the default priority", () => {
  renderQuickCreate();
  const assignee = document.querySelector('[aria-label="Assignees"]');
  expect(assignee).not.toBeNull();
  expect(assignee!.closest("details")).toBeNull();
  expect(document.querySelector('[aria-label="Priority"]')?.textContent).toContain("Normal");
});

it("shows immutable Crew context without the redundant recruitment note", () => {
  renderQuickCreate(vi.fn(), vi.fn(), project, { crewName: "Film Crew", onPublishTask: vi.fn() });
  expect(document.querySelector('[aria-label="Crew"]')?.textContent).toContain("Film Crew");
  expect(document.querySelector('input[aria-label="Crew"], button[aria-label="Crew"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Save this task and continue to the job form.");
});

it("stages the selected payment terms alongside the reward", async () => {
  const stage = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, { onStage: stage });
  act(() => fill(document.querySelector<HTMLTextAreaElement>("textarea")!, "Paid script"));
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Payment terms"]')!;
  await act(async () => click(trigger));
  const option = [...document.querySelectorAll('[role="option"]')].find((node) =>
    node.textContent?.includes("Reward 50% Upfront")
  );
  expect(option).toBeDefined();
  await act(async () =>
    option!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  );
  await act(async () => click(exactButton("Add task")));
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({ paymentTerms: "half_upfront" }));
});

it("creates an unassigned task before opening its invitation and preserves payment timing", async () => {
  const invite = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, {
    onInviteTask: invite,
    initialInput: {
      title: "Invite an editor",
      description: "Edit the scene",
      taskKind: "script",
      priority: "normal",
      assignees: [{ userId: "member", currency: "USD" }],
      rewardUsdMinor: 10000,
      paymentTerms: "half_upfront",
      dueAt: "2099-10-03T00:00:00Z",
    } as CreateCrewTaskInput,
  });
  await act(async () => {
    click(exactButton("Create & invite"));
    await Promise.resolve();
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({ assignees: [], paymentTerms: "half_upfront" })
  );
  expect(invite).toHaveBeenCalledExactlyOnceWith({ id: "task-created" });
});
it("does not open invitations when task creation fails", async () => {
  const invite = vi.fn();
  state.create.mockRejectedValueOnce(new Error("Cannot create task"));
  renderQuickCreate(vi.fn(), vi.fn(), project, { onInviteTask: invite });
  act(() =>
    fill(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task Title"]')!,
      "Invite editor"
    )
  );
  await act(async () => {
    click(exactButton("Create & invite"));
    await Promise.resolve();
  });
  expect(invite).not.toHaveBeenCalled();
});

it("does not inherit an approved workflow filter when creating a new task", () => {
  renderQuickCreate(
    vi.fn(),
    vi.fn(),
    {
      ...project,
      workflowStates: [
        ...project.workflowStates,
        {
          ...project.workflowStates[0]!,
          id: "already-approved",
          semantic: "approved",
          systemKey: "approved",
          name: "Already approved",
        },
      ],
    },
    {
      activeView: { ...view, filters: { ...view.filters, workflowStateIds: ["already-approved"] } },
    }
  );
  expect(document.querySelector('[aria-label="Planning State"]')?.textContent).not.toContain(
    "Already approved"
  );
  expect(document.querySelector('[aria-label="Planning State"]')).not.toBeNull();
});

it("edits an existing task in the populated creation form without creating another task", async () => {
  const save = vi.fn().mockResolvedValue({ id: "existing" });
  const close = vi.fn();
  renderQuickCreate(vi.fn(), close, project, {
    onSave: save,
    initialInput: {
      title: "Existing script",
      description: "Original requirements",
      priority: "high",
      taskKind: "script",
      workflowStateId: "workflow-open",
      dueAt: "2020-01-01T15:59:59.000Z",
      rewardUsdMinor: 3025,
      paymentTerms: "monthly",
      assignees: [{ userId: "member-1", currency: "USD", rewardAmountMinor: 500 }],
    },
  });
  const areas = document.querySelectorAll("textarea");
  expect(areas[0]?.value).toBe("Existing script");
  expect(areas[1]?.value).toBe("Original requirements");
  await act(async () => {
    fill(areas[1]!, "Updated requirements");
    const button = Array.from(document.querySelectorAll("button")).find((b) =>
      /save changes/i.test(b.textContent ?? "")
    )!;
    button.click();
  });
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      description: "Updated requirements",
      rewardUsdMinor: 3025,
      paymentTerms: "monthly",
      dueAt: "2020-01-01T15:59:59.000Z",
    })
  );
  expect(state.create).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledWith(false);
});

it("preserves the chosen Art subtype when editing a task", async () => {
  const stage = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, {
    initialInput: {
      title: "Library",
      description: "Design the library",
      taskKind: "art",
      assetCategory: "scenes",
      priority: "normal",
      workflowStateId: "workflow-open",
      rewardUsdMinor: 10000,
      dueAt: "2099-10-03T00:00:00.000Z",
      assignees: [],
      labelIds: [],
    },
    onStage: stage,
  });
  await act(async () => click(exactButton("Save Changes")));
  expect(stage).toHaveBeenCalledWith(
    expect.objectContaining({ taskKind: "art", assetCategory: "scenes" })
  );
});

it("saves a revenue-share-only task without inventing a cash amount", async () => {
  const stage = vi.fn();
  renderQuickCreate(vi.fn(), vi.fn(), project, { onStage: stage });
  act(() => {
    fill(document.querySelector<HTMLTextAreaElement>("textarea")!, "Revenue-share film");
    fill(document.querySelector<HTMLInputElement>('input[aria-label="Reward (USD)"]')!, "");
    fill(document.querySelector<HTMLInputElement>('input[aria-label="Profit share (%)"]')!, "1");
  });
  await act(async () => click(exactButton("Add task")));
  expect(stage).toHaveBeenCalledWith(
    expect.objectContaining({ rewardUsdMinor: null, profitShareBps: 100 })
  );
});
