// @vitest-environment jsdom
import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcceptedInvite, InvitePreview } from "@/lib/collab/sharing-api";
import InviteAcceptPage from "./page";

const state = vi.hoisted(() => ({
  user: { id: "member" } as { id: string } | null,
  preview: vi.fn(),
  accept: vi.fn(),
  replace: vi.fn(),
  selectWorkspace: vi.fn(),
  signIn: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
    expect(state.accept).toHaveBeenCalledWith("invite-token");
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
});
