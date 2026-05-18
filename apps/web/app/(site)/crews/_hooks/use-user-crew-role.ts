/**
 * Resolves the current viewer's role inside a crew —
 * `'admin' | 'finance' | 'member' | 'outsider'` — used by the
 * workspace UI to gate every action.
 *
 * Dev mode: the floating `DevIdentitySwitcher` wins, so reviewers can
 * impersonate any role without re-logging-in. The chosen identity also
 * decides the effective userId used for member-scoped checks (e.g.
 * "is this assignment mine?") so submit-for-review buttons appear on
 * the right rows.
 *
 * Production mode: derived from real `userInfo.id` matched against the
 * crew's `founderId` and the membership list (each member carries a
 * server-managed `isFinance` flag, so we read that directly now).
 */

"use client";

import { useUserInfo } from "@/src/hooks/use-user";
import { useCrewDetail, useCrewMembers } from "./use-crew";
import { useDevIdentity } from "./use-dev-identity";

export type CrewRole = "admin" | "finance" | "member" | "outsider";

export interface UserCrewRole {
  /** Discriminated role, used to gate UI surfaces. */
  role: CrewRole;
  /** Effective userId for action attribution — accounts for dev impersonation. */
  effectiveUserId?: string;
  /** Display name of the effective viewer (used in toasts / activity). */
  effectiveName?: string;
  /** Convenience flags so call sites read like permission checks. */
  isAdmin: boolean;
  isFinance: boolean;
  isMember: boolean;
}

export function useUserCrewRole(crewId: string): UserCrewRole {
  const { data: userInfo } = useUserInfo();
  const { data: crewDetail } = useCrewDetail(crewId);
  const { data: crewMembers = [] } = useCrewMembers(crewId);
  const devIdentity = useDevIdentity();

  const realUserId = userInfo?.id != null ? String(userInfo.id) : undefined;
  const realIsAdmin =
    realUserId != null && crewDetail?.founderId != null && crewDetail.founderId === realUserId;
  const realMember =
    realUserId != null ? crewMembers.find((m) => m.userId === realUserId) : undefined;
  const realIsFinance = realMember?.isFinance === true;

  if (process.env.NODE_ENV !== "production") {
    if (devIdentity.kind === "owner") {
      return {
        role: "admin",
        effectiveUserId: crewDetail?.founderId ?? realUserId,
        effectiveName: userInfo?.nickName || userInfo?.userName || "Owner",
        isAdmin: true,
        isFinance: false,
        isMember: false,
      };
    }
    if (devIdentity.kind === "finance") {
      const financeMember = crewMembers.find((m) => m.isFinance);
      return {
        role: "finance",
        effectiveUserId: financeMember?.userId ?? realUserId,
        effectiveName: "Finance",
        isAdmin: false,
        isFinance: true,
        isMember: false,
      };
    }
    if (devIdentity.kind === "member") {
      // Match by member id since we no longer have nicknames server-side.
      const target = crewMembers.find((m) => m.userId === devIdentity.name);
      if (target) {
        return {
          role: "member",
          effectiveUserId: target.userId,
          effectiveName: `User ${target.userId}`,
          isAdmin: false,
          isFinance: false,
          isMember: true,
        };
      }
    }
    if (devIdentity.kind === "visitor") {
      return { role: "outsider", isAdmin: false, isFinance: false, isMember: false };
    }
  }

  if (realIsAdmin) {
    return {
      role: "admin",
      effectiveUserId: realUserId,
      effectiveName: userInfo?.nickName || userInfo?.userName || "Owner",
      isAdmin: true,
      isFinance: false,
      isMember: false,
    };
  }
  if (realIsFinance) {
    return {
      role: "finance",
      effectiveUserId: realUserId,
      effectiveName: userInfo?.nickName || userInfo?.userName || "Finance",
      isAdmin: false,
      isFinance: true,
      isMember: false,
    };
  }
  if (realMember) {
    return {
      role: "member",
      effectiveUserId: realMember.userId,
      effectiveName: userInfo?.nickName || `User ${realMember.userId}`,
      isAdmin: false,
      isFinance: false,
      isMember: true,
    };
  }
  return { role: "outsider", isAdmin: false, isFinance: false, isMember: false };
}
