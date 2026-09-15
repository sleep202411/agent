import "server-only";

import { cookies } from "next/headers";
import { env } from "@/src/env";
import {
  resolveAssetUrl,
  type UserCertLevel,
  type UserInfo,
  type UserInfoResolved,
} from "@/src/services/user";

interface UserCertLevelWire {
  id: number;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  type?: number;
  remark?: string | null;
  content?: string | null;
}

interface UserInfoEnvelope {
  code?: number;
  info?: UserInfo;
  level?: UserCertLevelWire[];
}

/**
 * Server-side user-info bootstrap.
 *
 * Called from `app/layout.tsx` to prefetch the current user's profile
 * during SSR. Result is dehydrated into the React Query cache via
 * <HydrationBoundary> so the first client paint already has the
 * logged-in state — no flash from "未登录 skeleton" → "已登录 UI".
 *
 * Behaviour by satoken state:
 *
 *   no satoken cookie         → return null (visitor, no fetch)
 *   satoken + Java 401 / 5xx  → return null (treat as logged-out;
 *                               client side handles redirect later
 *                               when a user-specific call hits 401)
 *   satoken + Java 200        → return UserInfoResolved
 *
 * The fetcher intentionally swallows errors so a flaky Java backend
 * never breaks page load. Worst case the page renders as visitor —
 * the client `useUserInfo` will retry once the React tree mounts.
 *
 * Path note: `/user/query/user/info` is on the Java *content* service.
 * SSR fetch must hit Java directly (server-side fetch can't traverse
 * Next's rewrite layer back through itself), so we prepend the
 * server-only `JAVA_CONTENT_URL` env here.
 */
export async function fetchUserInfoServerSide(locale?: string): Promise<UserInfoResolved | null> {
  const cookieStore = await cookies();
  const satoken = cookieStore.get("satoken")?.value;
  if (!satoken) return null;

  const javaContentUrl = process.env.JAVA_CONTENT_URL;
  if (!javaContentUrl) {
    console.warn("[fetchUserInfoServerSide] JAVA_CONTENT_URL not configured");
    return null;
  }

  let res: Response;
  try {
    res = await fetch(`${javaContentUrl}/user/query/user/info`, {
      method: "GET",
      headers: {
        Cookie: `satoken=${satoken}`,
        Accept: "application/json",
        ...(locale ? { "Accept-Language": locale } : {}),
      },
      // SSR — never cache. Each request reflects the current cookie.
      cache: "no-store",
    });
  } catch (err) {
    console.warn(
      `[fetchUserInfoServerSide] network error: ${err instanceof Error ? err.message : err}`
    );
    return null;
  }

  if (!res.ok) {
    if (res.status !== 401 && res.status !== 403) {
      console.warn(`[fetchUserInfoServerSide] HTTP ${res.status} from Java`);
    }
    return null;
  }

  let body: UserInfoEnvelope;
  try {
    body = (await res.json()) as UserInfoEnvelope;
  } catch {
    return null;
  }
  // Java's success code is 200 — anything else (incl. its own 401-as-200
  // envelope) is treated as logged-out. Matches the client api-client
  // behaviour so SSR + client paths agree on session validity.
  if (body.code !== 200 || !body.info) return null;

  const info = body.info;
  const rawLevels: UserCertLevelWire[] = Array.isArray(body.level) ? body.level : [];
  const avatarBase = env.USER_BASE_URL || env.OSS_BASE_URL;
  const levels: UserCertLevel[] = rawLevels.map((l) => ({
    ...l,
    iconUrl: resolveAssetUrl(l.imagePath, env.STATIC_BASE_URL) ?? "",
  }));
  return {
    ...info,
    headImgUrl: resolveAssetUrl(info.headImg ?? info.avatar, avatarBase),
    bannerUrl: resolveAssetUrl(info.banner, env.BANNER_BASE_URL),
    levels,
  };
}
