import { BadRequestException } from '@nestjs/common';

const MOUNT =
  /^\/(?:aurora\/)?game-agent\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/appearance\/web\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(.*))?$/i;

/** Parse before URL normalization, which would silently erase dot segments. */
export function gameAgentWebPath(raw: string | undefined) {
  const [pathname, ...queryParts] = (raw ?? '').split('?');
  const match = MOUNT.exec(pathname);
  if (!match) return null;
  const path = match[3] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new BadRequestException('Invalid Game Agent request path.');
  }
  const query = queryParts.join('?');
  if (
    path.length > 2048 ||
    query.length > 4096 ||
    /%2f|%5c|%25/i.test(path) ||
    /[\\?#]/.test(decoded) ||
    [...decoded].some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    ) ||
    decoded.split('/').some((part) => part === '.' || part === '..')
  )
    throw new BadRequestException('Invalid Game Agent request path.');
  return {
    projectId: match[1],
    id: match[2],
    path,
    suffix: `${path}${query ? `?${query}` : ''}`,
  };
}
