import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { packagesSchema, parsePackageNumber, saveServicePackages } from "./service-packages-api";
vi.mock("@/lib/api-client", () => ({ api: { patch: vi.fn() } }));
const pkg = {
  tier: "basic" as const,
  title: "Cut",
  description: "Edit a scene",
  price: 12.5,
  currency: "USD" as const,
  deliveryDays: 3,
  revisions: -1,
  scope: ["One cut"],
};
it("sends display prices and only the versioned package replacement", async () => {
  await saveServicePackages("a/b", "listed", { expectedVersion: 2, packages: [pkg] });
  expect(api.patch).toHaveBeenCalledWith("/creator-services/a%2Fb", {
    service: "aurora",
    data: { expectedVersion: 2, packages: [pkg] },
  });
});
it.each([
  { price: NaN },
  { price: Infinity },
  { price: -1 },
  { currency: "XYZ" },
  { deliveryDays: 0 },
  { deliveryDays: 1.5 },
  { revisions: -2 },
  { scope: Array(13).fill("item") },
  { description: " " },
])("rejects invalid package fields", (invalid) => {
  expect(
    packagesSchema.safeParse({ expectedVersion: 1, packages: [{ ...pkg, ...invalid }] }).success
  ).toBe(false);
});
it("protects listed services, allows empty drafts and rejects duplicate tiers", async () => {
  vi.mocked(api.patch).mockClear();
  await expect(
    saveServicePackages("s", "listed", { expectedVersion: 1, packages: [] })
  ).rejects.toThrow("Pause");
  expect(api.patch).not.toHaveBeenCalled();
  await saveServicePackages("s", "draft", { expectedVersion: 1, packages: [] });
  expect(api.patch).toHaveBeenCalledOnce();
  expect(packagesSchema.safeParse({ expectedVersion: 1, packages: [pkg, pkg] }).success).toBe(
    false
  );
  expect(parsePackageNumber(" ")).toBeNaN();
  expect(parsePackageNumber("0")).toBe(0);
  expect(parsePackageNumber("12.50")).toBe(12.5);
});
