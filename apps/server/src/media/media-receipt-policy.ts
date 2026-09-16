import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Expense evidence is readable only through its claim/revision authorization. */
export function requireNonReceiptAsset(metadata: Prisma.JsonValue): void {
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    metadata.uploadKind === 'crew_expense_receipt'
  ) {
    throw new ForbiddenException({
      code: 'EXPENSE_RECEIPT_ACCESS_REQUIRED',
      message: 'Open this receipt through its expense claim.',
    });
  }
}
