import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { LinkStudioMediaDialog } from "./link-studio-media-dialog";

const h = vi.hoisted(() => ({
  user: "alice",
  error: false,
  fetching: false,
  missing: false,
  removed: false,
  pull: vi.fn(),
  bind: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.failure } }));
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Box,
    DialogBody: Box,
    DialogContent: Box,
    DialogDescription: Box,
    DialogFooter: Box,
    DialogHeader: Box,
    DialogTitle: Box,
  };
});
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    onChange,
    ...props
  }: Omit<import("react").SelectHTMLAttributes<HTMLSelectElement>, "onChange"> & {
    onChange: (value: string) => void;
  // eslint-disable-next-line no-restricted-syntax -- NativeSelect test double, not a product dropdown.
  }) => <select {...props} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets", () => ({
  useCrewStudioMediaOptions: (
    _crew: string,
    _enabled: boolean,
    filter?: { projectId?: string; storyProjectId?: string }
  ) => {
    const id = filter?.projectId ?? filter?.storyProjectId ?? "all";
    return {
      isSuccess: !h.error,
      isFetching: h.fetching,
      isError: h.error,
      isLoading: false,
      error: h.error ? new Error("Access denied") : null,
      refetch: vi.fn(),
      data: {
        workspaceId: h.missing ? null : "ws",
        projects: [
          { id: "a", name: "Canvas A", kind: "canvas" },
          { id: "b", name: "Story B", kind: "story" },
        ],
        items: h.removed
          ? []
          : [{ id: `media-${id}`, name: `Media ${id}`, contentType: "video/mp4", kind: "video" }],
      },
    };
  },
  useLinkCrewStudioMedia: () => ({ isPending: false, mutateAsync: h.pull }),
  useSetCrewAssetStudioLink: () => ({ isPending: false, mutateAsync: h.bind }),
}));
let root: Root, host: HTMLDivElement;
let props: { open: boolean; crewId: string; parentId: string | null; bindNodeId?: string | null };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(h, {
    user: "alice",
    error: false,
    fetching: false,
    missing: false,
    removed: false,
  });
  vi.clearAllMocks();
  h.pull.mockReset().mockResolvedValue({ items: [{}] });
  h.bind.mockReset().mockResolvedValue({});
  props = { open: true, crewId: "crew-1", parentId: "folder-1" };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<LinkStudioMediaDialog {...props} onOpenChange={h.close} />));
}
function button(label = "linkStudioConfirm") {
  return [...host.querySelectorAll("button")].find((el) => el.textContent === label)!;
}
async function choose() {
  await act(async () => host.querySelector<HTMLInputElement>("input")!.click());
}
async function source(value: string) {
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit(label?: string) {
  await act(async () => button(label).click());
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("clears selection across canvas/story/all sources and submits only the current source", async () => {
  await render();
  await choose();
  await source("canvas:a");
  expect(button().disabled).toBe(true);
  await choose();
  await source("story:b");
  expect(button().disabled).toBe(true);
  await choose();
  await submit();
  expect(h.pull).toHaveBeenCalledWith({
    parentId: "folder-1",
    mediaAssetIds: ["media-b"],
    projectId: null,
    storyProjectId: "b",
  });
  expect(h.close).toHaveBeenCalledWith(false);
  await source("");
  expect(button().disabled).toBe(true);
});
it.each(["error", "fetching", "missing", "removed"] as const)(
  "blocks selected media when the source becomes %s",
  async (state) => {
    await render();
    await choose();
    h[state] = true;
    await render();
    await submit();
    expect(h.pull).not.toHaveBeenCalled();
    expect(button().disabled).toBe(true);
  }
);
it("locks the source and prevents duplicate writes while saving", async () => {
  const pending = deferred();
  h.pull.mockReturnValue(pending.promise);
  await render();
  await choose();
  await act(async () => {
    button().click();
    button().click();
  });
  expect(h.pull).toHaveBeenCalledTimes(1);
  expect(host.querySelector("select")!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  await act(async () => pending.resolve({ items: [{}] }));
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("retains selection after failure and permits explicit retry", async () => {
  h.pull.mockRejectedValueOnce(new Error("Source changed"));
  await render();
  await choose();
  await submit();
  expect(h.failure).toHaveBeenCalledWith("Source changed");
  expect(h.close).not.toHaveBeenCalled();
  expect(button().disabled).toBe(false);
  await submit();
  expect(h.pull).toHaveBeenCalledTimes(2);
  expect(h.pull.mock.calls[0]).toEqual(h.pull.mock.calls[1]);
});
it.each(["account", "crew", "folder", "binding", "closed"])(
  "drops drafts and late success on %s changes",
  async (change) => {
    const pending = deferred();
    h.pull.mockReturnValue(pending.promise);
    await render();
    await choose();
    await submit();
    if (change === "account") h.user = "bob";
    if (change === "crew") props.crewId = "crew-2";
    if (change === "folder") props.parentId = "folder-2";
    if (change === "binding") props.bindNodeId = "node-2";
    if (change === "closed") props.open = false;
    await render();
    await act(async () => pending.resolve({ items: [{}] }));
    expect(h.close).not.toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
    props.open = true;
    await render();
    expect(button(change === "binding" ? "bindStudioConfirm" : undefined).disabled).toBe(true);
  }
);
it("suppresses late errors after logout", async () => {
  const pending = deferred();
  h.pull.mockReturnValue(pending.promise);
  await render();
  await choose();
  await submit();
  h.user = "";
  await render();
  await act(async () => pending.reject(new Error("Late failure")));
  expect(h.failure).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
it("binds the current media to the intended asset without importing a new record", async () => {
  props.bindNodeId = "node-1";
  await render();
  await source("canvas:a");
  await choose();
  await submit("bindStudioConfirm");
  expect(h.bind).toHaveBeenCalledWith({
    nodeId: "node-1",
    mediaAssetId: "media-a",
    projectId: "a",
    storyProjectId: null,
  });
  expect(h.pull).not.toHaveBeenCalled();
});
