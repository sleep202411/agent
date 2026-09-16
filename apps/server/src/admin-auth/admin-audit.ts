import { AdminAuditOutcome, AdminSiteScope, Prisma } from '@prisma/client';
import type { AdminActor, AdminRequestContext } from './admin-auth.types';

export type AuditInput = {
  actor?: AdminActor | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: AdminAuditOutcome;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  context?: AdminRequestContext;
};

export async function writeAdminAudit(
  db: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  const metadata = input.metadata ?? {};

  await db.adminAuditLog.create({
    data: {
      actorUserId: input.actor?.id,
      actorSessionId: input.actor?.sessionId,
      siteScope: (input.actor?.siteScope ??
        AdminSiteScope.all) as AdminSiteScope,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome ?? AdminAuditOutcome.success,
      reason: input.reason,
      ipAddress: input.context?.ipAddress,
      userAgent: input.context?.userAgent,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      metadata,
    },
  });
}
