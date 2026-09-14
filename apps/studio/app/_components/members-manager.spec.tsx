// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { MembersManager } from "./members-manager";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  realtime: vi.fn(),
  add: vi.fn(),
  invites: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: api.realtime,
}));
vi.mock("@/lib/collab/sharing-api", async (original) => ({
  ...(await original<typeof import("@/lib/collab/sharing-api")>()),
  listMembers: api.list,
  addMember: api.add,
  listInvites: api.invites,
}));

describe("MembersManager project access", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.list.mockReset();
    api.realtime.mockReset();
    api.add.mockReset();
    api.invites.mockResolvedValue([]);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MembersManager
            scope={{ kind: "project", id: "canvas", name: "Canvas" }}
            canManage={false}
          />
        </QueryClientProvider>
      )
    );
    await settle();
  };
  it("shows the API error instead of an endless skeleton, and retry loads members read-only", async () => {
    api.list
      .mockRejectedValueOnce(
        new ApiRequestError("PROJECT_ACCESS_DENIED", "Access was revoked", 403)
      )
      .mockResolvedValue([
        {
          memberId: "m1",
          userId: "u1",
          nickname: "Collaborator",
          avatar: null,
          role: "editor",
          status: "active",
          joinedAt: null,
          isOwner: false,
          isSelf: false,
        },
      ]);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Access was revoked");
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click()
    );
    await settle();
    expect(container.textContent).toContain("Collaborator");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(api.list).toHaveBeenLastCalledWith({ kind: "project", id: "canvas", name: "Canvas" });
    expect(api.realtime).not.toHaveBeenCalled();
  });
  it("shows an empty member list as empty, not loading", async () => {
    api.list.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain("noMembersFound");
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it("refreshes the project's permission snapshots after a membership change", async () => {
    api.list.mockResolvedValue([]);
    api.add.mockResolvedValue({ nickname: "New editor" });
    const snapshots = ["workbench", "chapter-workbench", "script-workbench", "workbench-shell"];
    for (const kind of snapshots) {
      client.setQueryData(["story-studio", kind, "story-1"], { capabilities: ["story.read"] });
    }
    client.setQueryData(["story-studio", "workbench", "other-story"], {});
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MembersManager
            scope={{ kind: "story-project", id: "story-1", name: "Story" }}
            canManage
          />
        </QueryClientProvider>
      )
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="addByEmailOrPhone"]'
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "editor@example.test"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    await settle();
    expect(api.add).toHaveBeenCalledOnce();
    for (const kind of snapshots) {
      expect(client.getQueryState(["story-studio", kind, "story-1"])?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(["story-studio", "workbench", "other-story"])?.isInvalidated).toBe(
      false
    );
  });
});
