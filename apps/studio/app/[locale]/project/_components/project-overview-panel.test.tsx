import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { ProjectOverviewPanel } from "./project-overview-panel";
const state = vi.hoisted(() => ({
  account: "alice",
  canEdit: true,
  read: vi.fn(),
  update: vi.fn(),
  committed: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.account } }),
}));
vi.mock("./project-context", () => ({
  useProjectContext: () => ({ projectId: "one", canEdit: state.canEdit }),
}));
vi.mock("../_stores/project-ui-store", () => ({
  useProjectUIStore: (select: (value: { closeOverview: () => void }) => unknown) =>
    select({ closeOverview: state.close }),
}));
vi.mock("@/lib/collab/projects-api", () => ({
  getProject: (...args: unknown[]) => state.read(...args),
  updateProject: (...args: unknown[]) => state.update(...args),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let root: Root, host: HTMLDivElement, client: QueryClient;
const original = {
  id: "one",
  workspaceId: "workspace",
  name: "Pilot",
  description: "Saved description",
  coverAssetId: "cover",
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.account = "alice";
  state.canEdit = true;
  state.read.mockReset().mockResolvedValue(original);
  state.update.mockReset().mockImplementation(async (_id, input) => ({ ...original, ...input }));
  state.committed.mockReset();
  state.close.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectOverviewPanel onNameCommitted={state.committed} />
      </QueryClientProvider>
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 5)));
}
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("offers retry instead of empty disabled fields on read failure", async () => {
  state.read.mockRejectedValueOnce(new Error("Metadata unavailable"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Metadata unavailable");
  expect(host.querySelector("textarea")).toBeNull();
  await act(async () => button("retry").click());
  await render();
  expect(host.querySelector("textarea")?.value).toBe("Saved description");
});
it("preserves the description draft when saving the name and removing the cover", async () => {
  await render();
  await type(host.querySelector("textarea")!, "Unsaved description");
  await type(host.querySelector<HTMLInputElement>('input[aria-label="detailsName"]')!, "New name");
  await act(async () => button("save").click());
  expect(state.update).toHaveBeenCalledWith("one", { name: "New name" });
  expect(state.committed).toHaveBeenCalledWith("New name");
  expect(host.querySelector("textarea")?.value).toBe("Unsaved description");
  await act(async () => button("removeCover").click());
  expect(host.querySelector("textarea")?.value).toBe("Unsaved description");
});
it("preserves the description while a background refresh fails", async () => {
  await render();
  await type(host.querySelector("textarea")!, "Unsaved description");
  state.read.mockRejectedValue(new Error("Refresh unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["platform-project-overview"] });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(host.querySelector("textarea")?.value).toBe("Unsaved description");
  expect(button("retry")).toBeDefined();
});
it("removes cached fields when access is revoked", async () => {
  await render();
  state.read.mockRejectedValue(new ApiRequestError(403, "No access", 403));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["platform-project-overview"] });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("Saved description");
});
it("resets drafts when the account changes", async () => {
  await render();
  await type(host.querySelector("textarea")!, "Alice draft");
  state.account = "bob";
  await render();
  expect(host.querySelector("textarea")?.value).toBe("Saved description");
});
it("renders viewer metadata without edit actions", async () => {
  state.canEdit = false;
  await render();
  expect(host.textContent).toContain("Saved description");
  expect(host.querySelector("textarea")).toBeNull();
  expect(button("changeCover")).toBeUndefined();
});
