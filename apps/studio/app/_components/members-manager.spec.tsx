// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import type { ShareScope, SharingMember } from "@/lib/collab/sharing-api";
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
  updateRole: vi.fn(),
  remove: vi.fn(),
  revoke: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: api.viewerId } }),
}));
vi.mock("sonner", () => ({ toast: { success: api.success, error: api.error } }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { days?: number }) =>
    values?.days == null ? key : `${key}:${values.days}`,
}));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: api.realtime,
}));
vi.mock("@/lib/collab/sharing-api", async (original) => ({
  ...(await original<typeof import("@/lib/collab/sharing-api")>()),
  listMembers: api.list,
  addMember: api.add,
  listInvites: api.invites,
  createInvite: api.createInvite,
  updateMemberRole: api.updateRole,
  removeMember: api.remove,
  revokeInvite: api.revoke,
}));

describe("MembersManager project access", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
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
    api.updateRole.mockReset().mockResolvedValue(undefined);
    api.remove.mockReset().mockResolvedValue(undefined);
    api.revoke.mockReset().mockResolvedValue(undefined);
    api.copy.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: api.copy },
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    if (scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoView);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const render = async (canManage = false, kind: ShareScope["kind"] = "project") => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MembersManager scope={{ kind, id: "canvas", name: "Canvas" }} canManage={canManage} />
        </QueryClientProvider>
      )
    );
    await settle();
  };
  const invitationTabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const switchInvitationMode = async (mode: "member" | "link") => {
    const text = mode === "member" ? "inviteByAccount" : "inviteByLink";
    const tab = invitationTabs().find((item) => item.textContent === text)!;
    expect(tab).toBeDefined();
    await act(async () => {
      tab.dispatchEvent(
        new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true })
      );
      tab.click();
    });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  };
  const selectInvitationOption = async (label: string, text: string) => {
    const trigger = container.querySelector<HTMLButtonElement>(
      `[role="combobox"][aria-label="${label}"]`
    )!;
    expect(trigger).not.toBeNull();
    await act(async () => trigger.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === text
    )!;
    expect(option).toBeDefined();
    await act(async () => option.click());
  };
  const createLinkButton = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "createLink"
    )!;

  const member = (overrides: Partial<SharingMember> = {}): SharingMember => ({
    memberId: "other",
    userId: "b",
    nickname: "Other",
    avatar: null,
    role: "editor",
    status: "active",
    joinedAt: null,
    isOwner: false,
    isSelf: false,
    ...overrides,
  });
  const memberRoleControls = () => [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="changeMemberRole"]'),
  ];
  const openMemberRole = async () => {
    const trigger = memberRoleControls()[0]!;
    expect(trigger).toBeDefined();
    await act(async () => trigger.click());
    const menu = document.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(menu).not.toBeNull();
    return menu;
  };
  const chooseMemberRole = async (role: string) => {
    const menu = await openMemberRole();
    const option = [...menu.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === `roles.${role}`
    )!;
    expect(option).toBeDefined();
    await act(async () => option.click());
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
    api.list.mockResolvedValue([member()]);
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
    expect(invitationTabs()).toHaveLength(2);
    expect(invitationTabs().every((tab) => tab.disabled)).toBe(true);
    await act(async () => invitationTabs()[1]!.click());
    expect(invitationTabs()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(memberRoleControls()[0]?.disabled).toBe(true);
    expect([...container.querySelectorAll("select")].every((select) => select.disabled)).toBe(true);
    await act(async () => reject(new Error("Please retry")));
    expect(account.disabled).toBe(false);
    expect(invitationTabs().every((tab) => !tab.disabled)).toBe(true);
    expect(memberRoleControls()[0]?.disabled).toBe(false);
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
    await switchInvitationMode("link");
    const button = createLinkButton();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(api.createInvite).toHaveBeenCalledTimes(1);
    expect(invitationTabs().every((tab) => tab.disabled)).toBe(true);
    const inviteSignal = api.createInvite.mock.calls.at(-1)![3] as AbortSignal;
    await render(false);
    expect(inviteSignal.aborted).toBe(true);
    await act(async () => resolve({ inviteId: "old", token: "private-old-token" }));
    expect(container.textContent).not.toContain("private-old-token");
    expect(api.success).not.toHaveBeenCalled();
  });
  it("creates a seven-day invite by default and preserves copy and revoke after switching tabs", async () => {
    api.list.mockResolvedValue([]);
    const invite = {
      inviteId: "invite-1",
      token: "local-invite",
      role: "editor",
      expiresAt: "2026-10-11T12:00:00.000Z",
    };
    api.createInvite.mockImplementation(async () => {
      api.invites.mockResolvedValue([
        { ...invite, status: "pending", createdAt: "2026-10-04T12:00:00.000Z" },
      ]);
      return invite;
    });
    await render(true);
    expect(invitationTabs()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(api.invites).toHaveBeenCalledExactlyOnceWith(
      { kind: "project", id: "canvas", name: "Canvas" },
      expect.any(AbortSignal)
    );
    await switchInvitationMode("link");
    expect(container.querySelector('[aria-label="inviteLinkExpiryLabel"]')?.textContent).toBe(
      "inviteLinkExpiryDays:7"
    );
    await act(async () => createLinkButton().click());
    await settle();
    expect(api.createInvite).toHaveBeenCalledExactlyOnceWith(
      { kind: "project", id: "canvas", name: "Canvas" },
      "editor",
      7,
      expect.any(AbortSignal)
    );
    const url = `${window.location.origin}/invite/local-invite`;
    expect(api.copy).toHaveBeenCalledExactlyOnceWith(url);
    expect(container.textContent).toContain("existingInviteLinks");
    await switchInvitationMode("member");
    await switchInvitationMode("link");
    expect(container.querySelector("code")?.textContent).toBe(url);
    const copy = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "copy"
    )!;
    await act(async () => copy.click());
    await settle();
    expect(api.copy).toHaveBeenCalledTimes(2);
    expect(api.copy).toHaveBeenLastCalledWith(url);
    api.revoke.mockImplementation(async () => {
      api.invites.mockResolvedValue([]);
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="revokeLink"]')!.click()
    );
    await settle();
    expect(api.revoke).toHaveBeenCalledExactlyOnceWith(
      { kind: "project", id: "canvas", name: "Canvas" },
      "invite-1",
      expect.any(AbortSignal)
    );
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector('[aria-label="revokeLink"]')).toBeNull();
  });

  it("allows an explicitly selected never-expiring link", async () => {
    api.list.mockResolvedValue([]);
    api.createInvite.mockResolvedValue({
      inviteId: "never",
      token: "local-never",
      role: "editor",
      expiresAt: null,
    });
    await render(true);
    await switchInvitationMode("link");
    await selectInvitationOption("inviteLinkExpiryLabel", "inviteLinkExpiryNever");
    await switchInvitationMode("member");
    await switchInvitationMode("link");
    expect(container.querySelector('[aria-label="inviteLinkExpiryLabel"]')?.textContent).toBe(
      "inviteLinkExpiryNever"
    );
    await act(async () => createLinkButton().click());
    await settle();
    expect(api.createInvite).toHaveBeenCalledExactlyOnceWith(
      { kind: "project", id: "canvas", name: "Canvas" },
      "editor",
      null,
      expect.any(AbortSignal)
    );
  });

  it.each([
    { kind: "story-project" as const, roles: ["producer", "editor", "reviewer", "viewer"] },
    { kind: "project" as const, roles: ["admin", "editor", "viewer"] },
  ])(
    "keeps the $kind member role selector visible with its supported roles",
    async ({ kind, roles }) => {
      api.list.mockResolvedValue([member()]);
      await render(true, kind);
      const controls = memberRoleControls();
      expect(controls).toHaveLength(1);
      expect(controls[0]?.disabled).toBe(false);
      expect(controls[0]?.textContent).toContain("roles.editor");
      expect(container.querySelectorAll('[aria-label="memberActions"]')).toHaveLength(1);
      const menu = await openMemberRole();
      expect([...menu.querySelectorAll('[role="option"]')].map((item) => item.textContent)).toEqual(
        roles.map((role) => `roles.${role}`)
      );
      await act(async () => menu.querySelector<HTMLElement>('[aria-selected="true"]')!.click());
      expect(api.updateRole).not.toHaveBeenCalled();
    }
  );

  it.each(["project", "story-project"] as const)(
    "protects owners, self, project-only and read-only rows in a %s roster",
    async (kind) => {
      api.list.mockResolvedValue([
        member({ memberId: "owner", nickname: "Owner", role: "owner", isOwner: true }),
        member({ memberId: "self", userId: "a", nickname: "Me", isSelf: true }),
        member({ memberId: "project-only", nickname: "Project only", accessScope: "project_only" }),
        member(),
      ]);
      await render(true, kind);
      expect(memberRoleControls()).toHaveLength(1);
      expect(container.querySelectorAll('[aria-label="memberActions"]')).toHaveLength(1);
      expect(container.textContent).toContain("Owner");
      expect(container.textContent).toContain("Me");
      expect(container.textContent).toContain("Project only");
      await render(false, kind);
      expect(memberRoleControls()).toHaveLength(0);
      expect(container.querySelector('[aria-label="memberActions"]')).toBeNull();
      expect(container.textContent).toContain("roles.editor");
      expect(api.updateRole).not.toHaveBeenCalled();
      expect(api.remove).not.toHaveBeenCalled();
    }
  );

  it("updates only the selected member and refreshes the story roster and permission snapshots", async () => {
    api.list.mockResolvedValue([member()]);
    const snapshots = ["workbench", "chapter-workbench", "script-workbench", "workbench-shell"];
    for (const kind of snapshots) client.setQueryData(["story-studio", kind, "canvas"], {});
    client.setQueryData(["story-studio", "workbench", "other-story"], {});
    await render(true, "story-project");
    const readsBefore = api.list.mock.calls.length;
    api.updateRole.mockImplementation(async () => {
      api.list.mockResolvedValue([member({ role: "producer" })]);
    });
    await chooseMemberRole("producer");
    expect(api.updateRole).toHaveBeenCalledExactlyOnceWith(
      { kind: "story-project", id: "canvas", name: "Canvas" },
      "other",
      "producer",
      expect.any(AbortSignal)
    );
    expect(api.list.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(memberRoleControls()[0]?.textContent).toContain("roles.producer");
    for (const kind of snapshots)
      expect(client.getQueryState(["story-studio", kind, "canvas"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["story-studio", "workbench", "other-story"])?.isInvalidated).toBe(
      false
    );
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.add).not.toHaveBeenCalled();
    expect(api.createInvite).not.toHaveBeenCalled();
  });

  it("keeps the server role and raw error after a failed role change, then allows retry", async () => {
    api.list.mockResolvedValue([member()]);
    api.updateRole
      .mockRejectedValueOnce(
        new ApiRequestError("NO_SEATS", "No creator seats remain in this crew.", 409)
      )
      .mockImplementationOnce(async () => {
        api.list.mockResolvedValue([member({ role: "admin" })]);
      });
    await render(true);
    const readsBefore = api.list.mock.calls.length;
    await chooseMemberRole("admin");
    expect(api.updateRole).toHaveBeenLastCalledWith(
      { kind: "project", id: "canvas", name: "Canvas" },
      "other",
      "admin",
      expect.any(AbortSignal)
    );
    expect(api.error).toHaveBeenCalledExactlyOnceWith("No creator seats remain in this crew.");
    expect(memberRoleControls()[0]?.textContent).toContain("roles.editor");
    expect(memberRoleControls()[0]?.disabled).toBe(false);
    expect(api.list).toHaveBeenCalledTimes(readsBefore);
    await chooseMemberRole("admin");
    expect(api.updateRole).toHaveBeenCalledTimes(2);
    expect(memberRoleControls()[0]?.textContent).toContain("roles.admin");
    expect(api.remove).not.toHaveBeenCalled();
  });

  it.each(["project", "story-project"] as const)(
    "keeps the %s removal menu independent from role selection",
    async (kind) => {
      api.list.mockResolvedValue([member()]);
      await render(true, kind);
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="memberActions"]')!;
      await act(async () => {
        trigger.focus();
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        );
      });
      const actions = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      expect(actions.map((item) => item.textContent)).toEqual(["remove"]);
      api.remove.mockImplementation(async () => {
        api.list.mockResolvedValue([]);
      });
      await act(async () => actions[0]!.click());
      await settle();
      expect(api.remove).toHaveBeenCalledExactlyOnceWith(
        { kind, id: "canvas", name: "Canvas" },
        "other",
        expect.any(AbortSignal)
      );
      expect(api.updateRole).not.toHaveBeenCalled();
      expect(memberRoleControls()).toHaveLength(0);
      expect(container.textContent).toContain("noMembersFound");
    }
  );

  it("disables the workspace owner's member role selector when management access is denied", async () => {
    api.list.mockResolvedValue([
      member({
        memberId: "self",
        userId: "a",
        nickname: "Me",
        role: "owner",
        isSelf: true,
        isOwner: true,
      }),
      member(),
    ]);
    api.invites.mockRejectedValue(
      new ApiRequestError("WORKSPACE_ACCESS_DENIED", "Workspace access was revoked", 403)
    );
    await render(true, "workspace");
    expect(memberRoleControls()).toHaveLength(1);
    expect(memberRoleControls()[0]?.disabled).toBe(true);
    await act(async () => memberRoleControls()[0]!.click());
    expect(api.updateRole).not.toHaveBeenCalled();
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
