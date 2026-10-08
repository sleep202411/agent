/** Super admins see and use every admin surface, even if a new catalog key is not on the role yet. */
export function grantsAdminAccess(
  actor: { roleKeys?: readonly string[]; permissions?: readonly string[] },
  permission?: string
) {
  if (!permission) return true;
  if (actor.roleKeys?.includes("super_admin")) return true;
  return actor.permissions?.includes(permission) === true;
}
