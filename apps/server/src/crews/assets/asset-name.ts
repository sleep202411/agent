import { ConflictException } from '@nestjs/common';

/**
 * Preserve the human filename while allocating a unique name in one folder.
 * The caller must hold the folder-name advisory lock until its transaction
 * commits.
 */
export function availableCrewAssetName(
  requested: string,
  usedLowercase: Set<string>,
): string {
  if (!usedLowercase.has(requested.toLowerCase())) return requested;

  const lastDot = requested.lastIndexOf('.');
  const hasShortExtension =
    lastDot > 0 &&
    requested.length - lastDot > 1 &&
    requested.length - lastDot <= 33;
  const stem = hasShortExtension ? requested.slice(0, lastDot) : requested;
  const extension = hasShortExtension ? requested.slice(lastDot) : '';
  for (let copy = 2; copy < 100_000; copy += 1) {
    const suffix = ` (${copy})`;
    const maxStemLength = Math.max(1, 256 - suffix.length - extension.length);
    const candidate = `${stem.slice(0, maxStemLength)}${suffix}${extension}`;
    if (!usedLowercase.has(candidate.toLowerCase())) return candidate;
  }
  throw new ConflictException('Could not allocate a unique asset name');
}
