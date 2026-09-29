import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCreatorServiceById } from "./creator-service-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/config", () => ({ appEnv: { assets: {} }, resolveAssetUrl: (s: string) => s }));
const pkg = { id: "package", title: "Film", tier: "basic", price: 12, currency: "USD" };
const detail = { id: "service", creatorId: "creator", title: "Film", version: 3, packages: [pkg] };
it("preserves the server revision and display-unit price for order requests", async () => {
  vi.mocked(api.get).mockResolvedValue(detail);
  const result = await fetchCreatorServiceById("service");
  expect(result?.version).toBe(3);
  expect(result?.packages[0]?.price).toBe(12);
});
it.each([undefined, -1, 1.5, "3"])("does not invent a valid revision from %s", async (version) => {
  vi.mocked(api.get).mockResolvedValue({ ...detail, version });
  expect((await fetchCreatorServiceById("service"))?.version).toBeUndefined();
});
it.each([
  { price: undefined },
  { price: -1 },
  { price: NaN },
  { tier: undefined },
  { currency: undefined },
])(
  "does not offer an incomplete package as free or with an invented tier/currency",
  async (invalid) => {
    vi.mocked(api.get).mockResolvedValue({ ...detail, packages: [{ ...pkg, ...invalid }] });
    expect((await fetchCreatorServiceById("service"))?.packages).toEqual([]);
  }
);
