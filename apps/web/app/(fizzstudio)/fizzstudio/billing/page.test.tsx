// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import BillingPage from "./page";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "creator" } }) }));
vi.mock("@/src/lib/api", () => ({ api: { get: async () => ({ projects: [] }) } }));
const ledger = vi.hoisted(() => ({
  data: undefined as unknown,
  isError: true,
  error: new Error("Ledger access unavailable"),
  refetch: vi.fn(),
}));
vi.mock("../../_hooks/use-billing", () => ({ useProjectComputeLedger: () => ledger }));
vi.mock("../_components/fizzstudio-shell", () => ({
  useFizzStudioWorkspace: () => ({ workspaceId: "personal" }),
  FizzStudioShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  ledger.data = undefined;
  vi.clearAllMocks();
});
it.each([false, true])(
  "shows ledger errors and retains only confirmed summaries: cached=%s",
  async (cached) => {
    if (cached)
      ledger.data = {
        pages: [
          {
            accounts: [{ status: "active", availableBalance: "123", heldBalance: "4" }],
            entries: [],
          },
        ],
      };
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <BillingPage />
        </QueryClientProvider>
      )
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Ledger access unavailable"
    );
    if (cached) expect(container.textContent).toContain("123");
    else {
      expect(container.textContent).not.toContain("summary.available");
      expect(container.textContent).not.toContain("emptyTitle");
    }
    await act(async () => container.querySelector("button")!.click());
    expect(ledger.refetch).toHaveBeenCalledTimes(1);
  }
);
