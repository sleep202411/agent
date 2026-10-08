import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { SavedJobsMenu } from "./saved-jobs-menu";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "u" } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-HK",
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { get: h.get } }));
vi.mock("next/link", () => ({ default: (p: React.ComponentProps<"a">) => <a {...p} /> }));
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.get.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});
async function open() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <SavedJobsMenu />
      </QueryClientProvider>
    )
  );
  expect(h.get).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
it("opens saved jobs in a popover and links directly to the localized opening", async () => {
  h.get.mockResolvedValue({
    items: [
      { position: { id: "job", positionType: "Editor" }, crew: { id: "crew", name: "Film Crew" } },
    ],
    nextCursor: null,
  });
  await open();
  expect(h.get).toHaveBeenCalledWith(
    "/positions",
    expect.objectContaining({ query: expect.objectContaining({ saved: "true" }) })
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Editor");
  expect(document.querySelector('a[href="/zh-HK/crews/crew/positions/job"]')).not.toBeNull();
  expect(host.querySelector("a")).toBeNull();
});
it("displays request failures instead of an empty saved list", async () => {
  h.get.mockRejectedValue(Error("Access expired"));
  await open();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Access expired");
});
