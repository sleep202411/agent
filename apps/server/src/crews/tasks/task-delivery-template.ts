import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DeliveryDefinition } from './delivery-catalog';
export const TaskDeliveryTemplateInput = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    category: z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .strict()
      .nullable(),
  })
  .strict();
export const ProfessionalDeliveryInput = z
  .object({
    categoryId: z.string().uuid(),
    version: z.number().int().positive(),
    answers: z.record(
      z.string(),
      z.union([
        z.string().trim().max(5000),
        z.array(z.string().uuid()).max(100),
      ]),
    ),
  })
  .strict();
export type TaskDeliveryTemplate = {
  categoryId: string;
  version: number;
  definition: z.infer<typeof DeliveryDefinition>;
};
export async function readTaskDeliveryTemplate(
  tx: Prisma.TransactionClient,
  taskId: string,
) {
  const [row] = await tx.$queryRaw<
    TaskDeliveryTemplate[]
  >`SELECT r.category_id AS "categoryId",r.version,r.definition
    FROM crew_task_delivery_templates t JOIN crew_delivery_catalog_revisions r ON r.category_id=t.category_id AND r.version=t.category_version
    WHERE t.task_id=${taskId}::uuid`;
  return row ?? null;
}
export function validateProfessionalDelivery(
  template: TaskDeliveryTemplate | null,
  input: z.infer<typeof ProfessionalDeliveryInput> | undefined,
  assetIds: string[],
) {
  if (!template) {
    if (input)
      throw new ConflictException(
        'This task has no professional delivery template. Refresh the task.',
      );
    return null;
  }
  if (
    !input ||
    input.categoryId !== template.categoryId ||
    input.version !== template.version
  )
    throw new ConflictException(
      'The professional delivery template changed or is missing. Refresh the task.',
    );
  const fields = new Map(
    template.definition.fields.map((field) => [field.key, field]),
  );
  if (Object.keys(input.answers).some((key) => !fields.has(key)))
    throw new BadRequestException('Unknown professional delivery field.');
  const attached = new Set(assetIds);
  for (const field of fields.values()) {
    const value = input.answers[field.key];
    if (value === undefined) {
      if (field.required)
        throw new BadRequestException(
          `Required delivery field: ${field.label}`,
        );
      continue;
    }
    if (field.type === 'text') {
      if (typeof value !== 'string' || (field.required && !value.trim()))
        throw new BadRequestException(
          `Text is required for delivery field: ${field.label}`,
        );
    } else if (
      !Array.isArray(value) ||
      (field.required && !value.length) ||
      value.some((id) => !attached.has(id)) ||
      new Set(value).size !== value.length
    ) {
      throw new BadRequestException(
        `Select submitted attachments for delivery field: ${field.label}`,
      );
    }
  }
  return {
    categoryId: template.categoryId,
    version: template.version,
    definition: template.definition,
    answers: input.answers,
  };
}
