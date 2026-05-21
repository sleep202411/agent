/**
 * ID param helper shared by every controller that takes a `:id` path
 * segment.
 *
 * All crew/notification PKs are CUID (25-char alphanumeric). We don't
 * do a strict CUID-format regex because Prisma versions vary on
 * exactly which generator they ship; instead we accept any reasonable
 * non-empty token and let the query fail cleanly if the id is shaped
 * wrong.
 */
import { BadRequestException } from '@nestjs/common';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseIdParam(raw: string, fieldName = 'id'): string {
  if (!raw || !ID_RE.test(raw)) {
    throw new BadRequestException({
      message: `Invalid ${fieldName}`,
      field: fieldName,
    });
  }
  return raw;
}
