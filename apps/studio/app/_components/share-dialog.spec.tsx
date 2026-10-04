// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import type { ShareScope } from "@/lib/collab/sharing-api";
import { ShareDialog } from "./share-dialog";

const api = vi.hoisted(() => ({
  members: vi.fn(),
  invites: vi.fn(),
  add: vi.fn(),
  create: vi.fn(),
  changeOpen: vi.fn(),
}));
vi.mock("./auth-provider", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./casting-manager", () => ({ CastingManager: () => <div data-casting /> }));
vi.mock("@/lib/collab/sharing-api", async (original) => ({
  ...(await original<typeof import("@/lib/collab/sharing-api")>()),
  listMembers: api.members,
  listInvites: api.invites,
  addMember: api.add,
  createInvite: api.create,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let root: Root, host: HTMLDivElement, client: QueryClient;
const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
beforeEach(() => {
  vi.clearAllMocks();
  api.members.mockResolvedValue([]);
  api.invites.mockResolvedValue([]);
  api.add.mockResolvedValue({ nickname: "Collaborator" });
  api.create.mockResolvedValue({
    inviteId: "invite",
    token: "local-test",
    role: "reviewer",
    expiresAt: null,
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  document.body.replaceChildren();
  if (scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

async function render(canManage = true, kind: ShareScope["kind"] = "story-project") {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
        <QueryClientProvider client={client}>
          <ShareDialog
            scope={{ kind, id: "project", name: "Our Film" }}
            canManage={canManage}
            open
            onOpenChange={api.changeOpen}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const selected = () => dialog().querySelector<HTMLElement>('th[aria-current="true"]')?.dataset.role;
const tab = (label: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => item.textContent === label
  )!;
async function switchMode(mode: "member" | "link") {
  const trigger = tab(
    mode === "member" ? messages.workspace.inviteByAccount : messages.workspace.inviteByLink
  );
  expect(trigger).toBeDefined();
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true })
    );
    trigger.click();
  });
  expect(trigger.getAttribute("aria-selected")).toBe("true");
}
async function openRole(label: string) {
  const trigger = dialog().querySelector<HTMLButtonElement>(
    `[role="combobox"][aria-label="${label}"]`
  )!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.click());
  return document.querySelector<HTMLElement>('[role="listbox"]')!;
}
async function selectOption(label: string, text: string) {
  const menu = await openRole(label);
  const option = [...menu.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === text
  )!;
  expect(option).toBeDefined();
  await act(async () => option.click());
}

describe("Story project sharing permissions", () => {
  it("renders the real capability matrix with accessible column and row headers", async () => {
    await render();
    const table = dialog().querySelector("table")!;
    expect(table.querySelector("caption")?.textContent).toBe("Story project role permissions");
    expect(
      [...table.querySelectorAll('thead th[scope="col"][data-role]')].map((cell) =>
        cell.getAttribute("data-role")
      )
    ).toEqual(["owner", "producer", "editor", "reviewer", "viewer"]);
    const expected = [
      [true, true, true, true, true],
      [true, true, true, false, false],
      [true, true, true, false, false],
      [true, true, false, true, false],
      [true, true, false, false, false],
      [true, false, false, false, false],
    ];
    const rows = [...table.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(expected.length);
    rows.forEach((row, index) => {
      expect(row.querySelector('th[scope="row"]')).not.toBeNull();
      expect([...row.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(
        expected[index]!.map((allowed) => (allowed ? "Allowed" : "Not allowed"))
      );
      expect(
        [...row.querySelectorAll("svg")].every(
          (icon) => icon.getAttribute("aria-hidden") === "true"
        )
      ).toBe(true);
    });
    const note = document.getElementById(table.getAttribute("aria-describedby")!);
    expect(note?.textContent).toContain("cannot invite someone as an owner");
    expect(note?.textContent).toContain("Workspace owners and admins");
    expect(note?.textContent).toContain("will not reduce that access");
    expect(note?.textContent).toContain("separate from platform publication review");
    expect(table.querySelector("button, select, a")).toBeNull();
  });

  it("preserves account and both invitation drafts while the guide follows the active method", async () => {
    await render();
    expect(selected()).toBe("viewer");
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe(
      "Member invitation: Viewer"
    );
    const menu = await openRole(messages.workspace.role);
    expect(
      [...menu.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    ).toEqual(["Producer", "Editor", "Reviewer", "Viewer"]);
    await act(async () => menu.querySelector<HTMLElement>('[aria-selected="true"]')!.click());
    await selectOption(messages.workspace.role, messages.workspace.roles.editor);
    const input = dialog().querySelector<HTMLInputElement>('[aria-label="Add by email or phone"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "member@example.test"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await switchMode("link");
    expect(selected()).toBe("viewer");
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe("Invite link: Viewer");
    const linkOptions = await openRole(messages.workspace.inviteLinkRole);
    expect(
      [...linkOptions.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    ).toEqual(["Producer", "Editor", "Reviewer", "Viewer"]);
    await act(async () =>
      linkOptions.querySelector<HTMLElement>('[aria-selected="true"]')!.click()
    );
    await selectOption(messages.workspace.inviteLinkRole, messages.workspace.roles.reviewer);
    await selectOption(messages.workspace.inviteLinkExpiryLabel, "In 30 days");
    expect(selected()).toBe("reviewer");
    await switchMode("member");
    expect(selected()).toBe("editor");
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe(
      "Member invitation: Editor"
    );
    expect(dialog().querySelectorAll('[data-selected="true"]')).toHaveLength(7);
    expect(
      dialog().querySelector<HTMLInputElement>('[aria-label="Add by email or phone"]')?.value
    ).toBe("member@example.test");
    expect(dialog().querySelector('[aria-label="Role"]')?.textContent).toBe("Editor");
    await switchMode("link");
    expect(selected()).toBe("reviewer");
    expect(dialog().querySelector('[aria-label="Invite link role"]')?.textContent).toBe("Reviewer");
    expect(dialog().querySelector('[aria-label="Expires"]')?.textContent).toBe("In 30 days");
    await switchMode("member");
    await act(async () =>
      dialog()
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(api.add).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "story-project" }),
      "member@example.test",
      "editor",
      expect.any(AbortSignal)
    );
    await switchMode("link");
    const create = [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === messages.workspace.createLink
    )!;
    await act(async () => create.click());
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "story-project" }),
      "reviewer",
      30,
      expect.any(AbortSignal)
    );
  });

  it("exposes keyboard-operable invitation tabs associated with the active panel", async () => {
    await render();
    const list = dialog().querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Invitation method");
    const member = tab(messages.workspace.inviteByAccount),
      link = tab(messages.workspace.inviteByLink);
    const assertPanel = (trigger: HTMLElement) => {
      expect(trigger.getAttribute("aria-selected")).toBe("true");
      const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(trigger.id);
      expect(panel?.hidden).toBe(false);
      expect(dialog().querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    };
    assertPanel(member);
    await act(async () => {
      member.focus();
      member.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(link);
    assertPanel(link);
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe("Invite link: Viewer");
    await act(async () => {
      link.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(member);
    assertPanel(member);
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe(
      "Member invitation: Viewer"
    );
  });

  it("keeps the guide readable to viewers and the scroll region keyboard accessible", async () => {
    await render(false);
    expect(dialog().querySelector("table")).not.toBeNull();
    expect(selected()).toBeUndefined();
    expect(dialog().querySelector('[role="status"]')).toBeNull();
    expect(dialog().querySelector("form, select")).toBeNull();
    expect(dialog().querySelector('[role="tablist"], [role="tab"]')).toBeNull();
    const region = dialog().querySelector<HTMLElement>('[role="region"]')!;
    expect(region.getAttribute("aria-label")).toBe("Story project role permissions");
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("overflow-x-auto");
    expect(dialog().className).toContain("max-h-[calc(100dvh-2rem)]");
    await act(async () => region.focus());
    expect(document.activeElement).toBe(region);
    await act(async () =>
      dialog().querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click()
    );
    expect(api.changeOpen).toHaveBeenCalledWith(false);
  });

  it("keeps ordinary project sharing compact and preserves its casting control", async () => {
    await render(false, "project");
    expect(dialog().querySelector("table")).toBeNull();
    expect(dialog().className).toContain("sm:max-w-md");
    expect(dialog().querySelector("[data-casting]")).not.toBeNull();
  });

  it("provides matching role-guide keys in all supported locales", () => {
    const keys = (record: object): string[] =>
      Object.entries(record)
        .flatMap(([key, value]) =>
          typeof value === "object" ? keys(value).map((nested) => `${key}.${nested}`) : [key]
        )
        .sort();
    expect(keys(zhCN.shell.share.storyRoles)).toEqual(keys(messages.shell.share.storyRoles));
    expect(keys(zhHK.shell.share.storyRoles)).toEqual(keys(messages.shell.share.storyRoles));
  });
});
