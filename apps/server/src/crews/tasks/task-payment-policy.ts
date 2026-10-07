import type { Prisma } from '@prisma/client';
import { TASK_PAYMENT_TERMS, type TaskPaymentTerms } from '@repo/shared/crew';
export function taskPaymentTerm(metadata: unknown): TaskPaymentTerms | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const compensation = (metadata as { compensation?: unknown }).compensation;
  if (!compensation || typeof compensation !== 'object') return null;
  const value = (compensation as { paymentTerms?: unknown }).paymentTerms;
  return TASK_PAYMENT_TERMS.find((term) => term === value) ?? null;
}
/** Confirmed recruitment terms override task defaults for that creator. */
export async function assignedPaymentTerm(
  tx: Prisma.TransactionClient,
  taskId: string,
  userId: string,
  metadata: unknown,
) {
  const application = await tx.crewApplication.findFirst({
    where: { applicantId: userId, status: 'approved', position: { taskId } },
    orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    include: {
      terms: {
        where: { confirmedAt: { not: null } },
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });
  if (application) {
    const terms = application.terms.find(
      (t) => t.version === application.termsVersion && t.confirmedAt,
    );
    if (terms)
      return TASK_PAYMENT_TERMS.find((t) => t === terms.paymentTerms) ?? null;
  }
  return taskPaymentTerm(metadata);
}
