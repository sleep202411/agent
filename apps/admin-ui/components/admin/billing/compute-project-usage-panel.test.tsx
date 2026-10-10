// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingComputeProjectUsagePanel } from "./compute-project-usage-panel";
import type { AdminComputeProjectUsageData } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();

const data = (name: string): AdminComputeProjectUsageData => ({
  rangeDays: 30,
  workspaceKind: "all",
  sort: "credits",
  workspaceId: null,
  totalCredits: "120",
  workspaceCount: 1,
  projectCount: 1,
  workspaces: [
    {
      workspaceId: "workspace",
      workspaceName: name,
      workspaceStatus: "active",
      isPersonal: false,
      lastSpentAt: "2026-10-10T03:00:00.000Z",
      totalCredits: "120",
      totalJobs: 3,
      totalImageJobs: 2,
      totalVideoJobs: 1,
      projectCount: 1,
      projects: [
        {
          projectId: "project",
          projectName: `${name} film`,
          lastSpentAt: "2026-10-10T03:00:00.000Z",
          credits: "120",
          jobs: 3,
          imageJobs: 2,
          videoJobs: 1,
        },
      ],
    },
  ],
});

const response = (name: string) => ({
  ok: true,
  json: async () => ({ code: 200, data: data(name) }),
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function render(scope = "alice", name = "Initial", initialData = data(name)) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  vi.stubGlobal("fetch", fetchMock);
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={scope}>
        <BillingComputeProjectUsagePanel
          siteLabel="Fixture"
          databaseLabel="Fixture"
          initialData={initialData}
        />
      </AdminSessionBoundary>
    )
  );
}

function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text || node.getAttribute("aria-label") === text
  );
  expect(button).toBeTruthy();
  button!.click();
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("combines rapid filter changes and ignores the displaced result", async () => {
  const first = deferred();
  const second = deferred();
  fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render();
  await act(async () => {
    click("7 天");
    click("共享工作区");
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toContain("days=7&workspaceKind=shared&sort=credits");
  expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  await act(async () => first.resolve(response("Old")));
  expect(container.textContent).not.toContain("Old");
  await act(async () => second.resolve(response("Current")));
  expect(container.textContent).toContain("Current");
});

it("retains loaded records on failure and allows explicit retry", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("Usage unavailable"))
    .mockResolvedValueOnce(response("Recovered"));
  await render();
  await act(async () => click("刷新"));
  expect(container.textContent).toContain("Initial");
  expect(container.textContent).toContain("Usage unavailable");
  await act(async () => click("刷新"));
  expect(container.textContent).toContain("Recovered");
});

it("sends workspace and project filters together", async () => {
  fetchMock.mockResolvedValueOnce(response("Filtered"));
  await render();
  const [workspaceInput, projectInput] = container.querySelectorAll("input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      workspaceInput,
      "Team Alpha"
    );
    workspaceInput.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      projectInput,
      "Pilot"
    );
    projectInput.dispatchEvent(new Event("input", { bubbles: true }));
    click("查询");
  });
  const url = new URL(fetchMock.mock.calls[0][0], "https://fixture.test");
  expect(url.searchParams.get("workspaceQuery")).toBe("Team Alpha");
  expect(url.searchParams.get("projectQuery")).toBe("Pilot");
});

it("requests recent activity order when that sort is selected", async () => {
  fetchMock.mockResolvedValueOnce(response("Recent"));
  await render();
  await act(async () => click("最近活跃"));
  expect(fetchMock.mock.calls[0][0]).toContain("sort=recent");
});

it("loads remaining projects without losing the first page or global totals", async () => {
  const initial = data("Initial");
  initial.workspaces[0].nextProjectOffset = 40;
  initial.workspaces[0].projectCount = 41;
  const page = data("Next");
  page.workspaces[0].projects[0].projectId = "next-project";
  page.workspaces[0].nextProjectOffset = null;
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: page }) });
  await render("alice", "Initial", initial);
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Initial"))!
      .click();
  });
  await act(async () => click("Load more projects"));
  expect(fetchMock.mock.calls[0][0]).toContain("projectOffset=40");
  expect(fetchMock.mock.calls[0][0]).toContain("workspaceId=workspace");
  expect(container.textContent).toContain("Initial film");
  expect(container.textContent).toContain("Next film");
  expect(container.textContent).not.toContain("Load more projects");
});

it("loads additional workspaces and retains earlier rows", async () => {
  const initial = data("Initial");
  initial.nextWorkspaceOffset = 100;
  const page = data("Next");
  page.workspaces[0].workspaceId = "other-workspace";
  page.nextWorkspaceOffset = null;
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: page }) });
  await render("alice", "Initial", initial);
  await act(async () => click("Load more workspaces"));
  expect(fetchMock.mock.calls[0][0]).toContain("workspaceOffset=100");
  expect(container.textContent).toContain("Initial");
  expect(container.textContent).toContain("Next");
  expect(container.textContent).not.toContain("Load more workspaces");
});

it("ignores a displaced pagination response after changing filters", async () => {
  const initial = data("Initial");
  initial.nextWorkspaceOffset = 100;
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response("Filtered"));
  await render("alice", "Initial", initial);
  await act(async () => click("Load more workspaces"));
  await act(async () => click("7 天"));
  await act(async () => pending.resolve(response("Stale page")));
  expect(container.textContent).toContain("Filtered");
  expect(container.textContent).not.toContain("Stale page");
});
