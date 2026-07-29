"use client";

/**
 * Members tab content — owner card on top + member grid below.
 *
 * Owner spans full width as a "founder" card (brand-tinted, no remove
 * action). Remaining members lay out in a responsive 1/2/3 column grid
 * ordered by joinedAt (earliest first — by-the-book "who joined first"
 * roster ordering).
 */

import { useEffect, useMemo, useState } from "react";
import {
  IconClock,
  IconSignature,
  IconLoader2,
  IconUserPlus,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslations as useTranslationsCommon } from "@/src/i18n/i18n";
import {
  CrewApiError,
  useCrewInvitations,
  useRemoveMember,
  useRevokeCrewInvitation,
  useTransferCrewOwner,
  type CrewMemberDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import { SwitchControl } from "@/components/ui/schema-field/switch-control";
import { MemberCard } from "./member-card";
import { CrewAgreementsDialog } from "./crew-agreements-dialog";

interface MembersGridProps {
  crewId: string;
  members: CrewMemberDTO[];
  isOwner: boolean;
  loading: boolean;
  onInvite: () => void;
  initialAgreementId?: string | null;
  onAgreementsClose?: () => void;
}

export function MembersGrid({
  crewId,
  members,
  isOwner,
  loading,
  onInvite,
  initialAgreementId,
  onAgreementsClose,
}: MembersGridProps) {
  const t = useTranslations("workspace");
  const ta = useTranslations("crewAgreements");
  const tc = useTranslationsCommon("common");
  const removeMember = useRemoveMember(crewId);
  const transferOwner = useTransferCrewOwner(crewId);
  const invitations = useCrewInvitations(crewId, isOwner);
  const revokeInvitation = useRevokeCrewInvitation(crewId);
  const translateRole = useTranslatePositionValue();
  const [pendingRemove, setPendingRemove] = useState<{ memberId: string; name: string } | null>(
    null
  );
  const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; name: string } | null>(
    null
  );
  // Whether the outgoing owner leaves the crew after handing off (default:
  // stay on as a normal member).
  const [transferLeave, setTransferLeave] = useState(false);
  const [agreementsOpen, setAgreementsOpen] = useState(false);

  useEffect(() => {
    if (initialAgreementId) setAgreementsOpen(true);
  }, [initialAgreementId]);

  // Founder always at the top; rest by join order (oldest first).
  const sorted = useMemo(() => {
    const founder = members.find((m) => m.roleType === "owner");
    const others = members
      .filter((m) => m.roleType !== "owner")
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    return { founder: founder ?? null, others };
  }, [members]);

  // One batch resolve per grid render — cards receive the map by prop
  // (cards mounting individually would each fire their own lookup,
  // defeating the batching). React Query keys by the sorted id list,
  // so two grids on the same crew share the cache row.
  const pendingInvitations = useMemo(() => invitations.data, [invitations.data]);
  const memberIds = useMemo(
    () => [...members.map((m) => m.userId), ...pendingInvitations.map((i) => i.inviteeUserId)],
    [members, pendingInvitations]
  );
  const displays = useUserDisplays(memberIds);

  const handleTransfer = () => {
    if (!pendingTransfer) return;
    const { userId, name } = pendingTransfer;
    transferOwner.mutate(
      { toUserId: userId, removeOldOwner: transferLeave },
      {
        onSuccess: () => {
          toast.success(t("transferOwnerSuccess", { name }));
          setPendingTransfer(null);
          setTransferLeave(false);
        },
        onError: (err) => {
          if (err instanceof CrewApiError) {
            const detail =
              typeof err.body === "object" && err.body && "message" in err.body
                ? String((err.body as { message: unknown }).message)
                : err.message;
            toast.error(`HTTP ${err.status}`, { description: detail, duration: 8000 });
          } else {
            toast.error(err instanceof Error ? err.message : t("transferOwnerFailed"));
          }
        },
      }
    );
  };

  const handleRemove = () => {
    if (!pendingRemove) return;
    const { memberId, name } = pendingRemove;
    removeMember.mutate(memberId, {
      onSuccess: () => {
        toast.success(t("removeMemberSuccess", { name }));
        setPendingRemove(null);
      },
      onError: (err) => {
        if (err instanceof CrewApiError) {
          const detail =
            typeof err.body === "object" && err.body && "message" in err.body
              ? String((err.body as { message: unknown }).message)
              : err.message;
          toast.error(`HTTP ${err.status}`, { description: detail, duration: 8000 });
        } else {
          toast.error(err instanceof Error ? err.message : t("removeMemberFailed"));
        }
        setPendingRemove(null);
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Header: count + invite CTA */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-foreground">
          <IconUsers className="size-4 text-primary" />
          {t("memberManagement")} · {members.length} {t("people")}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            color="muted"
            size="sm"
            onClick={() => setAgreementsOpen(true)}
            icon={<IconSignature />}
          >
            {ta("title")}
          </Button>
          {isOwner ? (
            <Button variant="soft" color="primary" size="sm" onClick={onInvite}>
              <IconUserPlus className="size-3.5" /> {t("inviteMember")}
            </Button>
          ) : null}
        </div>
      </div>

      {isOwner && (invitations.isLoading || invitations.isError || invitations.total > 0) ? (
        <section className="overflow-hidden rounded-xl bg-white/[0.025] ring-1 ring-white/[0.075]">
          <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
            <IconClock className="size-4 text-white/45" />
            <h4 className="text-xs font-semibold text-white/75">
              {t("pendingInvitations")} · {invitations.total}
            </h4>
          </div>
          {invitations.isLoading ? (
            <div className="flex h-14 items-center justify-center">
              <IconLoader2 className="size-4 animate-spin text-white/35" />
            </div>
          ) : invitations.isError ? (
            <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
              <p className="text-xs text-destructive">
                {invitations.error instanceof Error
                  ? invitations.error.message
                  : t("invitationRevokeFailed")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                color="muted"
                onClick={() => void invitations.refetch()}
              >
                {tc("retry")}
              </Button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-white/[0.06]">
                {pendingInvitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex min-h-14 items-center justify-between gap-4 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/80">
                        {displayNameOf(invitation.inviteeUserId, displays)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/38">
                        {translateRole(invitation.roleType)} ·{" "}
                        {t("invitationExpires", {
                          date: new Intl.DateTimeFormat(undefined, {
                            month: "short",
                            day: "numeric",
                          }).format(new Date(invitation.expiresAt)),
                        })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      color="muted"
                      disabled={
                        revokeInvitation.isPending && revokeInvitation.variables === invitation.id
                      }
                      onClick={() =>
                        revokeInvitation.mutate(invitation.id, {
                          onSuccess: () => toast.success(t("invitationRevoked")),
                          onError: (error) =>
                            toast.error(
                              error instanceof Error ? error.message : t("invitationRevokeFailed")
                            ),
                        })
                      }
                      icon={
                        revokeInvitation.isPending &&
                        revokeInvitation.variables === invitation.id ? (
                          <IconLoader2 className="animate-spin" />
                        ) : (
                          <IconX />
                        )
                      }
                    >
                      {t("revokeInvitation")}
                    </Button>
                  </div>
                ))}
              </div>
              {invitations.hasNextPage ? (
                <div className="border-t border-white/[0.06] px-4 py-2.5 text-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    color="muted"
                    disabled={invitations.isFetchingNextPage}
                    onClick={() => void invitations.fetchNextPage()}
                    icon={
                      invitations.isFetchingNextPage ? (
                        <IconLoader2 className="animate-spin" />
                      ) : undefined
                    }
                  >
                    {invitations.isFetchingNextPage ? tc("loading") : tc("loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* Body */}
      {loading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
        </div>
      ) : members.length === 0 ? (
        <EmptyState onInvite={onInvite} isOwner={isOwner} t={t} />
      ) : (
        <div className="space-y-4">
          {/* Founder card — single tile across the row */}
          {sorted.founder ? (
            <div className="grid grid-cols-1">
              <MemberCard
                crewId={crewId}
                member={sorted.founder}
                displays={displays}
                isOwner={isOwner}
                canManage={false}
                onAskRemove={() => undefined}
                onAskTransfer={() => undefined}
              />
            </div>
          ) : null}

          {/* Member grid */}
          {sorted.others.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sorted.others.map((m) => (
                <MemberCard
                  key={m.id}
                  crewId={crewId}
                  member={m}
                  displays={displays}
                  isOwner={isOwner}
                  canManage={isOwner}
                  onAskRemove={(memberId, name) => setPendingRemove({ memberId, name })}
                  onAskTransfer={(userId, name) => {
                    setTransferLeave(false);
                    setPendingTransfer({ userId, name });
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

      <CrewAgreementsDialog
        crewId={crewId}
        members={members}
        isOwner={isOwner}
        focusAgreementId={initialAgreementId}
        open={agreementsOpen}
        onOpenChange={(next) => {
          setAgreementsOpen(next);
          if (!next && initialAgreementId) onAgreementsClose?.();
        }}
      />

      {/* Remove confirmation */}
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(v) => {
          if (!v) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeMember")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove ? t("removeMemberConfirm", { name: pendingRemove.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              disabled={removeMember.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleRemove();
              }}
            >
              {removeMember.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transfer-ownership confirmation */}
      <AlertDialog
        open={pendingTransfer !== null}
        onOpenChange={(v) => {
          if (!v && !transferOwner.isPending) setPendingTransfer(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("transferOwner")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTransfer ? t("transferOwnerConfirm", { name: pendingTransfer.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm text-foreground">
            {t("transferOwnerLeaveLabel")}
            <SwitchControl
              value={transferLeave}
              onChange={setTransferLeave}
              disabled={transferOwner.isPending}
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transferOwner.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="primary"
              disabled={transferOwner.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleTransfer();
              }}
            >
              {transferOwner.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({
  onInvite,
  isOwner,
  t,
}: {
  onInvite: () => void;
  isOwner: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <IconUsers className="size-5" />
      </div>
      <p className="text-sm text-muted-foreground">{t("noMembersYet")}</p>
      {isOwner ? (
        <Button variant="soft" color="primary" size="sm" onClick={onInvite}>
          <IconUserPlus className="size-3.5" /> {t("inviteMember")}
        </Button>
      ) : null}
    </div>
  );
}
