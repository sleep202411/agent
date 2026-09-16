vi.mock("./trust-appeal-link", () => ({ TrustAppealLink: () => null }));
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
import { LinearTaskWorkspace } from "./linear-task-workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  locale: "en-US",
  layout: "board",
  account: "alice",
  listFailed: false,
  failed: false,
  missing: false,
  retry: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => {
    const messages = state.locale === "zh-CN" ? cn : state.locale === "zh-HK" ? hk : en;
    return String(
      key
        .split(".")
        .reduce<unknown>(
          (value: unknown, part): unknown =>
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[part]
              : undefined,
          messages.crewTaskProject
        ) ?? key
    );
  },
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCreateCrewTaskView: mutation,
    useCreateCrewTaskWorkflowState: mutation,
    useDeleteCrewTaskView: mutation,
    useReorderCrewTask: mutation,
    useUpdateCrewTask: mutation,
    useUpdateCrewTaskView: mutation,
    useUpdateCrewTaskWorkflowState: mutation,
    useCrewProductionOverview: () => ({
      data: {
        project: { startDate: null },
        page: { createdAt: "2026-09-08" },
        capabilities: { manage: false },
      },
    }),
    useCrewProductionActivity: () => ({ data: { pages: [] } }),
    useCrewTask: (id: string) => ({
      data: id && !state.missing ? { id, title: "Selected task", assignees: [] } : undefined,
      isError: state.failed,
      error: state.failed ? new Error("Task refresh unavailable") : null,
      refetch: state.retry,
    }),
    useCrewTaskSummary: () => ({ data: {} }),
    useCrewTaskProject: () => ({
      data: {
        cycles: [],
        fields: [],
        labels: [],
        workflowStates: [],
        views: [
          {
            id: "default",
            name: "issues",
            layout: state.layout,
            filters: {},
            sorts: [],
            visibleFields: [],
            groupBy: "status",
            completedMode: "all",
            showSubIssues: true,
            showEmptyGroups: false,
          },
        ],
      },
    }),
    useCrewTaskView: () => ({
      data: [],
      workflowCounts: {},
      isError: state.listFailed,
      error: new Error("Task list unavailable"),
      refetch: state.retry,
    }),
  };
});
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({ useUserDisplays: () => ({}) }));
vi.mock("./task-project-views", () => ({
  TaskProjectView: ({
    view,
    onOpenTask,
  }: {
    view: { layout: string };
    onOpenTask: (id: string) => void;
  }) => (
    <div data-layout={view.layout}>
      <button onClick={() => onOpenTask("task-1")}>Open task</button>
    </div>
  ),
}));
vi.mock("./production-overview", () => ({ ProductionOverview: () => <div data-overview /> }));
vi.mock("./production-project-update", () => ({
  ProductionActivityComposer: () => null,
  ProductionActivityEntry: () => null,
}));
vi.mock("./task-issue-detail", () => ({
  TaskIssueDetail: function Detail({ onClose }: { onClose: () => void }) {
    const [draft, setDraft] = useState("");
    return (
      <>
        <button onClick={onClose}>Close task</button>
        <button onClick={() => setDraft("Private task draft")}>{draft || "Edit draft"}</button>
      </>
    );
  },
}));
vi.mock("./task-project-settings", () => ({ ProjectSettingsDialog: () => null }));
vi.mock("./task-quick-create", () => ({ TaskQuickCreate: () => null }));
vi.mock("./task-dialogs", () => ({ SubmitTaskDialog: () => null }));
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  state.listFailed = false;
  if (root) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  state.account = "alice";
  state.failed = false;
  state.missing = false;
  state.retry.mockClear();
});
async function render(deeplinkTaskId?: string | null, reuse = false) {
  if (!reuse) {
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
  }
  await act(async () =>
    root.render(
      <LinearTaskWorkspace
        deeplinkTaskId={deeplinkTaskId}
        crewId="crew"
        crewName="Test12"
        crewSummary=""
        crewLogo=""
        crewVersion={1}
        canEditCrewInfo={false}
        members={[]}
        isOwner={false}
      />
    )
  );
}
describe("Crew task navigation", () => {
  it.each(["en-US", "zh-CN", "zh-HK"])(
    "opens Tasks and preserves tab destinations in %s",
    async (locale) => {
      state.locale = locale;
      state.layout = "board";
      await render();
      const m = (locale === "zh-CN" ? cn : locale === "zh-HK" ? hk : en).crewTaskProject;
      const tabs = [...document.querySelectorAll("nav button")];
      expect(tabs.slice(0, 3).map((el) => el.textContent)).toEqual([
        m.issues,
        m.overview,
        m.activity,
      ]);
      expect(document.querySelector('[data-layout="board"]')).not.toBeNull();
      await act(async () => (tabs[1] as HTMLElement).click());
      expect(document.querySelector("[data-overview]")).not.toBeNull();
      await act(async () => (tabs[2] as HTMLElement).click());
      expect(document.querySelector("[data-overview]")).toBeNull();
      expect(document.querySelector("[data-layout]")).toBeNull();
      await act(async () => (tabs[0] as HTMLElement).click());
      expect(document.querySelector('[data-layout="board"]')).not.toBeNull();
    }
  );
  it("honors an existing saved List preference", async () => {
    state.layout = "list";
    await render();
    expect(document.querySelector('[data-layout="list"]')).not.toBeNull();
  });
});

it.each(["list", "board"])(
  "preserves the %s view, filter and scroll after closing task details",
  async (layout) => {
    state.layout = layout;
    state.locale = "en-US";
    await render();
    const list = document.querySelector("main")!;
    list.scrollTop = 160;
    const search = document.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "search term"
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (document.querySelector("[data-layout] button") as HTMLElement).click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector("main")).toBe(list);
    expect(document.querySelector(`[data-layout="${layout}"]`)).not.toBeNull();
    const close = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Close task"
    )!;
    await act(async () => close.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("main")).toBe(list);
    expect(list.scrollTop).toBe(160);
    expect(search.value).toBe("search term");
  }
);

it("keeps a task opened before the initial animation frame", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  await render();
  await act(async () => (document.querySelector("[data-layout] button") as HTMLElement).click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    const pending = Array.from(frames.values());
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("follows changed deep links in the same workspace", async () => {
  await render("task-1");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await render(null, true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render("task-1", true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("starts fresh drawer state when another account has the same task cached", async () => {
  await render("task-1");
  const edit = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Edit draft"
  )!;
  await act(async () => edit.click());
  expect(document.body.textContent).toContain("Private task draft");
  state.account = "bob";
  await render("task-1", true);
  expect(document.body.textContent).not.toContain("Private task draft");
  expect(document.body.textContent).toContain("Edit draft");
});

it("keeps unsaved task details mounted after a background refresh fails", async () => {
  state.locale = "en-US";
  await render("task-1");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Edit draft")!
      .click()
  );
  state.failed = true;
  await render("task-1", true);
  expect(document.body.textContent).toContain("Private task draft");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Task refresh unavailable");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click()
  );
  expect(state.retry).toHaveBeenCalledOnce();
  state.failed = false;
  await render("task-1", true);
  expect(document.body.textContent).toContain("Private task draft");
});

it("offers a retry when task details fail before any data loads", async () => {
  state.locale = "en-US";
  state.failed = true;
  state.missing = true;
  await render("task-1");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Task refresh unavailable");
  expect(document.body.textContent).not.toContain("Edit draft");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click()
  );
  expect(state.retry).toHaveBeenCalledOnce();
});

it("shows task-list failure and retries without claiming an empty successful load", async () => {
  state.listFailed = true;
  await render();
  expect(document.body.textContent).toContain("Task list unavailable");
  const retry = [...document.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(state.retry).toHaveBeenCalledTimes(1);
});
