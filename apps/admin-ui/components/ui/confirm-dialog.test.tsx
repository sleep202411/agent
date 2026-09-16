// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";
vi.mock("@/components/ui/dialog", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    createElement("div", null, children);
  return {
    Dialog: Wrapper,
    DialogClose: Wrapper,
    DialogContent: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
    DialogTrigger: Wrapper,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    createElement("button", { ...props, "data-variant": _variant }, children),
}));
vi.mock("@tabler/icons-react", () => ({ IconLoader2: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
let open = true;
const confirm = vi.fn<() => Promise<void>>();
const changed = vi.fn();
async function render() {
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <ConfirmDialog
        title="Delete item"
        confirmLabel="Confirm"
        open={open}
        onOpenChange={changed}
        onConfirm={confirm}
      />
    )
  );
}
function click() {
  [...container.querySelectorAll("button")]
    .find((button) => button.textContent === "Confirm")!
    .click();
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  open = true;
  vi.resetAllMocks();
});
it("guards same-tick confirms and keeps failed confirmations open for retry", async () => {
  const request = deferred();
  confirm.mockReturnValueOnce(request.promise).mockResolvedValueOnce(undefined);
  await render();
  await act(async () => {
    click();
    click();
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => request.reject(new Error("Permission changed")));
  expect(changed).not.toHaveBeenCalled();
  await act(async () => click());
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenCalledWith(false);
});
it("suppresses old completion and cleanup after a controlled dialog closes and reopens", async () => {
  const old = deferred();
  const replacement = deferred();
  confirm.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
  await render();
  await act(async () => click());
  open = false;
  await render();
  open = true;
  await render();
  await act(async () => click());
  await act(async () => old.resolve());
  expect(changed).not.toHaveBeenCalled();
  expect([...container.querySelectorAll("button")].at(-1)?.disabled).toBe(true);
  await act(async () => replacement.resolve());
  expect(changed).toHaveBeenCalledTimes(1);
});
it("does not call the parent close callback after unmount", async () => {
  const request = deferred();
  confirm.mockReturnValueOnce(request.promise);
  await render();
  await act(async () => click());
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => request.resolve());
  expect(changed).not.toHaveBeenCalled();
});
