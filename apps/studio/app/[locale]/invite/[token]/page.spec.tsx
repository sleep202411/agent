// @vitest-environment jsdom
import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcceptedInvite, InvitePreview } from "@/lib/collab/sharing-api";
import InviteAcceptPage from "./page";
import { ApiRequestError } from "@/lib/api";

const state = vi.hoisted(() => ({
  user: { id: "member" } as { id: string } | null,
  preview: vi.fn(),
  accept: vi.fn(),
  replace: vi.fn(),
  selectWorkspace: vi.fn(),
  signIn: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { name?: string }) =>
    values?.name ? `${key}: ${values.name}` : key,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.user, loading: false, signIn: state.signIn }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  WORKSPACES_QUERY_KEY: ["workspaces"],
  useWorkspace: () => ({ setActiveWorkspaceId: state.selectWorkspace }),
}));
vi.mock("@/lib/collab/sharing-api", () => ({
  previewInvite: state.preview,
  acceptInvite: state.accept,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));

const target: AcceptedInvite = {
  scope: "project",
  projectId: "project",
  workspaceId: "project-workspace",
  targetName: "Rolv & Harald 2.0 v2",
};
function preview(
  existingAccess: AcceptedInvite | null,
  status: InvitePreview["status"] = "pending"
): InvitePreview {
  return {
    scope: "project",
    targetName: target.targetName,
    role: "editor",
    status,
    expiresAt: "2099-01-01",
    existingAccess,
  };
}
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let params: Promise<{ token: string }>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.user = { id: "member" };
  state.accept.mockResolvedValue(target);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  params = Promise.resolve({ token: "invite-token" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Suspense fallback="loading">
          <InviteAcceptPage params={params} />
        </Suspense>
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((el) => el.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("invite entry for existing members", () => {
  it.each(["pending", "accepted", "expired", "revoked"] as const)(
    "opens an accessible project from a %s invitation without accepting again",
    async (status) => {
      state.preview.mockResolvedValue(preview(target, status));
      await render();
      expect(container.textContent).toContain("alreadyJoinedTitle");
      expect(container.textContent).toContain(target.targetName);
      expect(container.textContent).not.toContain("acceptInvitation");
      await click("enterProject");
      expect(state.accept).not.toHaveBeenCalled();
      expect(state.selectWorkspace).toHaveBeenCalledWith("project-workspace");
      expect(state.replace).toHaveBeenCalledWith("/project/project?ws=project-workspace");
    }
  );
  it("still accepts a live invitation for a new member", async () => {
    state.preview.mockResolvedValue(preview(null));
    await render();
    await click("acceptInvitation");
    expect(state.accept).toHaveBeenCalledWith("invite-token", expect.any(AbortSignal));
    expect(state.replace).toHaveBeenCalledWith("/project/project?ws=project-workspace");
  });
  it("does not offer entry for expired invitations without current access", async () => {
    state.preview.mockResolvedValue(preview(null, "expired"));
    await render();
    expect(container.textContent).toContain("expiredBody");
    expect(container.textContent).not.toContain("enterProject");
  });
  it("requires sign-in and never reuses the previous user's member preview", async () => {
    state.preview.mockResolvedValue(preview(target));
    await render();
    state.user = null;
    await render();
    expect(container.textContent).toContain("signInTitle");
    expect(container.textContent).not.toContain("alreadyJoinedTitle");
    state.user = { id: "another-member" };
    state.preview.mockResolvedValue(preview(null));
    await render();
    expect(container.textContent).toContain("acceptInvitation");
    expect(container.textContent).not.toContain("alreadyJoinedTitle");
  });
  it("admits acceptance once and suppresses navigation after account change", async () => {
    state.preview.mockResolvedValue(preview(null));
    let resolve!: (value: AcceptedInvite) => void;
    state.accept.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await render();
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "acceptInvitation"
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(state.accept).toHaveBeenCalledTimes(1);
    const signal = state.accept.mock.calls[0][1] as AbortSignal;
    state.user = { id: "replacement" };
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(target));
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.selectWorkspace).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });
  it("cancels old previews when the invitation changes", async () => {
    state.preview.mockImplementation(() => new Promise(() => {}));
    await render();
    const signal = state.preview.mock.calls[0][1] as AbortSignal;
    state.preview.mockResolvedValue(preview(null));
    params = Promise.resolve({ token: "replacement-token" });
    await render();
    expect(signal.aborted).toBe(true);
    expect(state.preview).toHaveBeenLastCalledWith("replacement-token", expect.any(AbortSignal));
  });
  it("prevents duplicate navigation for existing access", async () => {
    state.preview.mockResolvedValue(preview(target));
    await render();
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "enterProject"
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(state.replace).toHaveBeenCalledTimes(1);
  });
});

it("shows current workspace membership instead of accepting an admin invitation", async () => {
  const existing: AcceptedInvite = {
    scope: "workspace",
    workspaceId: "workspace",
    targetName: "Team",
  };
  state.preview.mockResolvedValue({
    ...preview(existing),
    scope: "workspace",
    role: "admin",
    currentRole: "editor",
  });
  await render();
  expect(container.textContent).toContain("alreadyWorkspaceMember: Team");
  expect(container.textContent).not.toContain("acceptInvitation");
  await click("enterWorkspace");
  expect(state.accept).not.toHaveBeenCalled();
});

describe("invitation preview recovery", () => {
  it("preserves service errors and retries the same invitation before accepting", async () => {
    state.preview
      .mockRejectedValueOnce(new ApiRequestError(503, "Invitation service unavailable", 503))
      .mockResolvedValue(preview(null));
    await render();
    expect(container.textContent).toContain("Invitation service unavailable");
    expect(container.textContent).not.toContain("invalidBody");
    expect(container.textContent).not.toContain("acceptInvitation");
    await click("retry");
    expect(state.preview).toHaveBeenCalledTimes(2);
    expect(state.preview).toHaveBeenLastCalledWith("invite-token", expect.any(AbortSignal));
    expect(container.textContent).toContain("acceptInvitation");
    await click("acceptInvitation");
    expect(state.replace).toHaveBeenCalledWith("/project/project?ws=project-workspace");
  });
  it("does not offer retry for a confirmed missing invitation", async () => {
    state.preview.mockRejectedValue(new ApiRequestError(404, "Invite not found", 404));
    await render();
    expect(container.textContent).toContain("Invite not found");
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "retry")
    ).toBe(false);
  });
});
