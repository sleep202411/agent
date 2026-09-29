import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCrewSpend } from "./crew-spend-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const summary = {
  taskRewardsByCurrency: { USD: "9007199254740993", CNY: "100" },
  reimbursementsByCurrency: { USD: "7", CNY: "200" },
  totalByCurrency: { USD: "9007199254741000", CNY: "300" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue(summary);
});
it("reads server summary and keeps large minor units exact", async () => {
  expect(await fetchCrewSpend("crew", new AbortController().signal)).toEqual(summary);
  expect(api.get).toHaveBeenCalledWith(
    "/crews/crew/expense-drafts/summary",
    expect.objectContaining({ service: "aurora" })
  );
});
it.each([
  { totalByCurrency: { USD: "9007199254740999", CNY: "300" } },
  { reimbursementsByCurrency: { USD: "7.1", CNY: "200" } },
  { taskRewardsByCurrency: { USD: 12, CNY: "100" } },
  { totalByCurrency: { USD: "9007199254741000" } },
])("rejects malformed or inconsistent totals %j", async (change) => {
  vi.mocked(api.get).mockResolvedValue({ ...summary, ...change });
  await expect(fetchCrewSpend("crew", new AbortController().signal)).rejects.toThrow();
});
it("preserves permission rejection", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Crew ledger permission required"));
  await expect(fetchCrewSpend("crew", new AbortController().signal)).rejects.toThrow("permission");
});
