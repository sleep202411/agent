"use client";

/**
 * Members tab content — owner card on top + member grid below.
 *
 * Owner spans full width as a "founder" card (brand-tinted, no remove
 * action). Remaining members lay out in a responsive 1/2/3 column grid
 * ordered by joinedAt (earliest first — by-the-book "who joined first"
 * roster ordering).
 */

import { useMemo, useState } from "react";
import { IconLoader2, IconUserPlus, IconUsers } from "@tabler/icons-react";
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
  useRemoveMember,
  type CrewMemberDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { MemberCard } from "./member-card";

interface MembersGridProps {
  crewId: string;
  members: CrewMemberDTO[];
  isOwner: boolean;
  loading: boolean;
  onInvite: () => void;
}

export function MembersGrid({ crewId, members, isOwner, loading, onInvite }: MembersGridProps) {
  const t = useTranslations("workspace");
  const tc = useTranslationsCommon("common");
  const removeMember = useRemoveMember(crewId);
  const [pendingRemove, setPendingRemove] = useState<{ memberId: string; name: string } | null>(
    null
  );

  // Founder always at the top; rest by join order (oldest first).
  const sorted = useMemo(() => {
    const founder = members.find((m) => m.via === "founder");
    const others = members
      .filter((m) => m.via !== "founder")
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    return { founder: founder ?? null, others };
  }, [members]);

  // One batch resolve per grid render — cards receive the map by prop
  // (cards mounting individually would each fire their own lookup,
  // defeating the batching). React Query keys by the sorted id list,
  // so two grids on the same crew share the cache row.
  const memberIds = useMemo(() => members.map((m) => m.userId), [members]);
  const displays = useUserDisplays(memberIds);

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
        {isOwner ? (
          <Button variant="soft" color="primary" size="sm" onClick={onInvite}>
            <IconUserPlus className="size-3.5" /> {t("inviteMember")}
          </Button>
        ) : null}
      </div>

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
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

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
