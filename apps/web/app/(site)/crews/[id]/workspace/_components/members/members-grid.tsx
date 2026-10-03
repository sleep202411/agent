"use client";

import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

/**
 * Members tab content. Ownership, production positions and access policies
 * are independent concerns; each action is gated by its atomic permission.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IconClock,
  IconSignature,
  IconLoader2,
  IconUserPlus,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
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

export function MembersGrid(props: MembersGridProps) {
  const { user } = useCurrentUser();
  return <MembersGridSession key={JSON.stringify([user?.id, props.crewId])} {...props} />;
}

function MembersGridSession({
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
  const locale = useLocale();
  const tc = useTranslationsCommon("common");
  const invitations = useCrewInvitations(crewId, canInvite);
  const revokeInvitation = useRevokeCrewInvitation(crewId);
  const [pendingRemove, setPendingRemove] = useState<{ memberId: string; name: string } | null>(
    null
  );
  const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; name: string } | null>(
    null
  );
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

  const alive = useRef(false);
  const revoking = useRef(new Set<string>());
  const [pendingRevocations, setPendingRevocations] = useState<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const revoke = async (id: string) => {
    if (!alive.current || !canInvite || revoking.current.has(id)) return;
    revoking.current.add(id);
    setPendingRevocations(new Set(revoking.current));
    try {
      await revokeInvitation.mutateAsync(id);
      if (alive.current) toast.success(t("invitationRevoked"));
    } catch (error) {
      if (alive.current)
        toast.error(error instanceof Error ? error.message : t("invitationRevokeFailed"));
    } finally {
      if (alive.current) {
        revoking.current.delete(id);
        setPendingRevocations(new Set(revoking.current));
      }
    }
  };

  return (
    <div className="min-w-0 space-y-5">
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
          {invitations.isError ? (
            <div
              role="alert"
              className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"
            >
              <p className="text-xs text-destructive">
                {invitations.error instanceof Error ? invitations.error.message : tc("loadFailed")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                color="muted"
                disabled={invitations.isFetching}
                onClick={() =>
                  void (invitations.isFetchNextPageError &&
                  !isCrewCursorError(invitations.error, "CREW_INVITATION_CURSOR_INVALID")
                    ? invitations.fetchNextPage()
                    : invitations.refetch())
                }
              >
                {tc("retry")}
              </Button>
            </div>
          ) : null}
          {invitations.isLoading && pendingInvitations.length === 0 ? (
            <div className="flex h-14 items-center justify-center">
              <IconLoader2 className="size-4 animate-spin text-white/35" />
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
                            date: new Intl.DateTimeFormat(locale, {
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
                      disabled={pendingRevocations.has(invitation.id)}
                      onClick={() => void revoke(invitation.id)}
                      icon={
                        pendingRevocations.has(invitation.id) ? (
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
              {invitations.hasNextPage && !invitations.isError ? (
                <div className="border-t border-white/[0.06] px-4 py-2.5 text-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    color="muted"
                    disabled={invitations.isFetching}
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
                  onAskRemove={(memberId, name) => {
                    setPendingTransfer(null);
                    setPendingRemove({ memberId, name });
                  }}
                  onAskTransfer={(userId, name) => {
                    setPendingRemove(null);
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

      {pendingRemove ? (
        <MemberDecision
          key={`remove:${pendingRemove.memberId}`}
          crewId={crewId}
          kind="remove"
          id={pendingRemove.memberId}
          name={pendingRemove.name}
          allowed={canManageMembers}
          onClose={() => setPendingRemove(null)}
        />
      ) : pendingTransfer ? (
        <MemberDecision
          key={`transfer:${pendingTransfer.userId}`}
          crewId={crewId}
          kind="transfer"
          id={pendingTransfer.userId}
          name={pendingTransfer.name}
          allowed={canTransferOwnership}
          onClose={() => setPendingTransfer(null)}
        />
      ) : null}
    </div>
  );
}

export function MemberDecision({
  crewId,
  kind,
  id,
  name,
  allowed,
  onClose,
}: {
  crewId: string;
  kind: "remove" | "transfer";
  id: string;
  name: string;
  allowed: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("workspace");
  const tc = useTranslationsCommon("common");
  const remove = useRemoveMember(crewId);
  const transfer = useTransferCrewOwner(crewId);
  const [leave, setLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = () => {
    if (!alive.current || pending.current || !allowed) return;
    pending.current = true;
    setBusy(true);
    const handlers = {
      onSuccess: () => {
        if (!alive.current) return;
        toast.success(
          t(kind === "remove" ? "removeMemberSuccess" : "transferOwnerSuccess", { name })
        );
        onClose();
      },
      onError: (error: unknown) => {
        if (!alive.current) return;
        if (error instanceof CrewApiError) {
          toast.error(`HTTP ${error.status}`, { description: error.message, duration: 8000 });
        } else {
          toast.error(
            error instanceof Error
              ? error.message
              : t(kind === "remove" ? "removeMemberFailed" : "transferOwnerFailed")
          );
        }
      },
      onSettled: () => {
        if (!alive.current) return;
        pending.current = false;
        setBusy(false);
      },
    };
    if (kind === "remove") remove.mutate(id, handlers);
    else transfer.mutate({ toUserId: id, removeOldOwner: leave }, handlers);
  };
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending.current) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(kind === "remove" ? "removeMember" : "transferOwner")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(kind === "remove" ? "removeMemberConfirm" : "transferOwnerConfirm", { name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {kind === "transfer" ? (
          <label className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm text-foreground">
            {t("transferOwnerLeaveLabel")}
            <SwitchControl value={leave} onChange={setLeave} disabled={busy} />
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="solid"
            color={kind === "remove" ? "destructive" : "primary"}
            disabled={busy || !allowed}
            onClick={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {busy ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {tc("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
