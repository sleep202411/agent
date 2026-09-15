// @vitest-environment jsdom
import { act, createContext, useContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpTitlesPanel } from "./titles-panel";
import type { IpRow, AdminIpDetail } from "./types";
vi.mock("./ip-revenue-section", () => ({ IpRevenueSection: () => null }));
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
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const detail = {
  id: "one",
  title: "Original title",
  summary: "Summary",
  status: "in_review",
  listingVisibility: "private",
  version: 1,
  sourceLocale: "en-US",
  genres: [],
  episodes: [],
  assets: [],
  priceRules: [],
  recentOrders: [],
  review: { openReportCount: 1, needsAttention: true },
  reports: [{ id: "report-one", status: "submitted", reason: "other", createdAt: null }],
} as unknown as AdminIpDetail;
it("excludes duplicate publication and competing report actions and retains failed drafts", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockResolvedValueOnce(response({ ip: detail }))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(response({ ip: detail, items: [], nextCursor: null }));
  await render(view());
  await act(async () => click("查看"));
  await act(async () => {
    click("批准");
    click("批准");
    click("跟进");
  });
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PATCH")).toHaveLength(1);
  expect(container.querySelector("textarea")?.disabled).toBe(true);
  const reason = container.querySelector("textarea")?.value;
  await act(async () => pending.reject(new Error("Publication unavailable")));
  expect(container.textContent).toContain("Publication unavailable");
  expect(container.querySelector("textarea")?.value).toBe(reason);
  await act(async () => click("批准"));
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PATCH")).toHaveLength(2);
});
it("cancels closed publication and suppresses its delayed refresh", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockResolvedValueOnce(response({ ip: detail }))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(response({ ip: detail }));
  await render(view());
  await act(async () => click("查看"));
  await act(async () => click("批准"));
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await act(async () => click("Close detail"));
  await act(async () => click("查看"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response({ ip: { ...detail, title: "Abandoned title" } })));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toContain("Abandoned title");
});
it("keeps report failures retryable and cancels replacement-session results", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockResolvedValueOnce(response({ ip: detail }))
    .mockRejectedValueOnce(new Error("Report unavailable"))
    .mockReturnValueOnce(pending.promise);
  await render(view());
  await act(async () => click("查看"));
  await act(async () => click("跟进"));
  expect(container.textContent).toContain("Report unavailable");
  await act(async () => {
    click("跟进");
    click("驳回");
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const signal = fetchMock.mock.calls[2][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
