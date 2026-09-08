"use client";

import { type CrewPermissionKey, type CrewPolicyKey } from "@repo/shared/crew";
import { useUserInfo } from "@/src/hooks/use-user";
import { useCrewMembership } from "./use-members";

export interface UserCrewPermissions {
  effectiveUserId?: string;
  effectiveName?: string;
  isMember: boolean;
  isOwner: boolean;
  policyKeys: CrewPolicyKey[];
  permissions: CrewPermissionKey[];
  can: (permission: CrewPermissionKey) => boolean;
}

function result(input: Omit<UserCrewPermissions, "can">): UserCrewPermissions {
  const allowed = new Set(input.permissions);
  return { ...input, can: (permission) => allowed.has(permission) };
}

export function useCrewPermissions(crewId: string): UserCrewPermissions {
  const { data: userInfo } = useUserInfo();
  const { data: membership } = useCrewMembership(crewId);
  const realName = userInfo?.nickName || userInfo?.userName || undefined;

  if (!membership) {
    return result({
      isMember: false,
      isOwner: false,
      policyKeys: [],
      permissions: [],
    });
  }
  return result({
    effectiveUserId: membership.userId,
    effectiveName: realName ?? `User ${membership.userId}`,
    isMember: true,
    isOwner: membership.member.isOwner,
    policyKeys: membership.member.policyKeys,
    permissions: membership.permissions,
  });
}
