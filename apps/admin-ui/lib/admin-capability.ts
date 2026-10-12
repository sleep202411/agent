/** Super-admin access does not bypass identity-bound direct points grants. */
export function grantsAdminAccess(
  actor: { roleKeys?: readonly string[]; permissions?: readonly string[] },
  permission?: string
) {
  if (!permission) return true;
  if (permission === "points.direct_grant") return actor.permissions?.includes(permission) === true;
  if (actor.roleKeys?.includes("super_admin")) return true;
  return actor.permissions?.includes(permission) === true;
}
