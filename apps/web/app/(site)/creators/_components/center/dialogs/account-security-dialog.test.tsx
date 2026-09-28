import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AccountSecurityDialog } from "./account-security-dialog";
const mock = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), close: vi.fn() }));
vi.mock("@repo/auth-flow", () => ({
  AuthClient: class {
    setPassword = mock.save;
  },
  AuthRequestError: class extends Error {},
  errorText: vi.fn(),
}));
vi.mock("@/src/lib/auth/transport", () => ({ createWebAuthTransport: vi.fn() }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("sonner", () => ({ toast: { success: mock.success } }));
vi.mock("@/components/ui/dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Wrap,
    DialogDescription: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
  };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function render(open = true) {
  await act(async () =>
    root.render(<AccountSecurityDialog open={open} onOpenChange={mock.close} />)
  );
}
function type(id: string, value: string) {
  const el = container.querySelector<HTMLInputElement>(`#${id}`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
async function fill() {
  await act(async () => {
    type("new-password", "test-secret");
    type("confirm-new-password", "test-secret");
  });
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
it.each(["success", "failure"])(
  "ignores an old %s after closing and reopening",
  async (outcome) => {
    let resolve!: () => void, reject!: (e: Error) => void;
    mock.save.mockImplementation(
      () =>
        new Promise<void>((a, b) => {
          resolve = a;
          reject = b;
        })
    );
    await render();
    await fill();
    await act(async () => submit());
    await render(false);
    await render(true);
    await act(async () => (outcome === "success" ? resolve() : reject(new Error("old failure"))));
    expect(mock.close).not.toHaveBeenCalled();
    expect(mock.success).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("errorServer");
  }
);
it("keeps ordinary save success and prevents editing a pending submission", async () => {
  let resolve!: () => void;
  mock.save.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await fill();
  await act(async () => submit());
  expect(container.querySelector<HTMLInputElement>("#new-password")!.disabled).toBe(true);
  await act(async () => resolve());
  expect(mock.close).toHaveBeenCalledWith(false);
  expect(mock.success).toHaveBeenCalledWith("saved");
});

it("retains an active failure for retry and prevents duplicate submissions", async () => {
  let reject!: (error: Error) => void;
  mock.save.mockImplementationOnce(
    () =>
      new Promise<void>((_, r) => {
        reject = r;
      })
  );
  await render();
  await fill();
  await act(async () => {
    submit();
    submit();
  });
  expect(mock.save).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("service failure")));
  expect(container.textContent).toContain("errorServer");
  expect(container.querySelector<HTMLInputElement>("#new-password")!.value).toBe("test-secret");
  mock.save.mockResolvedValueOnce(undefined);
  await act(async () => submit());
  expect(mock.close).toHaveBeenCalledWith(false);
});
