import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { isRetiredRoleKey } from "@/components/admin/users/permission-tree";
import type { AdminRolesData, AdminSessionsData } from "@/components/admin/users/types";

export type AdminUsersLoadResult<T> = {
  data: T | null;
  error: string | null;
};

async function fetchResource<T>(
  path: string,
  fallbackMessage: string
): Promise<AdminUsersLoadResult<T>> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const headers = adminAuthHeaders(sessionToken);
  if (!headers) return { data: null, error: "后台登录已失效，请重新登录。" };

  try {
    const response = await fetch(adminApiUrl(path), {
      headers,
      cache: "no-store",
    });
    return { data: await parseAdminEnvelope<T>(response), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : fallbackMessage };
  }
}

export async function fetchAdminRoles(): Promise<AdminUsersLoadResult<AdminRolesData>> {
  const result = await fetchResource<AdminRolesData>("/users/roles", "角色权限数据加载失败。");
  if (!result.data) return result;
  return {
    ...result,
    data: {
      ...result.data,
      roles: result.data.roles.filter((role) => !isRetiredRoleKey(role.key)),
    },
  };
}

export function fetchAdminSessions(): Promise<AdminUsersLoadResult<AdminSessionsData>> {
  return fetchResource<AdminSessionsData>("/users/sessions", "会话数据加载失败。");
}
