import { z } from 'zod';

export const ListAdminAuditQuerySchema = z
  .object({
    q: z.string().trim().max(160).optional(),
    action: z.string().trim().max(120).optional(),
    resourceType: z.string().trim().max(80).optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListAdminAuditQuery = z.infer<typeof ListAdminAuditQuerySchema>;
