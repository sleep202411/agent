// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PublicStudioServices } from "./public-studio-services";
import { api, ApiRequestError } from "@/src/lib/api";
const account = vi.hoisted(() => ({ id: "viewer" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: account.id } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("./tabs/services-tab", () => ({
  ServicesTab: ({ isOwner }: { isOwner: boolean }) => (
    <div data-services>{isOwner ? "Owner controls" : "Published service offerings"}</div>
  ),
}));
vi.mock("@/src/lib/api", () => ({
  api: { get: vi.fn() },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
const creator = {
  id: "creator",
  name: "Creator",
  avatar: "",
  banner: "",
  bio: "",
  joinedAt: "",
  levels: [],
  contact: "",
  study: "",
};
const profile = {
  id: "creator",
  name: "Creator",
  avatarUrl: "https://example.test/a.png",
  openToWork: true,
  matched: true,
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: [{ countryCode: "MY", city: "Johor Bahru" }],
  remote: true,
  showOnMap: true,
  point: null,
  serviceCount: 1,
  matchingServiceCount: 1,
};
let root: Root, host: HTMLDivElement, client: QueryClient;
const wait = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PublicStudioServices creator={creator} />
      </QueryClientProvider>
    )
  );
  await wait();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  account.id = "viewer";
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.get).mockResolvedValue(profile);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
it("shows opted-in city, public service areas and remote availability with visitor-only offerings", async () => {
  await render();
  expect(host.textContent).toContain("Singapore");
  expect(host.textContent).toContain("Johor Bahru");
  expect(host.textContent).toContain("remote");
  expect(host.textContent).toContain("Published service offerings");
  expect(host.textContent).not.toContain("Owner controls");
});
it("does not display a base without map consent", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...profile, showOnMap: false });
  await render();
  expect(host.textContent).not.toContain("Singapore");
  expect(host.textContent).toContain("Johor Bahru");
});
it("removes unavailable location details without hiding independently authorized services", async () => {
  await render();
  vi.mocked(api.get).mockRejectedValueOnce(new ApiRequestError("NOT_FOUND", "Not found", 404));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["public-studio-profile"] });
  });
  await wait();
  expect(host.textContent).not.toContain("Singapore");
  expect(host.querySelector("[data-services]")).not.toBeNull();
});
it("allows location retry while keeping the independent service listing available", async () => {
  await render();
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Directory unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["public-studio-profile"] });
  });
  await wait();
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Directory unavailable");
  expect(host.querySelector("[data-services]")).not.toBeNull();
  await act(async () => host.querySelector("button")!.click());
  await wait();
  expect(host.querySelector("[data-services]")).not.toBeNull();
});
it("aborts abandoned account requests and ignores their late responses", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = vi.mocked(api.get).mock.calls[0]![1]!.signal!;
  account.id = "other";
  vi.mocked(api.get).mockResolvedValueOnce({
    ...profile,
    basedIn: null,
    serves: [],
    remote: false,
    showOnMap: false,
  });
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(profile));
  await wait();
  expect(host.textContent).not.toContain("Singapore");
  expect(host.textContent).not.toContain("Johor Bahru");
});
