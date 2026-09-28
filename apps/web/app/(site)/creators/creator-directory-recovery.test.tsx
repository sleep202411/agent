import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import CreatorsPage from "./page";
import { listCreators, searchCreators } from "@/src/services/creator";
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/layout/plaza-hero", () => ({ PlazaHero: () => null }));
vi.mock("./_components/creators-talent-grid", () => ({
  CreatorsTalentGrid: ({
    creators,
    isLoading,
  }: {
    creators: { name: string }[];
    isLoading: boolean;
  }) => (
    <div>
      {isLoading ? "loading" : creators.length ? creators.map((c) => c.name).join(",") : "empty"}
    </div>
  ),
}));
afterEach(() => vi.unstubAllGlobals());
const page = (count: number, total = count) => ({
  code: 200,
  data: Array.from({ length: count }, (_, i) => ({
    info: { id: i + 1, nickName: `Creator ${i + 1}` },
    level: [],
  })),
  sum: total,
});
for (const [name, load] of [
  ["list", () => listCreators({ page: 1 })],
  ["search", () => searchCreators({ key: "test" })],
] as const) {
  it.each([503, 200])(`${name} rejects HTTP/business failure (%i)`, async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 500, message: "Unavailable" }), { status })
        )
    );
    await expect(load()).rejects.toBeInstanceOf(Error);
  });
  it(`${name} preserves successful empty results`, async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(page(0))));
    await expect(load()).resolves.toEqual({ list: [], total: 0 });
  });
}
it.each([false, true])(
  "page exposes retry and preserves loaded rows (next page: %s)",
  async (nextPage) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let intersect: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          intersect = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
    const fetcher = vi.fn();
    if (nextPage) fetcher.mockResolvedValueOnce(Response.json(page(60, 120)));
    fetcher
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json(page(1)));
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    const root = createRoot(container);
    const settle = async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    };
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <CreatorsPage />
          </QueryClientProvider>
        )
      );
      await settle();
      if (nextPage) {
        await act(async () =>
          intersect(
            [{ isIntersecting: true }] as IntersectionObserverEntry[],
            {} as IntersectionObserver
          )
        );
        await settle();
      }
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "directoryLoadFailed"
      );
      if (nextPage) expect(container.textContent).toContain("Creator 60");
      else expect(container.textContent).not.toContain("empty");
      const calls = fetcher.mock.calls.length;
      await act(async () =>
        intersect(
          [{ isIntersecting: true }] as IntersectionObserverEntry[],
          {} as IntersectionObserver
        )
      );
      expect(fetcher).toHaveBeenCalledTimes(calls);
      await act(async () =>
        (container.querySelector('[role="alert"] button') as HTMLButtonElement).click()
      );
      await settle();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain("Creator 1");
      if (nextPage) expect(String(fetcher.mock.calls.at(-1)?.[1]?.body)).toContain("page=2");
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  }
);
it("retains list form encoding, locale and total", async () => {
  document.documentElement.lang = "zh-CN";
  const fetcher = vi.fn().mockResolvedValue(Response.json(page(1, 120)));
  vi.stubGlobal("fetch", fetcher);
  try {
    expect((await listCreators({ page: 2, pageSize: 60 })).total).toBe(120);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("/user/list/user/info");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      body: "page=2&pageSize=60",
    });
    expect(new Headers(init.headers).get("accept-language")).toBe("zh-CN");
  } finally {
    document.documentElement.lang = "";
  }
});
it("keeps search query parameters and total fallback", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ code: 200, data: page(1).data, total: 81 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await searchCreators({ key: "A & B", page: 2, pageSize: 60 })).total).toBe(81);
  const [url, init] = fetcher.mock.calls[0]!;
  const query = new URL(String(url), "https://example.test").searchParams;
  expect(query.get("key")).toBe("A & B");
  expect(query.get("page")).toBe("2");
  expect(init.body).toBeUndefined();
});
