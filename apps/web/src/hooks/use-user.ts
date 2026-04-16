import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUserInfo,
  updateUserInfo,
  uploadAvatar,
  uploadCover,
  getCredits,
  getRecommendationCode,
  type UserInfo,
} from "@/src/services/user";

// ─── Query Keys ───────────────────────────────────────

export const userKeys = {
  info: ["user", "info"] as const,
  credits: ["user", "credits"] as const,
};

// ─── User Info ────────────────────────────────────────

export function useUserInfo() {
  return useQuery<UserInfo>({
    queryKey: userKeys.info,
    queryFn: getUserInfo,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
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
