import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useUpdateIpCommerceIpAssets } from "./hooks";

const update = vi.hoisted(() => vi.fn());
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  updateIpCommerceIpAssets: update,
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "viewer" } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([true, false])(
  "refreshes viewing caches only after a successful asset save: %s",
  async (success) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const keys = [
      ["tv", "ips", "en-US", "", "viewer"],
      ["tv", "selected-ip", "target", "zh-CN", "guest"],
      ["ip-commerce", "discovery", "ip_plaza_for_you", "en-US"],
      ["tv", "selected-ip", "other", "en-US", "guest"],
    ];
    const reads = keys.map(() => vi.fn().mockResolvedValue({ cover: "old.jpg" }));
    let save!: ReturnType<typeof useUpdateIpCommerceIpAssets>["mutateAsync"];
    function Read({ index }: { index: number }) {
      useQuery({ queryKey: keys[index], queryFn: reads[index] });
      return null;
    }
    function View() {
      save = useUpdateIpCommerceIpAssets().mutateAsync;
      return (
        <>
          {keys.map((_, index) => (
            <Read key={index} index={index} />
          ))}
        </>
      );
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <View />
          </QueryClientProvider>
        )
      );
      await vi.waitFor(() =>
        expect(reads.every((read) => read.mock.calls.length === 1)).toBe(true)
      );
      reads.forEach((read) => read.mockResolvedValue({ cover: "new.jpg" }));
      update.mockReset();
      if (success) update.mockResolvedValue({});
      else update.mockRejectedValue(new Error("Save rejected"));
      await act(async () => {
        const request = save({ ipId: "target", coverAssetId: "new-cover" });
        if (success) await request;
        else await expect(request).rejects.toThrow("Save rejected");
      });
      for (let index = 0; index < 3; index++) {
        expect(reads[index]).toHaveBeenCalledTimes(success ? 2 : 1);
        expect(client.getQueryData(keys[index])).toEqual({
          cover: success ? "new.jpg" : "old.jpg",
        });
      }
      expect(reads[3]).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  }
);
