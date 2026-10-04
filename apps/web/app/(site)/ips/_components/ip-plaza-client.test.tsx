// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { IpPlazaClient } from "./ip-plaza-client";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./community-video-dialog", () => ({ CommunityVideoDialog: () => null }));
const state = vi.hoisted(() => ({
  failed: false,
  nextFailed: false,
  fetching: false,
  refetch: vi.fn(),
  next: vi.fn(),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useInfiniteIpCommerceIps: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: "one",
              title: "Existing channel",
              roomNumber: "100001",
              genres: [],
              tags: [],
              episodes: [],
            },
          ],
        },
      ],
    },
    isLoading: false,
    isError: state.failed,
    isFetchNextPageError: state.nextFailed,
    isFetching: state.fetching,
    isFetchingNextPage: false,
    error: state.failed ? new Error("Catalog temporarily unavailable") : null,
    hasNextPage: true,
    refetch: state.refetch,
    fetchNextPage: state.next,
  }),
  useIpCommerceDiscovery: () => ({ data: { items: [] } }),
  useIpCommerceTaxonomyTerms: () => ({ data: { items: [] } }),
}));
vi.mock("./ip-plaza-card", () => ({
  IPPlazaCard: ({ project }: { project: { name: string } }) => <article>{project.name}</article>,
}));
vi.mock("./ip-cinematic-hero", () => ({ IPCinematicHero: () => null }));
vi.mock("@/app/(site)/ip-studio/_components/new-ip-create-form", () => ({
  NewIpCreateDialog: () => null,
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
let observe = vi.fn();
async function render() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = observe;
      disconnect() {}
    }
  );
  await act(async () => root.render(<IpPlazaClient />));
}
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  state.failed = false;
  state.nextFailed = false;
  state.fetching = false;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  observe = vi.fn();
});
it("retains loaded channels after pagination fails and offers a controlled retry", async () => {
  state.failed = true;
  state.nextFailed = true;
  await render();
  expect(host.querySelector("article")?.textContent).toBe("Existing channel");
  expect(host.textContent).toContain("Catalog temporarily unavailable");
  expect(observe).not.toHaveBeenCalled();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
  );
  expect(state.refetch).toHaveBeenCalledTimes(1);
  state.fetching = true;
  await render();
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!.disabled
  ).toBe(true);
  state.fetching = false;
  state.nextFailed = false;
  await render();
  expect(host.querySelector("article")).not.toBeNull();
  expect(host.textContent).toContain("Catalog temporarily unavailable");
  state.failed = false;
  await render();
  expect(host.textContent).not.toContain("Catalog temporarily unavailable");
  expect(host.querySelector("article")).not.toBeNull();
  expect(observe).toHaveBeenCalled();
});
