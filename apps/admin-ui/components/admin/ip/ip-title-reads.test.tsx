// @vitest-environment jsdom
import { act, createContext, useContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpTitlesPanel } from "./titles-panel";
import type { IpRow } from "./types";
vi.mock("@/components/ui/sheet", () => {
  const Context = createContext<(open: boolean) => void>(() => undefined);
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: ReactNode;
    }) =>
      open ? (
        <Context.Provider value={onOpenChange}>
          <div role="dialog">{children}</div>
        </Context.Provider>
      ) : null,
    SheetClose: () => {
      const close = useContext(Context);
      return <button onClick={() => close(false)}>Close detail</button>;
    },
    SheetContent: Part,
    SheetHeader: Part,
    SheetTitle: Part,
  };
});
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
          <span>{row.id}</span>
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();

const view = () => (
  <IpTitlesPanel
    siteLabel="Global"
    databaseLabel="Fixture"
    initialIps={{ items: [{ id: "one" } as IpRow], nextCursor: "old-cursor" }}
    taxonomy={null}
    initialError={null}
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
    .find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === text)!
    .click();
}
async function input(placeholder: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("cancels a closed detail and suppresses its late failure", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("查看"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("Close detail"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.reject(new Error("Abandoned detail")));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain("Abandoned detail");
});
it("reopens details after the first read fails", async () => {
  fetchMock.mockRejectedValue(new Error("Detail unavailable"));
  await render(view());
  await act(async () => click("查看"));
  expect(container.textContent).toContain("Detail unavailable");
  await act(async () => click("Close detail"));
  await act(async () => click("查看"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
});
it("starts fresh after filters change rather than appending an old cursor", async () => {
  fetchMock.mockResolvedValue(response({ items: [], nextCursor: null }));
  await render(view());
  await input("Search title, room number, slug or summary", "changed");
  await act(async () => click("加载更多"));
  expect(fetchMock.mock.calls[0][0]).toContain("q=changed");
  expect(fetchMock.mock.calls[0][0]).not.toContain("cursor=");
});
it("retains a failed page for retry and cancels the replacement session's abandoned read", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockRejectedValueOnce(new Error("Page unavailable")).mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("加载更多"));
  expect(container.textContent).toContain("one");
  await act(async () => click("加载更多"));
  expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () =>
    pending.resolve(response({ items: [{ id: "old-account" }], nextCursor: null }))
  );
  expect(container.textContent).not.toContain("old-account");
});
