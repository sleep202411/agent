import { redirect } from "next/navigation";
import { getAdminSession } from "./admin-session";

export type ContentPermission = "news.read" | "news.write" | "courses.read" | "courses.write";

// Resolve the current server session on every request. Never trust a client role
// or cache a permission decision across role revocation/account replacement.
export async function contentPermissionResponse(permission: ContentPermission) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!session.user.permissions.includes(permission)) {
    return Response.json({ error: "Permission denied" }, { status: 403 });
  }
  return null;
}

export async function requireContentPagePermission(permission: ContentPermission) {
  const session = await getAdminSession();
  if (!session) redirect("/login");
  if (!session.user.permissions.includes(permission)) redirect("/forbidden");
  return session;
}
