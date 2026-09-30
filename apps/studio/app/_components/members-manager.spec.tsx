// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { MembersManager } from "./members-manager";

const api = vi.hoisted(() => ({
  viewerId: "a",
  createInvite: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  list: vi.fn(),
  realtime: vi.fn(),
  add: vi.fn(),
  invites: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: api.viewerId } }),
}));
vi.mock("sonner", () => ({ toast: { success: api.success, error: api.error } }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: api.realtime,
}));
vi.mock("@/lib/collab/sharing-api", async (original) => ({
  ...(await original<typeof import("@/lib/collab/sharing-api")>()),
  listMembers: api.list,
  addMember: api.add,
  listInvites: api.invites,
  createInvite: api.createInvite,
}));

describe("MembersManager project access", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.viewerId = "a";
    api.createInvite.mockReset();
    api.success.mockReset();
    api.error.mockReset();
    api.list.mockReset();
    api.realtime.mockReset().mockReturnValue({ subscribe: () => ({ close: vi.fn() }) });
    api.add.mockReset();
    api.invites.mockReset().mockResolvedValue([]);
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
  const render = async (canManage = false, kind: "project" | "workspace" = "project") => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MembersManager scope={{ kind, id: "canvas", name: "Canvas" }} canManage={canManage} />
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
    expect(api.list).toHaveBeenLastCalledWith(
      { kind: "project", id: "canvas", name: "Canvas" },
      expect.any(AbortSignal)
    );
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
  it("isolates roster caches and cancels pending reads on account change", async () => {
    api.list.mockImplementation(() => new Promise(() => {}));
    api.invites.mockImplementation(() => new Promise(() => {}));
    await render(true);
    const oldRoster = api.list.mock.calls[0][1];
    const oldInvites = api.invites.mock.calls[0][1];
    api.viewerId = "b";
    api.list.mockResolvedValue([]);
    api.invites.mockResolvedValue([]);
    await render(true);
    expect(oldRoster.aborted).toBe(true);
    expect(oldInvites.aborted).toBe(true);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(
      client
        .getQueryCache()
        .findAll()
        .filter((q) => q.queryKey[0] === "share-members")
        .map((q) => q.queryKey.at(-1))
    ).toEqual(["a", "b"]);
  });
  const fillAccount = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="addByEmailOrPhone"]'
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  it("guards rapid add submissions and retains failed drafts for retry", async () => {
    api.list.mockResolvedValue([]);
    let reject!: (error: Error) => void;
    api.add
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, r) => {
            reject = r;
          })
      )
      .mockResolvedValue({ nickname: "Accepted" });
    await render(true);
    await fillAccount("member@example.test");
    await act(async () => {
      submit();
      submit();
    });
    expect(api.add).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Retry this member")));
    expect(api.error).toHaveBeenCalledWith("Retry this member");
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="addByEmailOrPhone"]')?.value
    ).toBe("member@example.test");
    await act(async () => {
      submit();
    });
    await settle();
    expect(api.add).toHaveBeenCalledTimes(2);
    expect(api.success).toHaveBeenCalledTimes(1);
  });
  it("locks member and invite draft controls during a write and restores retry after failure", async () => {
    api.list.mockResolvedValue([]);
    let reject!: (error: Error) => void;
    api.add.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    await render(true);
    await fillAccount("member@example.test");
    await act(async () => {
      submit();
    });
    const account = container.querySelector<HTMLInputElement>(
      'input[placeholder="addByEmailOrPhone"]'
    )!;
    expect(account.disabled).toBe(true);
    expect([...container.querySelectorAll("select")].every((select) => select.disabled)).toBe(true);
    await act(async () => reject(new Error("Please retry")));
    expect(account.disabled).toBe(false);
    expect(account.value).toBe("member@example.test");
    expect([...container.querySelectorAll("select")].every((select) => !select.disabled)).toBe(
      true
    );
    expect(api.error).toHaveBeenCalled();
  });
  it("ignores an old add result after switching accounts and preserves replacement drafts", async () => {
    api.list.mockResolvedValue([]);
    let resolve!: (value: { nickname: string }) => void;
    api.add.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await render(true);
    await fillAccount("old@example.test");
    await act(async () => {
      submit();
    });
    const requestSignal = api.add.mock.calls.at(-1)![3] as AbortSignal;
    api.viewerId = "b";
    await render(true);
    expect(requestSignal.aborted).toBe(true);
    await fillAccount("replacement@example.test");
    await act(async () => resolve({ nickname: "Old member" }));
    expect(api.success).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="addByEmailOrPhone"]')?.value
    ).toBe("replacement@example.test");
  });
  it("discards invite results after management permission is withdrawn", async () => {
    api.list.mockResolvedValue([]);
    let resolve!: (value: { inviteId: string; token: string }) => void;
    api.createInvite.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await render(true);
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("createLink")
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.createInvite).toHaveBeenCalledTimes(1);
    const inviteSignal = api.createInvite.mock.calls.at(-1)![3] as AbortSignal;
    await render(false);
    expect(inviteSignal.aborted).toBe(true);
    await act(async () => resolve({ inviteId: "old", token: "private-old-token" }));
    expect(container.textContent).not.toContain("private-old-token");
    expect(api.success).not.toHaveBeenCalled();
  });
  it.each(["editor", "admin"])(
    "shows disabled role controls with owner guidance for a workspace %s",
    async (role) => {
      api.list.mockResolvedValue([
        { memberId: "self", userId: "a", nickname: "Me", role, isSelf: true, isOwner: false },
        {
          memberId: "other",
          userId: "b",
          nickname: "Other",
          role: "editor",
          isSelf: false,
          isOwner: false,
        },
      ]);
      await render(role === "admin", "workspace");
      const controls = [
        ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="changeMemberRole"]'),
      ];
      expect(controls).toHaveLength(2);
      expect(controls.every((control) => control.disabled)).toBe(true);
      expect(container.querySelectorAll('[aria-label="contactOwnerRole"]')).toHaveLength(2);
    }
  );
  it("enables member role controls only for the workspace owner", async () => {
    api.list.mockResolvedValue([
      { memberId: "self", userId: "a", nickname: "Me", role: "owner", isSelf: true, isOwner: true },
      {
        memberId: "other",
        userId: "b",
        nickname: "Other",
        role: "editor",
        isSelf: false,
        isOwner: false,
      },
    ]);
    await render(true, "workspace");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="changeMemberRole"]')?.disabled
    ).toBe(false);
  });
});
