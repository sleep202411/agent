import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IpStudioRequest } from "@repo/shared/creator-location";
import { IpContributingStudios } from "./ip-contributing-studios";
import { api } from "@/src/lib/api";
const context = vi.hoisted(() => ({ locale: "en-US", login: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ api: { post: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => context.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: context.login }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
const ip = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
function response(input: IpStudioRequest, name = "Studio One") {
  return {
    requestId: input.requestId,
    ipId: input.ipId,
    locale: input.locale,
    queryId: "a".repeat(64),
    nextCursor: null,
    requiresLogin: false,
    items: [
      {
        roles: [
          { role: "director", customRole: null },
          { role: "writer", customRole: null },
        ],
        studio: {
          id: "123",
          name,
          avatarUrl: "",
          openToWork: true,
          matched: true,
          basedIn: null,
          serves: [],
          remote: true,
          showOnMap: false,
          point: null,
          serviceCount: 2,
          matchingServiceCount: 2,
        },
      },
    ],
  };
}
function render(ipId = ip, viewerId: string | null = "viewer") {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <IpContributingStudios
          key={`${ipId}:${viewerId}:${context.locale}`}
          ipId={ipId}
          viewerId={viewerId}
        />
      </QueryClientProvider>
    )
  );
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  context.locale = "en-US";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.post).mockImplementation(
    async (_path, config) => response(config!.data as IpStudioRequest) as never
  );
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
it("renders deduplicated roles, remote studios and localized service links without a fabricated pin", async () => {
  render();
  await flush();
  expect(host.textContent).toContain("Studio One");
  expect(host.textContent).toContain("contributorRoles.director · contributorRoles.writer");
  expect(host.textContent).toContain("studioRemote");
  expect(host.querySelector('a[href="/en-US/creators/123#services"]')).not.toBeNull();
  expect(host.querySelector('a[href="/en-US/creators/studios?selected=123"]')).not.toBeNull();
});
it("rejects an IP response mismatch", async () => {
  vi.mocked(api.post).mockImplementation(
    async (_path, config) =>
      ({ ...response(config!.data as IpStudioRequest), ipId: other }) as never
  );
  render();
  await flush();
  expect(host.textContent).toContain("responseMismatch");
  expect(host.textContent).not.toContain("Studio One");
});
it("cancels abandoned selection/account requests and ignores late replies", async () => {
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  let old!: IpStudioRequest;
  vi.mocked(api.post).mockImplementationOnce((_path, config) => {
    old = config!.data as IpStudioRequest;
    signal = config!.signal ?? undefined;
    return new Promise((resolve) => {
      finish = resolve;
    }) as never;
  });
  render();
  await flush();
  context.locale = "zh-CN";
  render(other, "another");
  await flush();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(response(old, "Old private context")));
  await flush();
  expect(host.textContent).not.toContain("Old private context");
  expect(host.querySelector('a[href="/zh-CN/creators/123#services"]')).not.toBeNull();
});
it("removes stale credits after a failed permission recheck", async () => {
  render();
  await flush();
  expect(host.textContent).toContain("Studio One");
  vi.mocked(api.post).mockRejectedValueOnce(new Error("IP no longer accessible"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["ip-contributing-studios"] });
  });
  await flush();
  expect(host.textContent).not.toContain("Studio One");
  expect(host.textContent).toContain("IP no longer accessible");
});
it("paginates the relationship query and keeps guest requests unauthenticated", async () => {
  vi.mocked(api.post).mockImplementation(async (_path, config) => {
    const input = config!.data as IpStudioRequest;
    const result = response(input, input.cursor ? "Studio Two" : "Studio One");
    result.items[0]!.studio.id = input.cursor ? "456" : "123";
    return {
      ...result,
      nextCursor: input.cursor ? null : { afterId: "123", queryId: "a".repeat(64) },
    } as never;
  });
  render();
  await flush();
  const more = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "studiosMore"
  )!;
  act(() => more.click());
  await flush();
  expect(host.textContent).toContain("Studio Two");
  render(ip, null);
  await flush();
  expect(vi.mocked(api.post).mock.calls.at(-1)?.[1]?.credentials).toBe("omit");
});
