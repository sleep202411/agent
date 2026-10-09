// @vitest-environment jsdom
import { act, createContext, useContext, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ColumnDef, CellContext } from "@tanstack/react-table";
import { AdminSessionBoundary } from "./admin-session-boundary";
import { AdminUsersPanel, type AdminUserRow } from "./admin-users-panel";
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
            .filter(
              (column) =>
                column.id === "actions" ||
                ("accessorKey" in column && column.accessorKey === "activeSessionCount")
            )
            .map((column, index) => (
              <div key={index}>
                {typeof column.cell === "function"
                  ? column.cell({ row: { original: row } } as CellContext<{ id: string }, unknown>)
                  : null}
              </div>
            ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ui/dialog", () => {
  const Context = createContext<() => void>(() => undefined);
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: ReactNode;
    }) =>
      open ? (
        <Context.Provider value={() => onOpenChange(false)}>
          <div role="dialog">{children}</div>
        </Context.Provider>
      ) : null,
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogClose: () => {
      const close = useContext(Context);
      return <button onClick={close}>Dismiss</button>;
    },
  };
});
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => Promise<void> | void }) => {
    const [error, setError] = useState("");
    return (
      <div>
        <button
          onClick={() => {
            void Promise.resolve()
              .then(onConfirm)
              .catch((err: Error) => setError(err.message));
          }}
        >
          Confirm MFA
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    );
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const user = (id: string) =>
  ({
    id,
    email: `${id}@example.com`,
    displayName: id,
    roleKey: "operations",
    status: "active",
    platformUserId: null,
    activeSessionCount: 2,
    requireMfa: true,
    updatedAt: "2026-09-01T00:00:00Z",
  }) as AdminUserRow;
const data = { items: [user("one"), user("two")], page: 1, pageSize: 20, total: 2 };
const view = () => (
  <AdminUsersPanel
    currentUserId="none"
    siteLabel="Global"
    siteDomain="fixture"
    databaseLabel="Fixture"
    initialData={data}
  />
);
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
async function render(content: ReactNode = view(), session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{content}</AdminSessionBoundary>)
  );
}
function buttons(label: string) {
  return [...container.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === label
  );
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("prevents duplicate creates and retains a failed form", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response(user("new")));
  await render();
  await act(async () => {
    submit();
    submit();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
  await act(async () => pending.reject(new Error("Create unavailable")));
  expect(container.textContent).toContain("Create unavailable");
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(false);
  fetchMock.mockResolvedValueOnce(response(user("new"))).mockResolvedValueOnce(response(data));
  await act(async () => submit());
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(2);
});
it("prevents session revocations on different rows from overlapping", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render();
  const revoke = buttons("撤销");
  await act(async () => {
    revoke[0].click();
    revoke[1].click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await render(view(), "bob");
  await act(async () => pending.reject(new Error("Old revoke failure")));
  expect(container.textContent).not.toContain("Old revoke failure");
});
it("propagates MFA failure to the confirmation for retry", async () => {
  fetchMock.mockRejectedValueOnce(new Error("MFA unavailable"));
  await render();
  await act(async () => buttons("Confirm MFA")[0].click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("MFA unavailable");
  fetchMock.mockResolvedValueOnce(response(user("one")));
  await act(async () => buttons("Confirm MFA")[0].click());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("cancels the session read when its dialog closes", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("活跃"))!
      .click()
  );
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => buttons("Dismiss")[0].click());
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response({ items: [] })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("suppresses accepted create results after an administrator session change", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render();
  await act(async () => submit());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response(user("new"))));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("已创建后台账号");
});
it("uses the latest search in a row action's follow-up read", async () => {
  fetchMock.mockResolvedValueOnce(response(data));
  await render();
  const input = container.querySelector<HTMLInputElement>('input[placeholder="搜索邮箱或姓名"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "new query"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(250));
  fetchMock
    .mockResolvedValueOnce(response({ revokedCount: 1 }))
    .mockResolvedValueOnce(response(data));
  await act(async () => buttons("撤销")[0].click());
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("q=new+query");
});
