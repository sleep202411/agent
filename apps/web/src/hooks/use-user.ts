import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUserInfo,
  updateUserInfo,
  uploadAvatar,
  uploadCover,
  getCredits,
  getRecommendationCode,
  type UserInfo,
  type UserInfoResolved,
} from "@/src/services/user";

// ─── Query Keys ───────────────────────────────────────

export const userKeys = {
  info: ["user", "info"] as const,
  credits: ["user", "credits"] as const,
};

// ─── User Info ────────────────────────────────────────

export function useUserInfo() {
  return useQuery<UserInfoResolved>({
    queryKey: userKeys.info,
    queryFn: getUserInfo,
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
 * headImg, BANNER_BASE_URL + coverImage). Components don't need to
 * compose URLs locally any more.
 */
export interface CurrentUser {
  id: string;
  email: string;
  nickname: string;
  avatar?: string;
  cover?: string;
  userLevel?: string;
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
      cover: data.coverImageUrl,
      userLevel: data.userLevel,
      raw: data,
    };
  }, [data]);
  return { user, isLoading, isFetched };
}

// ─── Credits ──────────────────────────────────────────

export function useCredits() {
  return useQuery<number>({
    queryKey: userKeys.credits,
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

// ─── Upload Cover ─────────────────────────────────────

export function useUploadCover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadCover,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.info });
    },
  });
}

// ─── Referral Code ────────────────────────────────────

export function useReferralCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: getRecommendationCode,
  });
}

// ─── Refresh helpers ──────────────────────────────────

export function useRefreshCredits() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: userKeys.credits });
}
