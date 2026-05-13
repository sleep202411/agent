/**
 * Resolves the current viewer's effective role inside a crew —
 * `'admin' | 'finance' | 'member' | 'outsider'` — which the episode
 * UI uses to gate every action button.
 *
 * Dev mode: the floating `DevIdentitySwitcher` wins, so reviewers can
 * impersonate any role without re-logging-in. The chosen identity also
 * decides the *effective userId* used for member-scoped checks (e.g.
 * "is this assignment mine?") so submit-for-review buttons appear on
 * the right rows.
 *
 * Production mode: derived from real `userInfo.id` matched against
 * `crewDetail.adminUserId` and the `crewMembers` list. The
 * "finance" branch is a *transitional* hook — until backend ships a
 * real role field, anyone whose userId is in `MOCK_FINANCE_USER_IDS`
 * is treated as finance. Swap to a real check (`crewMember.isFinance`
 * or similar) once the field exists.
 */

"use client";

import { useUserInfo } from "@/src/hooks/use-user";
import { useCrewDetail, useCrewMembers } from "./use-crew";
import { useDevIdentity } from "./use-dev-identity";
import { MOCK_FINANCE_USER_IDS } from "./episode-mock";

export type CrewRole = "admin" | "finance" | "member" | "outsider";

export interface UserCrewRole {
  /** Discriminated role, used to gate UI surfaces. */
  role: CrewRole;
  /** Effective userId for action attribution — accounts for dev
   *  impersonation. `undefined` for outsiders. */
  effectiveUserId?: number;
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

  const realUserId = userInfo?.id != null ? Number(userInfo.id) : undefined;
  const realIsAdmin =
    realUserId != null && crewDetail?.adminUserId != null && crewDetail.adminUserId === realUserId;
  const realMember =
    realUserId != null ? crewMembers.find((m) => m.userId === realUserId) : undefined;

  // Dev mode overrides take effect only when the switcher is mounted
  // (NODE_ENV !== 'production'). The switcher already hides itself in
  // production builds, but the underlying store may still hold a value
  // — guard here too so prod isn't accidentally lying.
  if (process.env.NODE_ENV !== "production") {
    if (devIdentity.kind === "owner") {
      return {
        role: "admin",
        effectiveUserId: crewDetail?.adminUserId ?? realUserId,
        effectiveName: userInfo?.nickName || userInfo?.userName || "Owner",
        isAdmin: true,
        isFinance: false,
        isMember: false,
      };
    }
    if (devIdentity.kind === "finance") {
      return {
        role: "finance",
        // Pin to the mock finance id so revenue actions credit a
        // recognizable actor in the activity log.
        effectiveUserId: [...MOCK_FINANCE_USER_IDS][0] ?? 9001,
        effectiveName: "Finance",
        isAdmin: false,
        isFinance: true,
        isMember: false,
      };
    }
    if (devIdentity.kind === "member") {
      const target = crewMembers.find(
        (m) => (m.nick?.trim() || `User ${m.userId}`) === devIdentity.name
      );
      if (target) {
        return {
          role: "member",
          effectiveUserId: target.userId,
          effectiveName: target.nick?.trim() || `User ${target.userId}`,
          isAdmin: false,
          isFinance: false,
          isMember: true,
        };
      }
      // Fall through to outsider if the named member isn't in the
      // list (renamed / removed since the switcher was opened).
    }
    if (devIdentity.kind === "visitor") {
      return { role: "outsider", isAdmin: false, isFinance: false, isMember: false };
    }
  }

  // Production resolution
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
  if (realUserId != null && MOCK_FINANCE_USER_IDS.has(realUserId)) {
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
      effectiveName: realMember.nick?.trim() || userInfo?.nickName || `User ${realMember.userId}`,
      isAdmin: false,
      isFinance: false,
      isMember: true,
    };
  }
  return { role: "outsider", isAdmin: false, isFinance: false, isMember: false };
}
