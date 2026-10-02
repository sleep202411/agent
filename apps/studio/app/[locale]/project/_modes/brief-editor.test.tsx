import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BriefEditor } from "./brief-editor";
const state = vi.hoisted(() => ({ read: vi.fn(), canEdit: true }));
let doc: Y.Doc;
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "alice" }, loading: false }),
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectContext: () => ({ projectId: "project", canEdit: state.canEdit }),
}));
vi.mock("@/lib/collab/projects-api", () => ({
  ensureModeDocument: (...args: unknown[]) => state.read(...args),
}));
vi.mock("@/lib/collab/use-collab-doc", () => ({
  useCollabDoc: (id: string | null) => ({ doc: id ? doc : null, status: "synced" }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.canEdit = true;
  state.read.mockReset().mockResolvedValue({ id: "brief" });
  doc = new Y.Doc();
  doc.getText("content").insert(0, "Existing brief");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  doc.destroy();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <BriefEditor />
      </QueryClientProvider>
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 5)));
}
it("shows the upstream failure and retries into the existing brief", async () => {
  state.read.mockRejectedValueOnce(new Error("Document temporarily unavailable"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Document temporarily unavailable"
  );
  await act(async () => host.querySelector("button")!.click());
  await render();
  expect(host.querySelector("textarea")?.value).toBe("Existing brief");
  expect(state.read).toHaveBeenCalledTimes(2);
});
it("shows a loading state while resolving and keeps viewers read-only", async () => {
  let resolve!: (value: unknown) => void;
  state.read.mockReturnValue(new Promise((r) => (resolve = r)));
  state.canEdit = false;
  await render();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(host.querySelector("textarea")).toBeNull();
  await act(async () => resolve({ id: "brief" }));
  await render();
  expect(host.querySelector("textarea")?.readOnly).toBe(true);
});
