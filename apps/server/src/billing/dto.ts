import { z } from 'zod';

export const BillingSiteRegionSchema = z.enum(['global', 'cn']);
export const BillingProductTypeSchema = z.enum([
  'bubble_pack',
  'community_point_pack',
  'membership_plan',
  'team_membership_plan',
  'custom',
]);

export const ListBillingPricesQuerySchema = z.object({
  siteRegion: BillingSiteRegionSchema.optional(),
  productType: BillingProductTypeSchema.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type ListBillingPricesQuery = z.infer<
  typeof ListBillingPricesQuerySchema
>;

export const CreateBillingCheckoutSchema = z.object({
  priceId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  workspaceId: z.string().uuid().optional(),
  successUrl: z.string().trim().url().max(2048),
  backUrl: z.string().trim().url().max(2048),
});
export type CreateBillingCheckoutInput = z.infer<
  typeof CreateBillingCheckoutSchema
>;

export const BillingOrderParamsSchema = z.object({
  orderId: z.string().uuid(),
});
export type BillingOrderParams = z.infer<typeof BillingOrderParamsSchema>;
