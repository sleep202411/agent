import { redirect } from "next/navigation";
import { grantsAdminAccess } from "./admin-capability";
import { getAdminSession } from "./admin-session";

export type ContentPermission = "news.read" | "news.write" | "courses.read" | "courses.write";

// Resolve the current server session on every request. Never trust a client role
// or cache a permission decision across role revocation/account replacement.
export async function contentPermissionResponse(permission: ContentPermission) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!grantsAdminAccess(session.user, permission)) {
    return Response.json({ error: "Permission denied" }, { status: 403 });
  }
  return null;
}

export async function requireAdminPagePermission(permission: string) {
  const session = await getAdminSession();
  if (!session) redirect("/login");
  if (!grantsAdminAccess(session.user, permission)) redirect("/forbidden");
  return session;
}

export async function requireContentPagePermission(permission: ContentPermission) {
  return requireAdminPagePermission(permission);
}
