import { ServiceUnavailableException } from '@nestjs/common';

/** Configuration selects a provisioned private destination, never a media or moderation store. */
export function requirePrivateUploadTarget(
  setting: string,
  target: string,
  excluded: readonly string[],
): string {
  if (!target || excluded.includes(target)) {
    throw new ServiceUnavailableException(
      `${setting} must name a separate private upload destination`,
    );
  }
  return target;
}
