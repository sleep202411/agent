// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { WorkspaceGrantDialog } from "./workspace-grant-dialog";
import type { AdminWorkspaceRow } from "./types";
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
const onGranted = vi.fn();
const workspace = (id = "workspace") =>
  ({
    id,
    site: "global",
    name: id,
    memberCount: 1,
    createdAt: "2026-09-01T00:00:00Z",
    hasWallet: true,
    availableBalance: "100",
  }) as AdminWorkspaceRow;
const credits = (id = "workspace") => (
  <WorkspaceGrantDialog workspace={workspace(id)} onClose={() => undefined} onGranted={onGranted} />
);
const grant = {
  id: "grant",
  planKey: "team",
  startsAt: "2026-09-01T00:00:00Z",
  endsAt: "2026-10-01T00:00:00Z",
};
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
function click(text: string) {
  [...container.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === text)!
    .click();
}
async function input(placeholder: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function setupReads() {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      response(
        url.includes("membership-plans")
          ? { items: [{ planKey: "team", name: "Team", benefits: {} }] }
          : []
      )
    )
  );
}
async function open(view: typeof credits) {
  setupReads();
  await render(view());
  if (view === credits) await input("例如 50000 或 -100", "100");
  await input(
    view === credits ? "例如 企业单发放、事故补偿" : "例如 临时提高并发、客服补偿",
    "fixture note"
  );
  if (view === credits)
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it.each([credits])("prevents duplicate grants and reuses the failed intent", async (view) => {
  await open(view);
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const label = view === credits ? "加积分" : "发放 Team Plan";
  await act(async () => {
    click(label);
    click(label);
  });
  const writes = () => fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
  expect(writes()).toHaveLength(1);
  const key = JSON.parse(writes()[0][1].body as string).idempotencyKey;
  expect(key).toBeTruthy();
  await act(async () => pending.reject(new Error("Response lost")));
  expect(container.textContent).toContain("Response lost");
  fetchMock.mockResolvedValueOnce(response(view === credits ? { availableBalance: "200" } : grant));
  await act(async () => click(label));
  expect(writes()).toHaveLength(2);
  expect(JSON.parse(writes()[1][1].body as string).idempotencyKey).toBe(key);
  expect(onGranted).toHaveBeenCalledTimes(1);
});
it.each([credits])(
  "suppresses abandoned grant results after changing the workspace",
  async (view) => {
    await open(view);
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => click(view === credits ? "加积分" : "发放 Team Plan"));
    const signal = fetchMock.mock.calls.find((call) => call[1]?.method === "POST")![1]
      .signal as AbortSignal;
    await render(view("replacement"));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      pending.resolve(response(view === credits ? { availableBalance: "200" } : grant))
    );
    expect(onGranted).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("成功");
  }
);

it("requires site confirmation and prepares a separate audited correction", async () => {
  await open(credits);
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  await act(async () => click("加积分"));
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).includes("workspace-credits"))
  ).toHaveLength(0);
  fetchMock.mockResolvedValue(response({ account: { availableBalance: "200" } }));
  await act(async () => checkbox.click());
  await act(async () => click("加积分"));
  await act(async () => click("填写反向调整"));
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder="例如 50000 或 -100"]')!.value
  ).toBe("-100");
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(container.textContent).toContain("国际站 .com");
});
