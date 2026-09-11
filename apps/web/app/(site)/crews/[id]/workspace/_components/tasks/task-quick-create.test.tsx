// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
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
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/src/i18n/i18n", async () => {
  const catalog = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useLocale: () => "en-US",
    useTranslations: (namespace: string) => (key: string) => catalog[namespace]?.[key] ?? key,
  };
});
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map([["member-1", { userId: "member-1", nickname: "Isaac" }]]),
  displayNameOf: (userId: string) => (userId === "member-1" ? "Isaac" : userId),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCreateCrewTask: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
  useDraftCrewTask: () => ({
    mutateAsync: state.draft,
    reset: state.resetDraft,
    data: null,
    isPending: false,
  }),
  useCrewEpisodes: () => ({ data: [], isLoading: false }),
  useCrewTaskOptions: () => ({ data: [] }),
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

function renderQuickCreate(onCreated = vi.fn(), onOpenChange = vi.fn(), taskProject = project) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <TaskQuickCreate
        open
        onOpenChange={onOpenChange}
        crewId="crew-1"
        members={[member]}
        project={taskProject}
        activeView={view}
        onCreated={onCreated}
      />
    )
  );
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
  it("creates a minimal task from the compact issue composer", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderQuickCreate(onCreated, onOpenChange);

    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task title"]')!;
    act(() => fill(input, "Review episode one animatic"));
    await act(async () => {
      click(exactButton("Create"));
      await Promise.resolve();
    });

    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Review episode one animatic",
        description: "",
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

    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task title"]')!;
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

    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task title"]')!;
    act(() => fill(input, "Isaac should finish the first-act storyboard next Friday"));
    await act(async () => {
      click(document.querySelector('button[aria-label="More actions"]')!);
      await Promise.resolve();
    });
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
        priority: "high",
        assignees: [{ userId: "member-1", currency: "USD" }],
      })
    );
  });
  it.each(["Task title", "Task brief"])(
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
        'textarea[aria-label="Task title"]'
      )!;
      act(() => fill(title, "Original prompt"));
      await act(async () => click(document.querySelector('button[aria-label="More actions"]')!));
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
          title: label === "Task title" ? "Newer user text" : "Original prompt",
          description: label === "Task brief" ? "Newer user text" : "",
        })
      );
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
        'textarea[aria-label="Task title"]'
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
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task title"]')!;
    act(() => fill(input, "Prepare this task"));
    act(() => click(document.querySelector('button[aria-label="More actions"]')!));
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
        assignees: [{ userId: "member-1", currency: "USD" }],
      })
    );
  });
  it.each(["", "2026-09-25"])("respects the user changing an AI deadline to %s", async (date) => {
    renderQuickCreate();
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task title"]')!;
    act(() => fill(input, "Prepare storyboard"));
    act(() => click(document.querySelector('button[aria-label="More actions"]')!));
    await act(async () => click(button("Organize with AI")));
    const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(dateInput.value).toBe("2026-08-07");
    act(() => fill(dateInput, date));
    await act(async () => click(exactButton("Create")));
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
