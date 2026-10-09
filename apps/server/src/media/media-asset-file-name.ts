import type { Prisma } from '@prisma/client';

export function mediaAssetFileName(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  return typeof metadata.fileName === 'string' ? metadata.fileName : null;
}
