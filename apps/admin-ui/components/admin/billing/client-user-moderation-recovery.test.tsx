// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { ClientUserModerationDialog } from "./client-user-moderation-dialog";
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
const onDone = vi.fn(),
  onClose = vi.fn();
const view = (mode: "edit" | "block", id = "alice") => (
  <ClientUserModerationDialog
    mode={mode}
    user={{ userId: id, nickName: id }}
    onClose={onClose}
    onDone={onDone}
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
    .find((button) => button.textContent?.trim() === text)!
    .click();
}
async function input(placeholder: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[aria-label="${placeholder}"]`)!;
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
it.each(["edit", "block"] as const)(
  "fences duplicate %s actions and retains failed drafts",
  async (mode) => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
    await render(view(mode));
    await input(mode === "edit" ? "昵称" : "屏蔽原因", "fixture draft");
    const label = mode === "edit" ? "保存" : "确认屏蔽";
    await act(async () => {
      click(label);
      click(label);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    await act(async () => pending.reject(new Error("Moderation unavailable")));
    expect(container.textContent).toContain("Moderation unavailable");
    expect(onClose).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>(
        `input[aria-label="${mode === "edit" ? "昵称" : "屏蔽原因"}"]`
      )?.value
    ).toBe("fixture draft");
    await act(async () => click(label));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  }
);
it.each(["edit", "block"] as const)("cancels %s requests when the target changes", async (mode) => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view(mode));
  if (mode === "block") await input("屏蔽原因", "fixture reason");
  await act(async () => click(mode === "edit" ? "保存" : "确认屏蔽"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view(mode, "bob"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(onDone).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>("input")?.disabled).toBe(false);
});
it("cancels a save when the administrator session changes", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view("edit"));
  await act(async () => click("保存"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view("edit"), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.reject(new Error("Old session error")));
  expect(container.textContent).not.toContain("Old session error");
});
it("encodes the user identifier as one path component", async () => {
  fetchMock.mockResolvedValue(response());
  await render(view("edit", "alice/segment"));
  await act(async () => click("保存"));
  expect(fetchMock.mock.calls[0][0]).toContain("alice%2Fsegment/info");
});
