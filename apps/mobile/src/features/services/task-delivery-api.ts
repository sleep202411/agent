import { z } from "zod";
import { api } from "@/lib/api-client";
const date = z.string().datetime({ offset: true });
export const deliveryTemplate = z.object({
  categoryId: z.string().uuid(),
  version: z.number().int().positive(),
  definition: z.object({
    approvalPolicy: z.enum(["standard", "fd3_or_production_lead"]).optional(),
    name: z.string(),
    description: z.string(),
    prices: z.array(
      z.object({
        currency: z.enum(["USD", "CNY"]),
        amountMinor: z.string().regex(/^(0|[1-9][0-9]{0,14})$/),
        unit: z.string(),
      })
    ),
    fields: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        instructions: z.string(),
        type: z.enum(["text", "attachment"]),
        required: z.boolean(),
      })
    ),
  }),
});
export type DeliveryTemplate = z.infer<typeof deliveryTemplate>;
export const taskSubmission = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  submittedByUserId: z.string().min(1),
  note: z.string(),
  professionalDelivery: deliveryTemplate
    .extend({ answers: z.record(z.string(), z.union([z.string(), z.array(z.string().uuid())])) })
    .nullable(),
  canvasVersionId: z.string().uuid().nullable(),
  productionVersionId: z.string().uuid().nullable(),
  reviewNote: z.string().nullable(),
  reviewedByUserId: z.string().nullable(),
  reviewedAt: date.nullable(),
  mergedAt: date.nullable(),
  createdAt: date,
  assets: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      mediaAssetId: z.string().uuid().nullable(),
      contentType: z.string().nullable(),
      sizeBytes: z.number().nonnegative().nullable(),
    })
  ),
});
export type TaskSubmission = z.infer<typeof taskSubmission>;
export async function fetchTaskDeliveryTemplate(taskId: string, signal: AbortSignal) {
  z.string().uuid().parse(taskId);
  return deliveryTemplate
    .nullable()
    .parse(await api.get(`/crew-tasks/${taskId}/delivery-template`, { service: "aurora", signal }));
}
export function deliveryPrice(amountMinor: string) {
  const digits = amountMinor.padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
