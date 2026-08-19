import "server-only";

import { javaAdminAuthHeaders } from "@/lib/java-admin-auth";

/**
 * Admin actions on C-end users (Java-owned `client_user`): edit profile,
 * block. These are the Java backend's official admin endpoints — blocking
 * flips account_status=5, writes block_reason, and force-logs-out the user's
 * sessions (StpUtil.logout), none of which a raw DB write would do.
 *
 * Auth is the server-only X-Admin-Api-Token (same secret as the 资讯 module),
 * so this module must NEVER be imported into client code. The origin is the
 * shared Java content backend (reuses NEWS_API_BASE_URL until a dedicated var
 * is set).
 */

function javaUsersApiBaseUrl(): string {
  const base = (process.env.JAVA_ADMIN_API_BASE_URL ?? process.env.NEWS_API_BASE_URL)?.trim();
  if (base) return base.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "https://java.fizzdragon.com/content";
  throw new Error("Missing JAVA_ADMIN_API_BASE_URL / NEWS_API_BASE_URL (Java content origin).");
}

async function usersFetch(path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${javaUsersApiBaseUrl()}/api/admin/users${path}`, {
    method: "POST",
    headers: {
      ...javaAdminAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
  } | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.msg ?? `用户服务请求失败：${response.status}`);
  }
}

export interface UpdateClientUserInfoInput {
  nickName?: string;
  contact?: string;
  description?: string;
  other?: string;
}

/** Edit a C-end user's profile fields (only the provided ones). */
export async function updateClientUserInfo(
  userId: number,
  patch: UpdateClientUserInfoInput
): Promise<void> {
  await usersFetch("/update/info", { userId, ...patch });
}

/** Block a C-end user (account_status=5 + reason + force logout). */
export async function blockClientUser(userId: number, reason: string): Promise<void> {
  await usersFetch("/forbidden", { userId, reason });
}
