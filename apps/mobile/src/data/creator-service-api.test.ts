import { expect, it, vi } from "vitest";
import { api, ApiRequestError } from "@/lib/api-client";
import { fetchCreatorServiceById, fetchCreatorServicesPage } from "./creator-service-api";
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
  ApiRequestError: class extends Error {
    constructor(
      public code: number,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
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
    await expect(fetchCreatorServiceById("service")).rejects.toThrow("Invalid service packages");
  }
);

it("distinguishes a missing service from a failed load and forwards cancellation", async () => {
  const signal = new AbortController().signal;
  const failure = new ApiRequestError(503, "Temporarily unavailable", 503);
  vi.mocked(api.get).mockRejectedValue(failure);
  await expect(fetchCreatorServiceById("a/b", signal)).rejects.toBe(failure);
  expect(api.get).toHaveBeenLastCalledWith("/creator-services/a%2Fb", {
    service: "aurora",
    signal,
  });
  vi.mocked(api.get).mockRejectedValue(new ApiRequestError(404, "Not found", 404));
  expect(await fetchCreatorServiceById("missing")).toBeUndefined();
});

it("rejects malformed question identities rather than inventing or silently removing them", async () => {
  for (const requirementQuestions of [
    [{ prompt: "Brief?", required: true }],
    [
      { id: "same", prompt: "A", required: false },
      { id: "same", prompt: "B", required: true },
    ],
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...detail, requirementQuestions });
    await expect(fetchCreatorServiceById("service")).rejects.toThrow();
  }
});

it("uses the detail package list after all packages are removed, not stale card metadata", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...detail, packages: [], packageCount: 2 });
  const result = await fetchCreatorServiceById("service");
  expect(result?.packages).toEqual([]);
  expect(result?.packageCount).toBe(0);
});

it("loads public creator services with the official cursor and listed status", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue({
    items: [{ id: "one", creatorId: "creator", title: "Film" }],
    nextCursor: "next",
  });
  const page = await fetchCreatorServicesPage("creator", "previous", signal);
  expect(page.items[0]?.id).toBe("one");
  expect(page.nextCursor).toBe("next");
  expect(api.get).toHaveBeenLastCalledWith("/creator-services", {
    service: "aurora",
    params: { creatorId: "creator", status: "listed", limit: 12, cursor: "previous" },
    signal,
    retry: false,
  });
});
it.each([
  { items: [], nextCursor: "previous" },
  { items: [], nextCursor: 12 },
  { nextCursor: null },
  { items: [{ id: "one", creatorId: "other", title: "Wrong creator" }] },
  { items: [{ id: "one", creatorId: "creator" }] },
])("rejects malformed or unrelated service pages", async (value) => {
  vi.mocked(api.get).mockResolvedValue(value);
  await expect(fetchCreatorServicesPage("creator", "previous")).rejects.toThrow(
    "Invalid service page"
  );
});
