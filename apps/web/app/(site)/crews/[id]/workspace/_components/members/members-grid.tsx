"use client";
import { ProjectAccountability } from "@/app/(site)/crews/_components/accountability/project-accountability";

/**
 * Members tab content. Ownership, production positions and access policies
 * are independent concerns; each action is gated by its atomic permission.
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
import { SwitchControl } from "@/components/ui/schema-field/switch-control";
import { UserAvatar } from "@/components/user-avatar";
import { MemberCard } from "./member-card";
import { CrewAgreementsDialog } from "./crew-agreements-dialog";

interface MembersGridProps {
  crewId: string;
  members: CrewMemberDTO[];
  canInvite: boolean;
  canManageMembers: boolean;
  canManagePermissions: boolean;
  canTransferOwnership: boolean;
  canManageAgreements: boolean;
  loading: boolean;
  onInvite: () => void;
  initialAgreementId?: string | null;
  onAgreementsClose?: () => void;
}

export function MembersGrid({
  crewId,
  members,
  canInvite,
  canManageMembers,
  canManagePermissions,
  canTransferOwnership,
  canManageAgreements,
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
  const invitations = useCrewInvitations(crewId, canInvite);
  const revokeInvitation = useRevokeCrewInvitation(crewId);
  const [pendingRemove, setPendingRemove] = useState<{ memberId: string; name: string } | null>(
    null
  );
  const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; name: string } | null>(
    null
  );
  // Whether the outgoing owner leaves the crew after handing off (default:
  // stay on as a normal member).
  const [transferLeave, setTransferLeave] = useState(false);
  const [agreementsOpen, setAgreementsOpen] = useState(() => Boolean(initialAgreementId));

  // A notification can add ?agreement= while the member tab is already
  // mounted. Open on that transition as well as on the initial mount, while
  // scheduling outside the effect body to avoid a cascading render.
  useEffect(() => {
    if (!initialAgreementId) return;
    let current = true;
    queueMicrotask(() => {
      if (current) setAgreementsOpen(true);
    });
    return () => {
      current = false;
    };
  }, [initialAgreementId]);

  // The current owner always leads the roster; everyone else follows join
  // order. Ownership is a dedicated relation and can be transferred.
  const sortedMembers = useMemo(() => {
    const owner = members.find((member) => member.isOwner);
    const others = members
      .filter((member) => !member.isOwner)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    return owner ? [owner, ...others] : others;
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
    <div className="space-y-5">
      <ProjectAccountability crewId={crewId} members={members} />
      {/* This is a toolbar, not a second page title: the workspace header
          already establishes "Member management" above the scroll pane. */}
      <section className="flex flex-col gap-4 rounded-xl bg-white/[0.025] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <IconUsers className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-sm font-semibold text-[#eceef2]">
                {t("memberActiveCount", { count: members.length })}
              </h2>
              {canInvite && !invitations.isLoading && !invitations.isError ? (
                <span className="rounded-full bg-white/[0.055] px-2 py-0.5 text-[10px] font-medium text-[#858b95]">
                  {t("memberPendingCount", { count: invitations.total })}
                </span>
              ) : null}
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-4 text-[#747a84]">
              {t("memberRosterDescription")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
          <Button
            variant="ghost"
            color="muted"
            size="sm"
            onClick={() => setAgreementsOpen(true)}
            icon={<IconSignature />}
          >
            {ta("title")}
          </Button>
          {canInvite ? (
            <Button variant="solid" color="primary" size="sm" onClick={onInvite}>
              <IconUserPlus className="size-3.5" /> {t("inviteMember")}
            </Button>
          ) : null}
        </div>
      </section>

      {canInvite && (invitations.isLoading || invitations.isError || invitations.total > 0) ? (
        <section className="overflow-hidden rounded-xl bg-[#111318]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
            <IconClock className="size-4 text-white/45" />
            <h3 className="text-xs font-semibold text-white/75">
              {t("pendingInvitations")} · {invitations.total}
            </h3>
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
                    className="flex min-h-[68px] items-center justify-between gap-4 px-4 py-3 sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar
                        src={displays.get(invitation.inviteeUserId)?.avatar}
                        name={displayNameOf(invitation.inviteeUserId, displays)}
                        seed={invitation.inviteeUserId}
                        size={34}
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white/80">
                          {displayNameOf(invitation.inviteeUserId, displays)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/38">
                          {[
                            t("memberRoleMember"),
                            ...invitation.policyKeys.map((policyKey) =>
                              policyKey === "admin"
                                ? t("memberAdminBadge")
                                : t("memberFinanceBadge")
                            ),
                          ].join(" + ")}{" "}
                          ·{" "}
                          {t("invitationExpires", {
                            date: new Intl.DateTimeFormat(undefined, {
                              month: "short",
                              day: "numeric",
                            }).format(new Date(invitation.expiresAt)),
                          })}
                        </p>
                      </div>
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
        <EmptyState onInvite={onInvite} isOwner={canInvite} t={t} />
      ) : (
        <section className="overflow-hidden rounded-xl bg-[#111318]">
          <div className="hidden grid-cols-[minmax(240px,1.35fr)_minmax(160px,0.8fr)_minmax(150px,0.7fr)_minmax(180px,auto)] items-center gap-5 border-b border-white/[0.06] px-5 py-2.5 text-[10px] font-medium tracking-[0.08em] text-[#626873] uppercase md:grid">
            <span>{t("memberColumnIdentity")}</span>
            <span>{t("memberColumnRole")}</span>
            <span>{t("memberColumnJoined")}</span>
            <span className="text-right">{t("memberColumnActions")}</span>
          </div>
          <div className="divide-y divide-white/[0.055]">
            {sortedMembers.map((member) => {
              return (
                <MemberCard
                  key={member.id}
                  crewId={crewId}
                  member={member}
                  displays={displays}
                  canManage={canManageMembers}
                  canManagePermissions={canManagePermissions}
                  canTransferOwnership={canTransferOwnership}
                  onAskRemove={(memberId, name) => setPendingRemove({ memberId, name })}
                  onAskTransfer={(userId, name) => {
                    setTransferLeave(false);
                    setPendingTransfer({ userId, name });
                  }}
                />
              );
            })}
          </div>
        </section>
      )}

      <CrewAgreementsDialog
        crewId={crewId}
        members={members}
        isOwner={canManageAgreements}
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
