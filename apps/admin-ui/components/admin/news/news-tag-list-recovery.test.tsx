// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { NewsTagDialog } from "./news-tag-dialog";
import { NewsListPage } from "./news-list-page";
import { emptyLocalizedContent, type NewsArticle } from "./types";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/news" }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogContent: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => Promise<void> }) => {
    const [error, setError] = useState("");
    return open ? (
      <div>
        <button
          onClick={() => {
            void onConfirm().catch((err: Error) => setError(err.message));
          }}
        >
          Confirm delete
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    ) : null;
  },
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

const saved = vi.fn();
const closed = vi.fn();
const tag = (id = "one") => (
  <NewsTagDialog
    target={{ id, label: { "zh-CN": "Original", "en-US": "", "zh-HK": "" } }}
    onClose={closed}
    onSaved={saved}
  />
);
const localized = emptyLocalizedContent();
localized["zh-CN"] = { ...localized["zh-CN"], title: "Original", body: "Body" };
const article = {
  id: "one",
  kind: "article",
  status: "draft",
  localized,
  tagIds: [],
  author: "Author",
  url: "",
  publishedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as NewsArticle;
const list = () => (
  <NewsListPage
    siteLabel="Global"
    databaseLabel="Fixture"
    items={[article]}
    stats={null}
    total={1}
    tags={[]}
    loadError={null}
    kind="all"
    status="all"
    q=""
    page={1}
    pageSize={20}
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

it("excludes duplicate tag saves and preserves failed labels for retry", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render(tag());
  await act(async () => {
    click("保存");
    click("保存");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    [...container.querySelectorAll("button")].find((item) => item.textContent === "保存中…")
      ?.disabled
  ).toBe(true);
  await act(async () => pending.reject(new Error("Tag unavailable")));
  expect(container.textContent).toContain("Tag unavailable");
  expect(container.querySelector<HTMLInputElement>('input[placeholder="标签名"]')?.value).toBe(
    "Original"
  );
  await act(async () => click("保存"));
  expect(saved).toHaveBeenCalledOnce();
});
it("cancels an old tag target and suppresses its saved callback", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(tag());
  await act(async () => click("保存"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(tag("two"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(saved).not.toHaveBeenCalled();
});
it("keeps failed delete confirmations retryable and excludes repeated requests", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render(list());
  await act(async () => click("删除"));
  await act(async () => {
    click("Confirm delete");
    click("Confirm delete");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Delete unavailable")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Delete unavailable");
  await act(async () => click("Confirm delete"));
  expect(router.refresh).toHaveBeenCalledOnce();
});
it("suppresses delayed delete errors and refreshes after account replacement", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(list());
  await act(async () => click("删除"));
  await act(async () => click("Confirm delete"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(list(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.reject(new Error("Old delete")));
  expect(container.textContent).not.toContain("Old delete");
  expect(router.refresh).not.toHaveBeenCalled();
});
