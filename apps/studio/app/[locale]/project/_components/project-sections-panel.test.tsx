import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSectionsPanel } from "./project-sections-panel";
const state = vi.hoisted(() => ({ archive: vi.fn(), error: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("./project-context", () => ({ useProjectContext: () => ({ canEdit: true }) }));
vi.mock("../_stores/project-ui-store", () => ({ useProjectUIStore: () => vi.fn() }));
vi.mock("./project-sections-context", () => ({
  useProjectSections: () => ({
    sections: [
      { id: "one", title: "Opening" },
      { id: "two", title: "Finale" },
    ],
    activeSection: { id: "one" },
    status: "ready",
    archiveSection: state.archive,
  }),
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function button(root: ParentNode, text: string) {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === text
  )!;
}
async function openArchive() {
  act(() => root.render(<ProjectSectionsPanel />));
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  );
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (node) => node.textContent === "archive"
  )!;
  await act(async () => item.click());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
}
it("keeps archive confirmation while saving, retains it on failure and closes only after retry succeeds", async () => {
  let reject!: (reason: Error) => void;
  state.archive.mockReturnValueOnce(
    new Promise<void>((_, no) => {
      reject = no;
    })
  );
  await openArchive();
  await act(async () => button(document.querySelector('[role="alertdialog"]')!, "archive").click());
  const pending = document.querySelector('[role="alertdialog"]');
  expect(pending).not.toBeNull();
  expect(button(pending!, "archive").disabled).toBe(true);
  expect(state.archive).toHaveBeenCalledExactlyOnceWith("one");
  await act(async () => reject(new Error("Archive unavailable")));
  expect(state.error).toHaveBeenCalledWith("Archive unavailable");
  const retry = document.querySelector('[role="alertdialog"]');
  expect(retry).not.toBeNull();
  expect(button(retry!, "archive").disabled).toBe(false);
  state.archive.mockResolvedValueOnce(undefined);
  await act(async () => button(retry!, "archive").click());
  expect(state.archive).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
it("cancels archiving without issuing a mutation", async () => {
  await openArchive();
  await act(async () => button(document.querySelector('[role="alertdialog"]')!, "cancel").click());
  expect(state.archive).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
