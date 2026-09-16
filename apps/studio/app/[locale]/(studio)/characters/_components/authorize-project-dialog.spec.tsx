// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AuthorizeProjectDialog } from "./authorize-project-dialog";
const s = vi.hoisted(() => ({
  user: "a",
  workspaces: [{ id: "w", name: "Workspace" }],
  list: vi.fn(),
  grant: vi.fn(),
  granted: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({ useAuth: () => ({ user: { id: s.user } }) }));
vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ workspaces: s.workspaces }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: s.success, error: vi.fn() } }));
vi.mock("@/lib/collab/projects-api", () => ({ listProjects: s.list }));
vi.mock("@/lib/characters-api", () => ({
  createProjectGrant: s.grant,
  characterApiErrorCode: () => null,
  REAL_PERSON_GRANT_CONSENT_VERSION: "v1",
}));
vi.mock("./project-grant-consent", () => ({
  ProjectGrantConsent: ({
    onRead,
    onAttestedChange,
  }: {
    onRead: () => void;
    onAttestedChange: (v: boolean) => void;
  }) => (
    <button
      onClick={() => {
        onRead();
        onAttestedChange(true);
      }}
    >
      consent
    </button>
  ),
}));
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  s.user = "a";
  s.workspaces = [{ id: "w", name: "Workspace" }];
  vi.clearAllMocks();
  s.list.mockReset().mockResolvedValue([{ id: "p", name: "Film", status: "active" }]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(open = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AuthorizeProjectDialog
          open={open}
          onOpenChange={s.close}
          characterId="c"
          grantedProjectIds={new Set()}
          onGranted={s.granted}
        />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}
async function click(text: string) {
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent?.includes(text))!
      .click();
  });
}
it("guards duplicate grants and discards results after close", async () => {
  let resolve!: (v: unknown) => void;
  s.grant.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await click("Film");
  await click("next");
  await click("consent");
  await act(async () => {
    const b = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "grantConfirm"
    )!;
    b.click();
    b.click();
  });
  expect(s.grant).toHaveBeenCalledTimes(1);
  const signal = s.grant.mock.calls[0][3] as AbortSignal;
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ projectId: "p" }));
  expect(s.granted).not.toHaveBeenCalled();
  expect(s.success).not.toHaveBeenCalled();
  await render(true);
  expect(document.body.textContent).toContain("Film");
  expect(document.body.textContent).not.toContain("grantConfirm");
});
it("reports failed lookup through the official error panel", async () => {
  s.list.mockRejectedValueOnce(new Error("lookup failed"));
  await render();
  expect(document.body.textContent).toContain("authorizeLoadFailed");
  expect(document.body.textContent).not.toContain("authorizeNoProjects");
});
it("abandons private project reads on account change", async () => {
  const signals: AbortSignal[] = [];
  s.list.mockImplementation((_id, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  });
  await render();
  s.user = "b";
  await render();
  expect(signals[0].aborted).toBe(true);
});

it("shows the existing empty state when no workspace can be queried", async () => {
  s.workspaces = [];
  await render();
  expect(document.body.textContent).toContain("authorizeNoProjects");
  expect(s.list).not.toHaveBeenCalled();
});
