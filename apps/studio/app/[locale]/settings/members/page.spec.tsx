// @vitest-environment jsdom

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
}));

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

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    workspace.active = PERSONAL;
    workspace.loading = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async () => {
    await act(async () => root.render(<MembersSettingsPage />));
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
});
