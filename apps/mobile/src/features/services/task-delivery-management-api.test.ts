import { beforeEach, expect, it, vi } from "vitest";
import { fetchDeliveryCatalog, setDeliveryTemplate } from "./task-delivery-management-api";
import { api } from "@/lib/api-client";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "00000000-0000-4000-8000-000000000001";
const signal = new AbortController().signal;
const result = {
  categoryId: id,
  version: 2,
  definition: { name: "Film", description: "Master", prices: [], fields: [] },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("requests scoped catalog pages and validates the response", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: [{ id, version: 2, definition: result.definition }],
    nextCursor: id,
  });
  expect((await fetchDeliveryCatalog("crew", signal, id)).nextCursor).toBe(id);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/delivery-catalog", {
    service: "aurora",
    signal,
    params: { limit: 50, cursor: id },
  });
});
it("sends the captured task version and exact category without automatic retry", async () => {
  vi.mocked(api.post).mockResolvedValue(result);
  await expect(setDeliveryTemplate(id, 3, { id, version: 2 }, 1, signal)).resolves.toEqual(result);
  expect(api.post).toHaveBeenCalledWith(`/crew-tasks/${id}/delivery-template`, {
    service: "aurora",
    signal,
    data: { expectedVersion: 3, category: { id, version: 2 } },
    retry: false,
  });
});
it("supports removal and rejects mismatched receipts", async () => {
  vi.mocked(api.post).mockResolvedValue(null);
  await expect(setDeliveryTemplate(id, 3, null, 1, signal)).resolves.toBeNull();
  await expect(setDeliveryTemplate(id, 3, { id, version: 2 }, 1, signal)).rejects.toThrow(
    "receipt mismatch"
  );
});
it("blocks stale account writes and ignores a response after an account change", async () => {
  h.generation = 2;
  await expect(setDeliveryTemplate(id, 3, null, 1, signal)).rejects.toThrow("Session changed");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return null;
  });
  await expect(setDeliveryTemplate(id, 3, null, 1, signal)).rejects.toThrow("Session changed");
});
