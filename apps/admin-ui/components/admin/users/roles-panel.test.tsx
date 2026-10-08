// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { RolesPanel } from "./roles-panel";
import type { AdminRolesData } from "./types";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

const initial: AdminRolesData = {
  permissions: [
    { key: "ai_actors.read", description: "查看 AI 演员", assignable: true },
    { key: "courses.read", description: "查看课程", assignable: true },
    { key: "media.read", description: "查看媒体资产", assignable: true },
    { key: "admin.manage", description: "管理后台账号", assignable: false },
  ],
  roles: [
    {
      key: "super_admin",
      name: "超级管理员",
      description: "全部权限",
      permissions: ["ai_actors.read", "courses.read", "admin.manage"],
      accountCount: 1,
      system: true,
      assignable: false,
    },
    {
      key: "wardrobe",
      name: "服化道",
      description: "仅 AI 演员",
      permissions: ["ai_actors.read"],
      accountCount: 0,
      system: false,
      assignable: true,
    },
  ],
};

function envelope(data: unknown) {
  return new Response(JSON.stringify({ code: 200, data }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      <AdminSessionBoundary scopeKey="alice">
        <RolesPanel
          siteLabel="国际站"
          databaseLabel="生产库"
          initialData={initial}
          initialError={null}
        />
      </AdminSessionBoundary>
    )
  );
}

it("lists roles as rows and lets an admin edit a staff role in the directory", async () => {
  fetchMock.mockResolvedValueOnce(
    envelope({
      ...initial,
      roles: initial.roles.map((role) =>
        role.key === "wardrobe"
          ? { ...role, permissions: ["ai_actors.read", "courses.read"] }
          : role
      ),
    })
  );
  await render();
  expect(host.querySelector("table")?.textContent).toContain("服化道");
  expect(host.querySelector("table")?.textContent).toContain("员工");
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="编辑服化道"]')!.click();
  });
  const dialog = host.querySelector('[role="dialog"]')!;
  await act(async () => {
    dialog.querySelector<HTMLButtonElement>('button[aria-label="展开课程管理"]')!.click();
  });
  await act(async () => {
    dialog.querySelector<HTMLInputElement>('input[aria-label="courses.read"]')!.click();
  });
  await act(async () => {
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const [, options] = fetchMock.mock.calls[0]!;
  expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/admin/users/roles/wardrobe");
  expect(JSON.parse(options.body)).toEqual({
    permissions: ["ai_actors.read", "courses.read"],
  });
});

it("creates a custom employee role with the selected modules", async () => {
  fetchMock.mockResolvedValueOnce(envelope(initial));
  await render();
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("新建角色"))!
      .click();
  });
  const name = host.querySelector<HTMLInputElement>('input[name="roleName"]')!;
  const key = host.querySelector<HTMLInputElement>('input[name="roleKey"]')!;
  expect(key.title).toBe("须为小写字母。");
  expect(host.textContent).toContain("须为小写字母。");
  const write = (node: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const dialog = host.querySelector('[role="dialog"]')!;
  await act(async () => {
    write(name, "美术");
    write(key, "art");
  });
  await act(async () => {
    dialog.querySelector<HTMLButtonElement>('button[aria-label="展开课程管理"]')!.click();
  });
  await act(async () => {
    dialog.querySelector<HTMLInputElement>('input[aria-label="courses.read"]')!.click();
  });
  expect(dialog.textContent).not.toContain("courses.read");
  await act(async () => {
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const [, options] = fetchMock.mock.calls[0]!;
  expect(options.method).toBe("POST");
  expect(JSON.parse(options.body)).toEqual({
    key: "art",
    name: "美术",
    permissions: ["courses.read"],
  });
});

it("lets system roles be edited but not deleted", async () => {
  await act(async () =>
    root.render(
      <AdminSessionBoundary scopeKey="alice">
        <RolesPanel
          siteLabel="国际站"
          databaseLabel="生产库"
          initialData={{
            ...initial,
            roles: [
              {
                key: "operations",
                name: "Operations",
                description: "日常运营",
                accountCount: 0,
                permissions: ["ai_actors.read"],
              },
            ],
          }}
          initialError={null}
        />
      </AdminSessionBoundary>
    )
  );
  expect(host.textContent).toContain("运营");
  expect(host.textContent).toContain("系统");
  expect(host.querySelector('button[aria-label="查看运营"]')).toBeTruthy();
  expect(host.querySelector('button[aria-label="编辑运营"]')).toBeTruthy();
  expect(host.querySelector('button[aria-label="删除运营"]')).toBeNull();
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="查看运营"]')!.click();
  });
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("查看「运营」");
});

it("lets a folder checkbox grant every leaf in that directory", async () => {
  fetchMock.mockResolvedValueOnce(envelope(initial));
  await render();
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("新建角色"))!
      .click();
  });
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("AI演员");
  expect(dialog.textContent).toContain("课程管理");
  expect(dialog.textContent).toContain("媒体资产");
  await act(async () => {
    dialog.querySelector<HTMLInputElement>('input[aria-label="课程管理"]')!.click();
    dialog.querySelector<HTMLButtonElement>('button[aria-label="展开课程管理"]')!.click();
  });
  expect(dialog.querySelector<HTMLInputElement>('input[aria-label="courses.read"]')!.checked).toBe(
    true
  );
});
