import { CrewTaskKind } from '@prisma/client';
import { z } from 'zod';
import {
  DeliveryFieldTypeSchema,
  PlotTreeSchema,
} from './project-task-template.types';

const ItemSchema = z
  .object({
    templateKey: z.string().trim().min(1),
    title: z.string().trim().min(1),
    category: z.enum(['creative', 'production']),
    roleRequirement: z.string(),
    qualification: z
      .object({
        pdLevel: z.enum(['PD', 'FD']).optional(),
        fdRank: z
          .union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
          ])
          .optional(),
        certification: z.string().optional(),
      })
      .passthrough()
      .optional(),
    deliveryFields: z.array(
      z
        .object({ type: DeliveryFieldTypeSchema, required: z.boolean() })
        .passthrough(),
    ),
    unit: z.string(),
    priceRange: z
      .object({
        min: z.number().finite().nonnegative(),
        max: z.number().finite().nonnegative().optional(),
        unit: z.literal('percent').optional(),
      })
      .passthrough()
      .refine((value) => value.max === undefined || value.max >= value.min, {
        message: 'Maximum price must be at least the minimum',
      })
      .optional(),
    defaultDependencies: z.array(z.string().trim().min(1)),
    taskKind: z.nativeEnum(CrewTaskKind),
    priority: z.enum(['normal', 'urgent', 'critical']),
    requiresPlotTree: z.boolean(),
    deliveryCategoryKey: z.string().optional(),
  })
  .passthrough();

/** Validate before replacing the active version, including its dependency graph. */
export const TaskTemplateDefinitionSchema = z
  .object({
    version: z.number().int().positive(),
    items: z.array(ItemSchema).min(1),
    plotTree: PlotTreeSchema.optional(),
  })
  .passthrough()
  .superRefine((definition, ctx) => {
    const byKey = new Map<string, number>();
    for (const [index, item] of definition.items.entries()) {
      if (byKey.has(item.templateKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'templateKey'],
          message: 'Task template keys must be unique',
        });
        return;
      }
      byKey.set(item.templateKey, index);
    }
    const remaining = definition.items.map(() => 0);
    const dependants = definition.items.map(() => [] as number[]);
    for (const [index, item] of definition.items.entries()) {
      const seen = new Set<string>();
      for (const [dependencyIndex, key] of item.defaultDependencies.entries()) {
        const target = byKey.get(key);
        if (target === undefined || target === index || seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'defaultDependencies', dependencyIndex],
            message:
              'Dependencies must reference distinct other tasks in this template',
          });
          return;
        }
        seen.add(key);
        remaining[index] += 1;
        dependants[target].push(index);
      }
    }
    // Iterative traversal also handles long chains without a recursive stack limit.
    const ready = remaining.flatMap((count, index) =>
      count === 0 ? [index] : [],
    );
    for (let cursor = 0; cursor < ready.length; cursor += 1) {
      for (const index of dependants[ready[cursor]]) {
        remaining[index] -= 1;
        if (remaining[index] === 0) ready.push(index);
      }
    }
    if (ready.length !== definition.items.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Task dependencies must not contain a cycle',
      });
    }
  });
