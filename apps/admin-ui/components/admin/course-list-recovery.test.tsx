// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "./admin-session-boundary";
import { CoursesListPage } from "./courses/courses-list-page";
import { emptyLocalizedCourse, type Course } from "./courses/types";
vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({ data, columns }: { data: Course[]; columns: ColumnDef<Course>[] }) => (
    <div>
      <span data-testid="records">{JSON.stringify(data)}</span>
      {data.map((item) => (
        <div key={item.id}>
          {columns
            .filter((column) => column.id === "actions")
            .map((column) =>
              typeof column.cell === "function" ? (
                <div key={column.id}>
                  {column.cell({ row: { original: item } } as CellContext<Course, unknown>)}
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
    asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
    asChild?: boolean;
  }) =>
    asChild ? (
      <span>{children}</span>
    ) : (
      <button {...props} data-variant={variant} data-size={size}>
        {children}
      </button>
    ),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./billing/shared", async (original) => ({
  ...(await original<typeof import("./billing/shared")>()),
  AdminDialog: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      {title}
      {children}
    </div>
  ),
  FormLabel: ({ children }: { children: ReactNode }) => <label>{children}</label>,
  Select: ({
    children,
    onChange,
    value,
  }: {
    children: ReactNode;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  ),
}));
vi.mock("@/components/ui/select", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Select: Wrap,
    SelectTrigger: Wrap,
    SelectContent: Wrap,
    SelectItem: Wrap,
    SelectValue: () => null,
  };
});
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fetchMock = vi.fn();
let root: Root | undefined;
let container: HTMLDivElement;
function response(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) };
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
  vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
    if (String(input).includes("user-levels/levels")) {
      return Promise.resolve(response({ code: 200, data: [] }));
    }
    return fetchMock(input, init);
  });
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{view}</AdminSessionBoundary>)
  );
}
const course = (id: string): Course => ({
  id,
  published: false,
  localized: emptyLocalizedCourse(),
  videos: [],
  instructors: [],
  certificateId: null,
  priceCredits: "",
  enrollmentEnabled: false,
  createTime: "",
  updateTime: "",
});
const items = [course("one"), course("two")];
const stats = { total: 40, published: 0, unpublished: 40, instructors: 0 };
const courses = () => (
  <CoursesListPage
    siteLabel="Global"
    databaseLabel="fixture"
    initialItems={items}
    initialStats={stats}
    initialTotal={40}
    loadError={null}
    initialQ="search"
    initialPublished="all"
    initialPage={1}
    pageSize={20}
  />
);
function button(text: string) {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text
  )!;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("refreshes the current course page after publishing instead of a memoized earlier page", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ items, stats, total: 40 }))
    .mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(response({ items, stats, total: 40 }));
  await render(courses());
  await act(async () => button("下一页").click());
  expect(fetchMock.mock.calls[0][0]).toContain("page=2");
  await act(async () => button("发布").click());
  expect(fetchMock.mock.calls[2][0]).toContain("page=2");
  expect(fetchMock.mock.calls[2][0]).toContain("q=search");
});
it("prevents overlapping publish actions on different records and suppresses abandoned failure", async () => {
  const request = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(request.promise);
  await render(courses());
  const publish = [...container.querySelectorAll("button")].filter(
    (item) => item.textContent?.trim() === "发布"
  );
  await act(async () => {
    publish[0].click();
    publish[1].click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(courses(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => request.reject(new Error("Old failure")));
  expect(container.textContent).not.toContain("Old failure");
});

it("resumes a queued course search after a publish operation finishes", async () => {
  vi.useFakeTimers();
  const request = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockReturnValueOnce(request.promise)
    .mockResolvedValue(response({ items, stats, total: 40 }));
  await render(courses());
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "new search"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("发布").click());
  await act(async () => vi.advanceTimersByTime(500));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve(response({})));
  await act(async () => vi.advanceTimersByTime(400));
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("q=new+search");
});
