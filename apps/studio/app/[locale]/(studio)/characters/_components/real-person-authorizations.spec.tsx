// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { RealPersonAuthorizations } from "./real-person-authorizations";
const s = vi.hoisted(() => ({
  user: "a",
  grants: vi.fn(),
  outputs: vi.fn(),
  revoke: vi.fn(),
  takedown: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({ useAuth: () => ({ user: { id: s.user } }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error } }));
vi.mock("./authorize-project-dialog", () => ({ AuthorizeProjectDialog: () => null }));
vi.mock("@/lib/characters-api", () => ({
  listProjectGrants: s.grants,
  listLikenessOutputs: s.outputs,
  revokeProjectGrant: s.revoke,
  takedownLikenessOutputs: s.takedown,
}));
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  s.user = "a";
  vi.clearAllMocks();
  s.grants.mockReset().mockResolvedValue([
    { projectId: "p", projectName: "Private Film", status: "active" },
    { projectId: "q", projectName: "Other Film", status: "active" },
  ]);
  s.outputs.mockReset().mockResolvedValue([]);
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
async function render(id = "c") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <RealPersonAuthorizations characterId={id} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}
it("guards withdrawals across different projects and suppresses abandoned completion", async () => {
  let resolve!: () => void;
  s.revoke.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    const buttons = Array.from(host.querySelectorAll("button")).filter(
      (b) => b.textContent === "grantWithdraw"
    );
    buttons[0].click();
    buttons[1].click();
  });
  expect(s.revoke).toHaveBeenCalledTimes(1);
  const signal = s.revoke.mock.calls[0][2] as AbortSignal;
  s.user = "b";
  s.grants.mockResolvedValue([]);
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Private Film");
  await act(async () => resolve());
  expect(s.success).not.toHaveBeenCalled();
});
it("cancels both private feeds on character change", async () => {
  let grant!: AbortSignal, output!: AbortSignal;
  s.grants.mockImplementation((_id, signal) => {
    grant = signal;
    return new Promise(() => {});
  });
  s.outputs.mockImplementation((_id, _p, signal) => {
    output = signal;
    return new Promise(() => {});
  });
  await render();
  const g = grant,
    o = output;
  await render("new");
  expect(g.aborted).toBe(true);
  expect(o.aborted).toBe(true);
});
it("releases a failed withdrawal for retry", async () => {
  s.revoke.mockRejectedValueOnce(new Error("failed")).mockResolvedValue(undefined);
  await render();
  const click = () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "grantWithdraw")!
      .click();
  await act(async () => click());
  expect(s.error).toHaveBeenCalledWith("failed");
  await act(async () => click());
  expect(s.revoke).toHaveBeenCalledTimes(2);
  expect(s.success).toHaveBeenCalled();
});
