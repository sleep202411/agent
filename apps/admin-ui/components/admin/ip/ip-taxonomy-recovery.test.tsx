// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpTaxonomyPanel } from "./taxonomy-panel";
import type { IpTaxonomyTerm } from "./types";
vi.mock("@/components/ui/sheet", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    SheetContent: Part,
    SheetDescription: Part,
    SheetFooter: Part,
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
const term = {
  id: "one",
  type: "genre",
  code: "genre",
  label: "Original",
  status: "active",
  displayOrder: 1,
  localizations: [{ locale: "en-US", label: "Original" }],
  assignmentCount: 0,
} as IpTaxonomyTerm;
const view = () => (
  <IpTaxonomyPanel
    siteLabel="Global"
    databaseLabel="Fixture"
    initialTaxonomy={{ items: [term] }}
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

it("excludes duplicate creates, pauses editing and retains failed drafts", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response({ items: [term] }));
  await render(view());
  await act(async () => click("新增词条"));
  await input("English label", "New label");
  await act(async () => {
    click("创建词条");
    click("创建词条");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[inert]")).not.toBeNull();
  await act(async () => pending.reject(new Error("Save unavailable")));
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder="English label"]')?.value
  ).toBe("New label");
  expect(container.textContent).toContain("Save unavailable");
  await act(async () => click("创建词条"));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("cancels an abandoned update without closing the replacement draft", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("编辑"));
  await input("English label", "Changed");
  await act(async () => click("保存词条"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view(), "bob");
  await act(async () => click("新增词条"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});
it("retains loaded terms through refresh failure and retries", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("Read unavailable"))
    .mockResolvedValue(response({ items: [] }));
  await render(view());
  await act(async () => click("刷新词库"));
  expect(container.textContent).toContain("one");
  expect(container.textContent).toContain("Read unavailable");
  await act(async () => click("刷新词库"));
  expect(container.textContent).not.toContain("one");
});
