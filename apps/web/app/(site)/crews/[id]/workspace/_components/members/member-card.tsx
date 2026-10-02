"use client";

/**
 * One member rendered as a compact card.
 *
 * Owner card is visually distinct (single tile across the top with a
 * brand-tinted background). Ownership, production positions and access
 * policies are rendered independently so the UI never turns a job title into
 * an authorization role.
 *
 * Inline actions only — members don't carry enough info to warrant a
 * full drawer like positions do. Profile link navigates out for the
 * real "who is this person" view.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import Link from "next/link";
import { encodeUserId } from "@/src/lib/user-id-codec";
import {
  IconCalendar,
  IconCoin,
  IconCrown,
  IconExternalLink,
  IconLoader2,
  IconShield,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CrewApiError,
  useUpdateMember,
  type CrewMemberDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import { displayNameOf } from "@/app/(site)/crews/_hooks/use-users";
import {
  accessPresetForPolicyKeys,
  isCrewAccessPreset,
  policyKeysForAccessPreset,
} from "@/app/(site)/crews/_lib/member-access-preset";
import type { LookupUserDTO } from "@repo/shared/users";

interface MemberCardProps {
  crewId: string;
  member: CrewMemberDTO;
  /** Display info batched by the parent grid — see MembersGrid. The
   *  map may be empty (lookup in flight or failed); fallback is
   *  "User <id>". */
  displays: Map<string, LookupUserDTO>;
  /** Members with members.manage can remove non-owners. */
  canManage: boolean;
  /** Owner-only structural permission editor. */
  canManagePermissions: boolean;
  /** Owner-only ownership transfer. */
  canTransferOwnership: boolean;
  onAskRemove: (memberId: string, name: string) => void;
  /** Owner-only: hand crew ownership to this member. */
  onAskTransfer: (userId: string, name: string) => void;
}

export function MemberCard(props: MemberCardProps) {
  const { user } = useCurrentUser();
  return (
    <MemberCardSession key={JSON.stringify([user?.id, props.crewId, props.member.id])} {...props} />
  );
}

function MemberCardSession({
  crewId,
  member,
  displays,
  canManage,
  canManagePermissions,
  canTransferOwnership,
  onAskRemove,
  onAskTransfer,
}: MemberCardProps) {
  const locale = useLocale();
  const t = useTranslations("workspace");
  const translatePosition = useTranslatePositionValue();
  const updateMember = useUpdateMember(crewId);
  const alive = useRef(false);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const isCrewOwner = member.isOwner;
  const lookup = displays.get(member.userId);
  const displayName = displayNameOf(member.userId, displays);
  const primaryPosition =
    member.positions.find((position) => position.isPrimary) ?? member.positions[0];
  const positionLabel =
    primaryPosition?.title ||
    (primaryPosition?.categoryKey
      ? translatePosition(primaryPosition.categoryKey)
      : t("memberRoleMember"));
  const viaLabel =
    member.joinedVia === "creation"
      ? null
      : member.joinedVia === "application"
        ? t("memberViaApplication")
        : member.joinedVia === "invitation"
          ? t("memberViaInvitation")
          : t("memberViaOwnershipTransfer");

  const accessPreset = accessPresetForPolicyKeys(member.policyKeys);

  const handleAccessPresetChange = (value: string) => {
    if (
      !alive.current ||
      pending.current ||
      !canManagePermissions ||
      isCrewOwner ||
      !isCrewAccessPreset(value) ||
      value === accessPreset
    )
      return;
    pending.current = true;
    setSaving(true);
    const policyKeys = policyKeysForAccessPreset(value);
    updateMember.mutate(
      {
        memberId: member.id,
        input: { policyKeys, expectedVersion: member.version },
      },
      {
        onSuccess: () => {
          if (alive.current) toast.success(t("memberAccessUpdated"));
        },
        onError: (err) => {
          if (alive.current) surfaceErr(err, t("memberAccessUpdateFailed"));
        },
        onSettled: () => {
          if (!alive.current) return;
          pending.current = false;
          setSaving(false);
        },
      }
    );
  };

  return (
    <article
      className={cn(
        "group relative grid min-h-[82px] grid-cols-1 gap-3 px-4 py-3.5 transition-colors sm:px-5 md:grid-cols-[minmax(220px,1.25fr)_minmax(145px,0.75fr)_minmax(140px,0.65fr)_minmax(270px,auto)] md:items-center md:gap-4",
        isCrewOwner ? "bg-primary/[0.025]" : "hover:bg-white/[0.018]"
      )}
    >
      {/* Identity */}
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar
          src={lookup?.avatar}
          name={displayName}
          seed={member.userId}
          size={42}
          className={cn("shrink-0 ring-1 ring-white/[0.09]", isCrewOwner && "ring-primary/25")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="w-full min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
              {displayName}
            </span>
            {isCrewOwner ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <IconCrown className="size-2.5" />
                {t("memberRoleOwner")}
              </span>
            ) : null}
            {member.policyKeys.includes("admin") ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-white/75">
                <IconShield className="size-2.5" />
                {t("memberAdminBadge")}
              </span>
            ) : null}
            {member.policyKeys.includes("finance") ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                <IconCoin className="size-2.5" />
                {t("memberFinanceBadge")}
              </span>
            ) : null}
          </div>
          {viaLabel ? (
            <p className="mt-0.5 truncate text-[11px] text-[#6f7580]">{viaLabel}</p>
          ) : null}
        </div>
      </div>

      {/* Role and access */}
      <div className="min-w-0 pl-[54px] md:pl-0">
        <p className="truncate text-xs font-medium text-[#cfd2d8]">{positionLabel}</p>
        <p className="mt-0.5 text-[10px] text-[#676d77]">
          {isCrewOwner
            ? t("memberOwnerAccess")
            : member.policyKeys.length > 0
              ? member.policyKeys.map((key) => t(`memberPolicy_${key}`)).join(" · ")
              : t("memberStandardAccess")}
        </p>
      </div>

      {/* Joined */}
      <div className="flex items-center gap-1.5 pl-[54px] text-[11px] text-[#777d87] md:pl-0">
        <IconCalendar className="size-3.5 shrink-0 text-[#5f6570]" />
        <span className="truncate">
          {t("memberJoinedAgo", { date: relativeDate(member.joinedAt, t) })}
        </span>
      </div>

      {/* Actions */}
      <div className="flex min-w-0 items-center justify-end gap-1.5 pl-[54px] md:pl-0">
        <Link
          href={`/${locale}/creators/${encodeUserId(member.userId)}`}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-[#aeb3bc] transition-colors hover:bg-white/[0.055] hover:text-white"
        >
          {t("memberViewProfile")}
          <IconExternalLink className="size-3" />
        </Link>
        {!isCrewOwner && (canManage || canManagePermissions || canTransferOwnership) ? (
          <>
            <div className="mx-0.5 h-4 w-px bg-white/[0.07]" aria-hidden="true" />
            {canManagePermissions ? (
              <Select
                value={accessPreset}
                onValueChange={handleAccessPresetChange}
                disabled={saving}
              >
                <SelectTrigger
                  size="sm"
                  className="w-[132px] border-white/[0.08] bg-white/[0.025]"
                  aria-label={t("addMemberAccessLabel")}
                  title={t("addMemberAccessLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectItem value="standard">{t("memberAccessPresetStandard")}</SelectItem>
                  <SelectItem value="finance">{t("memberAccessPresetFinance")}</SelectItem>
                  <SelectItem value="admin">{t("memberAccessPresetAdmin")}</SelectItem>
                  <SelectItem value="admin_finance">
                    {t("memberAccessPresetAdminFinance")}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {canTransferOwnership ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={saving}
                onClick={() => {
                  if (!pending.current) onAskTransfer(member.userId, displayName);
                }}
                aria-label={t("transferOwner")}
                title={t("transferOwner")}
              >
                <IconCrown className="size-3.5" />
              </Button>
            ) : null}
            {canManage ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                color="destructive"
                disabled={saving}
                onClick={() => {
                  if (!pending.current) onAskRemove(member.id, displayName);
                }}
                aria-label={t("removeMember")}
                title={t("removeMember")}
              >
                <IconTrash className="size-3.5" />
              </Button>
            ) : null}
          </>
        ) : isCrewOwner ? (
          <span className="ml-1 hidden text-[10px] text-[#5f6570] xl:inline">
            {t("memberOwnerProtected")}
          </span>
        ) : null}
      </div>

      {saving ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60">
          <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </article>
  );
}

function relativeDate(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diffDays = Math.floor((Date.now() - ts) / 86_400_000);
  if (diffDays < 1) return t("justNow");
  return t("daysAgo", { count: diffDays });
}

function surfaceErr(err: unknown, fallback: string) {
  if (err instanceof CrewApiError) {
    const detail =
      typeof err.body === "object" && err.body && "message" in err.body
        ? String((err.body as { message: unknown }).message)
        : err.message;
    toast.error(`HTTP ${err.status}`, { description: detail, duration: 8000 });
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}
