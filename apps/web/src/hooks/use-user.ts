"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUserInfo,
  updateUserInfo,
  uploadAvatar,
  uploadBanner,
  getCredits,
  getRecommendationCode,
  type UserInfoResolved,
} from "@/src/services/user";
import { useLocale } from "@/src/i18n/i18n";
import { userKeys } from "@/src/hooks/user-keys";

export { userKeys };

// ─── User Info ────────────────────────────────────────

export function useUserInfo() {
  const locale = useLocale();
  return useQuery<UserInfoResolved>({
    queryKey: userKeys.infoOf(locale),
    queryFn: ({ signal }) => getUserInfo(signal),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Normalized session-user shape consumed by nav menus & guards.
 * Returns the same field names the now-removed Redux `auth.user`
 * slice used to expose, so swapping `useAppSelector(...auth.user)`
 * for `useCurrentUser().user` is a one-line change at each callsite.
 *
 * `avatar` / `cover` are resolved full URLs (USER_BASE_URL +
 * headImg, BANNER_BASE_URL + banner). Components don't need to
 * compose URLs locally any more.
 */
export interface CurrentUser {
  id: string;
  email: string;
  nickname: string;
  avatar?: string;
  cover?: string;
  /** Escape hatch for fields not in the normalized projection. */
  raw: UserInfoResolved;
}

export function useCurrentUser(): {
  user: CurrentUser | null;
  isLoading: boolean;
  isFetched: boolean;
} {
  const { data, isLoading, isFetched } = useUserInfo();
  const user = useMemo<CurrentUser | null>(() => {
    if (!data) return null;
    const id = data.id;
    if (id === undefined || id === null) return null;
    return {
      id: String(id),
      email: data.email ?? "",
      nickname: data.nickName ?? data.userName ?? data.name ?? "",
      avatar: data.headImgUrl,
      cover: data.bannerUrl,
      raw: data,
    };
  }, [data]);
  return { user, isLoading, isFetched };
}

// ─── Credits ──────────────────────────────────────────

export function useCredits() {
  const { user } = useCurrentUser();
  return useQuery<number>({
    queryKey: userKeys.accountCredits(user?.id ?? null),
    enabled: !!user?.id,
    queryFn: getCredits,
    staleTime: 60 * 1000, // 1 minute
  });
}

// ─── Update Profile ───────────────────────────────────

export function useUpdateUserInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserInfo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.info });
    },
  });
}

// ─── Upload Avatar ────────────────────────────────────

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadAvatar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.info });
    },
  });
}

// ─── Upload Banner ────────────────────────────────────

/**
 * Upload a cover/banner image. Two-step backend contract:
 *   1. POST /project/uploadBanner       → returns relative path
 *   2. POST /user/update/user/info      → persist `{ banner: <path> }`
 *
 * Both steps are stitched together here so callsites just hand over a
 * File and get cache invalidation for free. Either step failing leaves
 * the user-info cache untouched.
 */
export function useUploadBanner() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const { user } = useCurrentUser();
  const account = useRef<{ id: string | null; active: boolean } | null>(null);
  useLayoutEffect(() => {
    const scope = { id: user?.id ?? null, active: true };
    account.current = scope;
    return () => {
      scope.active = false;
    };
  }, [user?.id, locale]);
  return useMutation({
    mutationFn: async (file: File) => {
      const origin = account.current;
      const assertAccount = () => {
        const current = queryClient.getQueryData<UserInfoResolved | null>(userKeys.infoOf(locale));
        if (!origin?.active || !origin.id || String(current?.id ?? "") !== origin.id) {
          throw new DOMException(
            "Profile upload cancelled because the account is no longer active.",
            "AbortError"
          );
        }
      };
      assertAccount();
      const path = await uploadBanner(file);
      assertAccount();
      await updateUserInfo({ banner: path });
      assertAccount();
      return path;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.info });
    },
  });
}

// ─── Referral Code ────────────────────────────────────

export function useReferralCode() {
  return useMutation({
    mutationFn: getRecommendationCode,
  });
}

// ─── Refresh helpers ──────────────────────────────────

export function useRefreshCredits() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  return () =>
    user?.id
      ? queryClient.invalidateQueries({ queryKey: userKeys.accountCredits(user.id) })
      : Promise.resolve();
}
