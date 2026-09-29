import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { creatorKeys, useCreatorDetail } from "./use-creator";

vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => "zh-CN" }));
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])(
  "refreshes a cached profile from the detail endpoint (stale: %s)",
  async (stale) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        code: 200,
        info: { id: 42, nickName: "Updated Artist", description: "Updated biography" },
        level: [],
      })
    );
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(
      creatorKeys.list("zh-CN"),
      {
        pages: [
          {
            list: [
              {
                info: { id: 42, nickName: "Old Artist" },
                level: [{ id: 13, name: "AI Producer" }],
              },
            ],
            total: 1,
          },
        ],
        pageParams: [1],
      },
      { updatedAt: Date.now() - (stale ? 60_000 : 0) }
    );
    function Probe() {
      const query = useCreatorDetail("42");
      return (
        <div>
          <span>{query.data?.name}</span>
          <span>{query.data?.bio}</span>
          <span>{query.data?.levels.map((l) => l.name).join(",")}</span>
          <button onClick={() => void query.refetch()}>Refresh</button>
        </div>
      );
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      );
      await settle();
      if (!stale) {
        expect(fetcher).not.toHaveBeenCalled();
        expect(container.textContent).toContain("Old Artist");
        expect(container.textContent).toContain("AI Producer");
        await act(async () => container.querySelector("button")!.click());
        await settle();
      }
      expect(fetcher).toHaveBeenCalledOnce();
      expect(String(fetcher.mock.calls[0]?.[0])).toContain("/user/other/user/info?UserId=42");
      expect(container.textContent).toContain("Updated Artist");
      expect(container.textContent).toContain("Updated biography");
      expect(container.textContent).not.toContain("AI Producer");
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  }
);
