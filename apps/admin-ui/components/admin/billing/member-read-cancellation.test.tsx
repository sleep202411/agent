// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { MemberDirectoryPanel } from "./member-directory-panel";
import { MemberWorkspacesDrawer } from "./member-workspaces-drawer";
import type { AdminWorkspaceRow } from "./types";
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({
    data,
    columns,
  }: {
    data: { id: string }[];
    columns: ColumnDef<{ id: string }>[];
  }) => (
    <div>
      {data.map((row) => (
        <div key={row.id}>
          {columns
            .filter((column) => column.id === "actions")
            .map((column) =>
              typeof column.cell === "function" ? (
                <div key={column.id}>
                  {column.cell({ row: { original: row } } as CellContext<{ id: string }, unknown>)}
                </div>
              ) : null
            )}
        </div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));
vi.mock("./shared", async (original) => ({
  ...(await original<typeof import("./shared")>()),
  AdminDialog: ({
    open,
    children,
    footer,
    onClose,
  }: {
    open: boolean;
    children: ReactNode;
    footer: ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <div role="dialog">
        {children}
        {footer}
        <button onClick={onClose}>Dismiss</button>
      </div>
    ) : null,
  Select: ({
    children,
    value,
    name,
    defaultValue,
    onChange,
  }: {
    children: ReactNode;
    value?: string;
    name?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
  }) => (
    <select
      name={name}
      defaultValue={defaultValue}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const workspace = {
  id: "workspace",
  name: "Saved workspace",
  ownerUserId: "owner",
  memberCount: 1,
  status: "active",
  createdAt: "2026-09-01T00:00:00Z",
  hasWallet: true,
  availableBalance: "100",
  heldBalance: "0",
} as AdminWorkspaceRow;
const directory = () => <MemberDirectoryPanel canReadWorkspaces={false} canWriteBilling={false} />;
const drawer = (id = "alice", canWrite = false) => (
  <MemberWorkspacesDrawer
    member={{ userId: id, nickName: id, email: null, phone: null }}
    canWrite={canWrite}
    onClose={() => undefined}
  />
);
const members = (page = 1) => ({
  items: [
    {
      userId: "saved",
      nickName: "Saved member",
      phone: null,
      email: null,
      accountStatus: 0,
      createTime: null,
    },
  ],
  page,
  pageSize: 20,
  total: 40,
});
function response(data: unknown = {}) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(view: ReactNode, session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{view}</AdminSessionBoundary>)
  );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("cancels directory reads after unmount", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(directory());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(null);
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response(members())));
  expect(container.textContent).not.toContain("Saved member");
});
it("cancels chained owner lookup when selecting another member", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockResolvedValueOnce(response({ items: [workspace] }))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response({ items: [] }));
  await render(drawer());
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render(drawer("bob"));
  expect(signal.aborted).toBe(true);
  await act(async () =>
    pending.resolve(response({ items: [{ userId: "owner", nickName: "Old owner" }] }))
  );
  expect(container.textContent).not.toContain("Old owner");
  expect(container.textContent).not.toContain("Saved workspace");
});

it("distinguishes a failed workspace read from empty membership and retries it", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Workspace read unavailable"));
  await render(drawer());
  expect(container.textContent).toContain("Workspace read unavailable");
  expect(container.textContent).not.toContain("该用户没有任何工作区");
  fetchMock
    .mockResolvedValueOnce(response({ items: [workspace] }))
    .mockResolvedValueOnce(response({ items: [] }));
  const retry = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Retry")
  )!;
  await act(async () => retry.click());
  expect(container.textContent).toContain("Saved workspace");
  expect(container.textContent).not.toContain("Workspace read unavailable");
  expect(
    fetchMock.mock.calls.every(([, options]) => !options.method || options.method === "GET")
  ).toBe(true);
});

vi.mock("./workspace-grant-dialog", () => ({
  WorkspaceGrantDialog: () => <div role="dialog">Credit adjustment</div>,
}));
vi.mock("./grant-membership-dialog", () => ({
  GrantMembershipDialog: () => <div role="dialog">Membership adjustment</div>,
}));
it.each(["调整积分", "工作区会员"])(
  "closes %s when selecting a different member",
  async (label) => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [workspace] }))
      .mockResolvedValueOnce(response({ items: [] }));
    await render(drawer("alice", true));
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === label
    )!;
    await act(async () => button.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    fetchMock.mockResolvedValueOnce(response({ items: [] }));
    await render(drawer("bob", true));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  }
);
