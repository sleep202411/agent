// @vitest-environment jsdom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcher } from "./workspace-switcher";
const state = vi.hoisted(() => ({ id: "a", create: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("./auth-provider", () => ({ useAuth: () => ({ user: { id: state.id } }) }));
vi.mock("./workspace-context", () => ({
  useWorkspace: () => ({
    activeWorkspace: { id: "team", name: "Team", role: "owner" },
    workspaces: [{ id: "team", name: "Team", role: "owner" }],
    createWorkspace: state.create,
    setActiveWorkspaceId: vi.fn(),
  }),
}));
vi.mock("./credits-badge", () => ({
  useComputeWalletBalance: () => ({ data: { available: BigInt(10) } }),
}));
vi.mock("./share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Part = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    DropdownMenu: Part,
    DropdownMenuContent: Part,
    DropdownMenuTrigger: Part,
    DropdownMenuLabel: Part,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children, onSelect }: PropsWithChildren<{ onSelect?: () => void }>) => (
      <button onClick={onSelect}>{children}</button>
    ),
  };
});
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
      open ? <div data-dialog>{children}</div> : null,
    DialogClose: Part,
    DialogContent: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
describe("workspace creation ownership", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.id = "a";
    state.create.mockReset();
    state.success.mockReset();
    state.error.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const render = () => act(async () => root.render(<WorkspaceSwitcher />));
  const open = () =>
    act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "createWorkspace")!
        .click();
    });
  const fill = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>("#team-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("[data-dialog] button")).find(
      (b) => b.textContent === "createWorkspace"
    )!;
  it("guards duplicate starts and preserves a replacement after cancellation", async () => {
    let old!: () => void;
    let replacement!: () => void;
    state.create
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            old = () => r({ id: "old" });
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            replacement = () => r({ id: "new" });
          })
      );
    await render();
    await open();
    await fill("Old");
    await act(async () => {
      submit().click();
      submit().click();
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    const signal = state.create.mock.calls[0][3] as AbortSignal;
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("[data-dialog] button"))
        .find((b) => b.textContent === "cancel")!
        .click();
    });
    expect(signal.aborted).toBe(true);
    await open();
    await fill("New");
    await act(async () => submit().click());
    await act(async () => old());
    expect(submit().disabled).toBe(true);
    expect(state.success).not.toHaveBeenCalled();
    await act(async () => replacement());
    expect(state.success).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-dialog]")).toBeNull();
  });
  it("aborts creation and suppresses messages after account changes", async () => {
    let resolve!: () => void;
    state.create.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = () => r({ id: "old" });
        })
    );
    await render();
    await open();
    await fill("Old");
    await act(async () => submit().click());
    const signal = state.create.mock.calls[0][3] as AbortSignal;
    state.id = "b";
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve());
    expect(state.success).not.toHaveBeenCalled();
    expect(container.querySelector("[data-dialog]")).toBeNull();
  });
});
