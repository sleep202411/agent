import { SERVICE_TIERS } from "@repo/shared/creator-service";
import { ALL_CURRENCIES } from "@repo/shared/crew";
import { z } from "zod";
import { api } from "@/lib/api-client";
export const packageSchema = z.object({
  tier: z.enum(SERVICE_TIERS),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2000),
  currency: z.enum(ALL_CURRENCIES),
  price: z.number().min(0).max(100_000_000),
  deliveryDays: z.number().int().min(1).max(365),
  revisions: z.number().int().min(-1).max(200),
  scope: z.array(z.string().trim().min(1).max(200)).max(12),
});
export const packagesSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  packages: z
    .array(packageSchema)
    .max(3)
    .refine((items) => new Set(items.map((p) => p.tier)).size === items.length, "Duplicate tiers"),
});
export function parsePackageNumber(value: string): number {
  return value.trim() === "" ? NaN : Number(value);
}
export async function saveServicePackages(
  id: string,
  status: string,
  input: z.input<typeof packagesSchema>
) {
  const data = packagesSchema.parse(input);
  if (status === "listed" && data.packages.length === 0)
    throw new Error("Pause the service before removing its last package");
  await api.patch(`/creator-services/${encodeURIComponent(id)}`, { service: "aurora", data });
}
