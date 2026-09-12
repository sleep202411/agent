// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceRef } from "@/lib/collab/projects-api";
import MembersSettingsPage from "./page";

/**
 * Reachability pin. The server lets a personal workspace hold members and mint
 * invite links, and the seat policy alone caps it — so if this page hides the
 * roster behind `ws.type`, that whole surface is dead code no user can reach.
 * These assert the door is open, not how the roster behaves.
 */

const workspace = vi.hoisted(() => ({
  active: null as WorkspaceRef | null,
  loading: false,
  pathname: "/settings/members",
  getProject: vi.fn(),
  getStoryWorkbench: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({ usePathname: () => workspace.pathname }));
vi.mock("@/lib/collab/projects-api", () => ({ getProject: workspace.getProject }));
vi.mock("@/lib/story-projects-api", () => ({ getStoryWorkbench: workspace.getStoryWorkbench }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({
    activeWorkspace: workspace.active,
    loading: workspace.loading,
  }),
}));

vi.mock("@/app/_components/members-manager", () => ({
  MembersManager: ({
    scope,
    canManage,
  }: {
    scope: { kind: string; id: string };
    canManage: boolean;
  }) => (
    <div
      data-testid="members-manager"
      data-scope={scope.kind}
      data-scope-id={scope.id}
      data-can-manage={canManage}
    />
  ),
}));

const PERSONAL: WorkspaceRef = {
  id: "019f7243-20c1-7054-a6fa-0a33da6efef1",
  name: "My workspace",
  type: "personal",
  role: "owner",
  defaultProjectId: null,
};

describe("MembersSettingsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    workspace.active = PERSONAL;
    workspace.loading = false;
    workspace.pathname = "/settings/members";
    workspace.getProject.mockReset();
    workspace.getStoryWorkbench.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  });

  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MembersSettingsPage />
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };

  it("offers the roster on a PERSONAL workspace instead of a create-a-team empty state", async () => {
    await render();

    const manager = container.querySelector<HTMLElement>('[data-testid="members-manager"]');
    expect(manager).not.toBeNull();
    expect(manager?.dataset.scope).toBe("workspace");
    expect(manager?.dataset.scopeId).toBe(PERSONAL.id);
    // An owner must be able to actually add someone, not just read the roster.
    expect(manager?.dataset.canManage).toBe("true");
  });

  // Regression pin, not new-behaviour coverage: this passed before the change too.
  it("offers it on a TEAM workspace the same way — type never branches the surface", async () => {
    workspace.active = { ...PERSONAL, name: "Acme", type: "team" };
    await render();

    expect(container.querySelector('[data-testid="members-manager"]')).not.toBeNull();
  });
  it.each(["editor", "viewer"])(
    "shows current canvas members to a %s without workspace management",
    async (role) => {
      workspace.pathname = "/project/canvas-123/canvas";
      workspace.getProject.mockResolvedValue({ name: "Canvas", role });
      // Even a different selected workspace must not redirect the member request.
      workspace.active = { ...PERSONAL, id: "another-space", role: "owner" };
      await render();
      const manager = container.querySelector<HTMLElement>('[data-testid="members-manager"]');
      expect(manager?.dataset.scope).toBe("project");
      expect(manager?.dataset.scopeId).toBe("canvas-123");
      expect(manager?.dataset.canManage).toBe("false");
      expect(workspace.getProject).toHaveBeenCalledWith("canvas-123");
    }
  );

  it("preserves project admin management rights", async () => {
    workspace.pathname = "/project/canvas-123";
    workspace.getProject.mockResolvedValue({ name: "Canvas", role: "admin" });
    await render();
    expect(
      container.querySelector<HTMLElement>('[data-testid="members-manager"]')?.dataset.canManage
    ).toBe("true");
  });

  it("uses story membership and capabilities on a story canvas", async () => {
    workspace.pathname = "/story-studio/projects/story-123/canvas";
    workspace.getStoryWorkbench.mockResolvedValue({
      project: { title: "Story", capabilities: ["story.read"] },
    });
    await render();
    const manager = container.querySelector<HTMLElement>('[data-testid="members-manager"]');
    expect(manager?.dataset.scope).toBe("story-project");
    expect(manager?.dataset.scopeId).toBe("story-123");
    expect(manager?.dataset.canManage).toBe("false");
    expect(workspace.getProject).not.toHaveBeenCalled();
  });

  it("shows a failed project request and recovers on retry without requesting workspace members", async () => {
    workspace.pathname = "/project/canvas-123";
    workspace.getProject
      .mockRejectedValueOnce(new Error("Project access revoked"))
      .mockResolvedValue({ name: "Canvas", role: "viewer" });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Project access revoked"
    );
    expect(container.querySelector('[data-testid="members-manager"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click()
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      container.querySelector<HTMLElement>('[data-testid="members-manager"]')?.dataset.scope
    ).toBe("project");
  });
});
