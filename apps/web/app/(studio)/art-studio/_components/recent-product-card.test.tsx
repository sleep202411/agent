import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ user: "a", post: vi.fn(), toast: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://example.test" } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: s.invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success: s.toast, error: s.toast } }));
vi.mock("./create-world-dialog", () => ({ CreateWorldDialog: () => null }));
vi.mock("@/app/(studio)/art-studio/projects/_components/project-editor-dialog", () => ({
  ProjectEditorDialog: ({ open, project }: { open: boolean; project: { id: string } | null }) =>
    open ? <div data-editor={project?.id} /> : null,
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Wrap,
    DropdownMenuContent: Wrap,
    DropdownMenuTrigger: Wrap,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: ReactNode;
      onSelect: () => void;
      disabled: boolean;
    }) => (
      <button disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
  };
});
vi.mock("@/components/ui/alert-dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div data-confirm>{children}</div> : null,
    AlertDialogContent: Wrap,
    AlertDialogHeader: Wrap,
    AlertDialogTitle: Wrap,
    AlertDialogDescription: Wrap,
    AlertDialogFooter: Wrap,
    AlertDialogCancel: Wrap,
    AlertDialogAction: ({
      children,
      onClick,
      disabled,
    }: {
      children: ReactNode;
      onClick: () => void;
      disabled: boolean;
    }) => (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  };
});
import { ProductCard } from "./recent-projects-preview";
let root: Root;
let node: HTMLDivElement;
async function render(id = "p") {
  await act(async () =>
    root.render(
      <ProductCard
        product={{ id, worldId: "w", name: "Project", imagePath: "", description: null }}
      />
    )
  );
}
function button(text: string, confirm = false) {
  return [
    ...(confirm ? node.querySelector("[data-confirm]")! : node).querySelectorAll<HTMLButtonElement>(
      "button"
    ),
  ].find((b) => b.textContent === text)!;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.post.mockReset();
  s.toast.mockReset();
  s.invalidate.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});

it("keeps failed and missing-project lookups out of confirmation", async () => {
  s.post.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ list: [], totalCount: 0 });
  await render();
  await act(async () => button("projectMenuDelete").click());
  expect(node.querySelector("[data-confirm]")).toBeNull();
  expect(s.toast).toHaveBeenCalledWith("Offline");
  await act(async () => button("projectMenuDelete").click());
  expect(node.querySelector("[data-confirm]")).toBeNull();
});
it("guards duplicate preparation and rejects late account-replaced confirmations", async () => {
  let resolve!: (v: object) => void;
  s.post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    button("projectMenuDelete").click();
    button("projectMenuDelete").click();
  });
  expect(s.post).toHaveBeenCalledTimes(1);
  const signal = s.post.mock.calls[0][1].signal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ list: [{ id: "p" }], totalCount: 1 }));
  expect(node.querySelector("[data-confirm]")).toBeNull();
});
it("requires a total count of one before choosing world deletion", async () => {
  s.post.mockResolvedValueOnce({ list: [{ id: "p" }], totalCount: 3 }).mockResolvedValue({});
  await render();
  await act(async () => button("projectMenuDelete").click());
  await act(async () => {
    button("projectMenuDelete", true).click();
    button("projectMenuDelete", true).click();
  });
  expect(s.post).toHaveBeenCalledTimes(2);
  expect(s.post.mock.calls[1][0]).toContain("delete/worldproduct?id=p");
});
it("keeps rejected deletion open and retryable", async () => {
  s.post
    .mockResolvedValueOnce({ list: [{ id: "p" }], totalCount: 1 })
    .mockRejectedValueOnce(new Error("Denied"))
    .mockResolvedValue({});
  await render();
  await act(async () => button("projectMenuDelete").click());
  await act(async () => button("projectMenuDelete", true).click());
  expect(s.post.mock.calls[1][0]).toBe("/api/user/world/delete/world");
  expect(node.querySelector("[data-confirm]")).not.toBeNull();
  await act(async () => button("projectMenuDelete", true).click());
  expect(node.querySelector("[data-confirm]")).toBeNull();
});
