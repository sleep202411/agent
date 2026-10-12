import { CURRENT_CELL } from '../common/region/current-cell';
import type { AdminActor } from './admin-auth.types';

export const DIRECT_POINTS_GRANT = 'points.direct_grant';

// Existing regional identities verified read-only on 2026-10-12. Bind to immutable
// IDs rather than editable display names, emails, or broad administrator roles.
export const POINTS_OPERATORS = {
  global: {
    pax: '019eb8f0-08fd-77b3-b052-e6031e3e116a',
    producer: '01a11b08-fa68-7089-ad20-e44a15e27153',
  },
  cn: {
    pax: '019f408c-ceb5-73dc-8b83-35fa77e6fdc7',
    producer: '01a11b14-7ea0-7018-b997-417609b02579',
  },
} as const;

export function isPointsOperator(
  actor: Pick<AdminActor, 'id' | 'status' | 'siteScope'>,
  kind: 'pax' | 'producer',
  region: 'global' | 'com' | 'cn' = CURRENT_CELL,
) {
  const site = region === 'cn' ? 'cn' : 'global';
  return (
    actor.status === 'active' &&
    (actor.siteScope === 'all' || actor.siteScope === site) &&
    actor.id === POINTS_OPERATORS[site][kind]
  );
}
