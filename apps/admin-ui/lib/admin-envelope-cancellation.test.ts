import { afterEach, expect, it, vi } from "vitest";
import { requestEnvelope as billingRead, mutateEnvelope } from "@/components/admin/billing/shared";
import { requestEnvelope as ipRead } from "@/components/admin/ip/shared";
import { requestEnvelope as certificateRead } from "@/components/admin/certificates/shared";
import { fetchIpRevenueConfig } from "./admin-ip-commerce-client";
afterEach(() => vi.unstubAllGlobals());
const readers = [
  (signal: AbortSignal) => billingRead("/api/admin/billing/orders", signal),
  (signal: AbortSignal) => ipRead("/api/admin/ip-commerce/ips", { signal }),
  (signal: AbortSignal) => certificateRead("/api/admin/certificates", { signal }),
  (signal: AbortSignal) => fetchIpRevenueConfig("ip", "en-US", signal),
  (signal: AbortSignal) =>
    mutateEnvelope("/api/admin/billing/prices", { name: "example" }, "POST", signal),
];
it.each(readers)("rejects a delayed successful body after cancellation", async (read) => {
  let finish!: (value: unknown) => void;
  const body = new Promise((resolve) => {
    finish = resolve;
  });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => body });
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const pending = read(controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  expect(fetcher.mock.calls[0]?.[1].signal).toBe(controller.signal);
  controller.abort();
  finish({ code: 200, data: { id: "old-response" } });
  await assertion;
});
it("preserves active successful responses and HTTP errors", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { id: "current" } })))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 403, msg: "denied" }), { status: 403 })
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(ipRead("/api/admin/ip-commerce/ips")).resolves.toEqual({ id: "current" });
  await expect(certificateRead("/api/admin/certificates")).rejects.toThrow("denied");
});
