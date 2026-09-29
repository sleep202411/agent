import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskDeliveryTemplate, deliveryPrice, taskSubmission } from "./task-delivery-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
it("uses the authorized template endpoint and distinguishes absence from failure", async () => {
  const signal = new AbortController().signal,
    id = "11111111-1111-4111-8111-111111111111";
  vi.mocked(api.get).mockResolvedValue(null);
  expect(await fetchTaskDeliveryTemplate(id, signal)).toBeNull();
  expect(api.get).toHaveBeenCalledWith(`/crew-tasks/${id}/delivery-template`, {
    service: "aurora",
    signal,
  });
  vi.mocked(api.get).mockResolvedValue({});
  await expect(fetchTaskDeliveryTemplate(id, signal)).rejects.toThrow();
  vi.mocked(api.get).mockRejectedValue(new Error("Forbidden"));
  await expect(fetchTaskDeliveryTemplate(id, signal)).rejects.toThrow("Forbidden");
});
it("preserves minor-unit precision and rejects malformed submission identity", () => {
  expect(deliveryPrice("1")).toBe("0.01");
  expect(deliveryPrice("999999999999999")).toBe("9999999999999.99");
  expect(() => taskSubmission.parse({ id: "bad" })).toThrow();
});
