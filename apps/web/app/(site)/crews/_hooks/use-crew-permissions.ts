"use client";

import {
  CREW_MEMBER_PERMISSIONS,
  CREW_PERMISSION_KEYS,
  CREW_POLICY_PERMISSIONS,
  type CrewPermissionKey,
  type CrewPolicyKey,
} from "@repo/shared/crew";
import { useUserInfo } from "@/src/hooks/use-user";
import { useCrewDetail } from "./use-crew-detail";
import { useCrewMembers, useCrewMembership } from "./use-members";
import { useDevIdentity } from "./use-dev-identity";

export interface UserCrewPermissions {
  effectiveUserId?: string;
  effectiveName?: string;
  isMember: boolean;
  isOwner: boolean;
  policyKeys: CrewPolicyKey[];
  permissions: CrewPermissionKey[];
  can: (permission: CrewPermissionKey) => boolean;
}

function permissionSet(policyKeys: CrewPolicyKey[], isOwner: boolean): CrewPermissionKey[] {
  if (isOwner) return [...CREW_PERMISSION_KEYS];
  const permissions = new Set<CrewPermissionKey>(CREW_MEMBER_PERMISSIONS);
  for (const policyKey of policyKeys) {
    for (const permission of CREW_POLICY_PERMISSIONS[policyKey]) {
      permissions.add(permission);
    }
  }
  return CREW_PERMISSION_KEYS.filter((permission) => permissions.has(permission));
}

function result(input: Omit<UserCrewPermissions, "can">): UserCrewPermissions {
  const allowed = new Set(input.permissions);
  return { ...input, can: (permission) => allowed.has(permission) };
}

export function useCrewPermissions(crewId: string): UserCrewPermissions {
  const { data: userInfo } = useUserInfo();
  const { data: crew } = useCrewDetail(crewId);
  const { data: members = [] } = useCrewMembers(crewId);
  const { data: membership } = useCrewMembership(crewId);
  const devIdentity = useDevIdentity();
  const realUserId = membership?.userId ?? (userInfo?.id != null ? String(userInfo.id) : undefined);
  const realName = userInfo?.nickName || userInfo?.userName || undefined;

  if (process.env.NODE_ENV !== "production") {
    if (devIdentity.kind === "visitor") {
      return result({
        isMember: false,
        isOwner: false,
        policyKeys: [],
        permissions: [],
      });
    }
    if (devIdentity.kind === "owner") {
      return result({
        effectiveUserId: crew?.ownerUserId ?? realUserId,
        effectiveName: realName ?? "Owner",
        isMember: true,
        isOwner: true,
        policyKeys: [],
        permissions: permissionSet([], true),
      });
    }
    if (devIdentity.kind === "finance") {
      const member = members.find((candidate) => candidate.policyKeys.includes("finance"));
      return result({
        effectiveUserId: member?.userId ?? realUserId,
        effectiveName: "Finance",
        isMember: true,
        isOwner: false,
        policyKeys: ["finance"],
        permissions: permissionSet(["finance"], false),
      });
    }
    if (devIdentity.kind === "member") {
      const member = members.find((candidate) => candidate.userId === devIdentity.name);
      if (member) {
        return result({
          effectiveUserId: member.userId,
          effectiveName: `User ${member.userId}`,
          isMember: true,
          isOwner: member.isOwner,
          policyKeys: member.policyKeys,
          permissions: permissionSet(member.policyKeys, member.isOwner),
        });
      }
    }
  }

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
