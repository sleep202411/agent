/**
 * Build-time cell identifier for the Nest server.
 *
 * Reads the same env var as the web bundle (`NEXT_PUBLIC_SITE_REGION`)
 * so both tiers of one deployment agree on which cell they're in. The
 * `NEXT_PUBLIC_` prefix is a Next.js convention; for the Nest pod it
 * has no special meaning beyond being the agreed cell-discriminator
 * variable name.
 *
 * An explicit cell is required in every runtime.
 */

import type { Cell } from './region.types';

export const CURRENT_CELL: Cell = (() => {
  const raw = process.env.NEXT_PUBLIC_SITE_REGION ?? process.env.SITE_REGION;
  if (raw === 'com' || raw === 'cn') return raw;
  if (raw === 'global') return 'global';
  throw new Error('NEXT_PUBLIC_SITE_REGION must be cn, com or global');
})();
