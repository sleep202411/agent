// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({ query: "", account: "a", reads: [] as string[][] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/api", () => ({ api: { get: async () => ({ projects: [] }) } }));
vi.mock("../_components/fizzstudio-shell", () => ({
  FizzStudioShell: ({ children }: { children: ReactNode }) => children,
  useFizzStudioWorkspace: (initial: string) => ({ workspaceId: initial || "personal" }),
}));
vi.mock("../../_hooks/use-billing", () => ({
  useProjectComputeLedger: (workspace: string, project: string) => {
    state.reads.push([state.account, workspace, project]);
    return { data: undefined, isLoading: true, isFetching: true };
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("opens the requested project wallet and discards stale selections on navigation/account changes", async () => {
  const root = createRoot(document.createElement("div"));
  const client = new QueryClient();
  const workspace = "00000000-0000-4000-8000-000000000001";
  const project = "00000000-0000-4000-8000-000000000002";
  const render = async () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      )
    );
  try {
    state.query = `workspaceId=${workspace}&projectId=${project}`;
    await render();
    expect(state.reads.at(-1)).toEqual(["a", workspace, project]);
    state.query = "workspaceId=invalid&projectId=invalid";
    state.account = "b";
    await render();
    expect(state.reads.at(-1)).toEqual(["b", "personal", undefined]);
  } finally {
    act(() => root.unmount());
    client.clear();
  }
});
