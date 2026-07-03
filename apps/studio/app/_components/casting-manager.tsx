"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconCopy, IconMask, IconTrash, IconUserPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ApiRequestError } from "@/lib/api";
import {
  castingAcceptUrl,
  createCastingInvite,
  listCastingInvites,
  revokeCastingInvite,
  type CastingInviteDto,
  type CastingInviteStatus,
  type CreatedCastingInvite,
} from "@/lib/characters-api";

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiRequestError ? e.message : fallback;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const STATUS_TONE: Record<CastingInviteStatus, string> = {
  pending: "bg-white/[0.08] text-white/70",
  accepted: "bg-white/[0.08] text-white/80",
  declined: "bg-destructive/15 text-destructive",
  expired: "bg-white/[0.06] text-white/45",
  revoked: "bg-white/[0.06] text-white/45",
};

/**
 * Director casting UI (per-project) — invite a real person to lend their face
 * to this project WITHOUT joining it. Invite by FizzDragon username or by
 * email/phone; the one-time accept link is shown once to copy. Lists
 * pending/accepted/… invites with revoke. Project-editor-gated (server-enforced).
 */
export function CastingManager({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"user" | "contact">("user");
  const [value, setValue] = useState("");
  const [created, setCreated] = useState<CreatedCastingInvite | null>(null);

  const invitesKey = ["casting-invites", projectId] as const;
  const { data: invites } = useQuery({
    queryKey: invitesKey,
    queryFn: () => listCastingInvites(projectId),
    enabled: canManage,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: invitesKey });

  const createMut = useMutation({
    mutationFn: () =>
      createCastingInvite(
        projectId,
        mode === "user" ? { inviteeUserId: value.trim() } : { inviteeContact: value.trim() }
      ),
    onSuccess: async (invite) => {
      setValue("");
      setCreated(invite);
      void invalidate();
      const copied = await copyToClipboard(castingAcceptUrl(invite.token));
      toast.success(copied ? t("castingLinkCreatedCopied") : t("castingLinkCreated"));
    },
    onError: (e) => toast.error(errMsg(e, t("castingCreateFailed"))),
  });

  const revokeMut = useMutation({
    mutationFn: (inviteId: string) => revokeCastingInvite(projectId, inviteId),
    onSuccess: (_data, inviteId) => {
      if (created?.id === inviteId) setCreated(null);
      void invalidate();
      toast.success(t("castingRevoked"));
    },
    onError: (e) => toast.error(errMsg(e, t("castingRevokeFailed"))),
  });

  if (!canManage) return null;

  const statusLabels: Record<CastingInviteStatus, string> = {
    pending: t("castingStatusPending"),
    accepted: t("castingStatusAccepted"),
    declined: t("castingStatusDeclined"),
    expired: t("castingStatusExpired"),
    revoked: t("castingStatusRevoked"),
  };

  return (
    <div className="space-y-3 pt-1">
      <Separator />
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <IconMask className="size-4 text-muted-foreground" stroke={1.8} />
          {t("castingTitle")}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("castingHint")}</p>
      </div>

      {/* Invitee mode: a platform user vs an external email/phone. */}
      <div className="flex items-center gap-0.5 rounded-full bg-input/30 p-0.5">
        {(
          [
            { id: "user", label: t("castingByUser") },
            { id: "contact", label: t("castingByContact") },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              "h-7 flex-1 rounded-full text-xs font-medium transition-colors",
              mode === id ? "bg-white/[0.12] text-white" : "text-white/60 hover:text-white"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !createMut.isPending) createMut.mutate();
        }}
      >
        <Input
          placeholder={
            mode === "user" ? t("castingUserPlaceholder") : t("castingContactPlaceholder")
          }
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={!value.trim() || createMut.isPending}>
          <IconUserPlus className="size-4" />
          {t("castingInvite")}
        </Button>
      </form>

      {created && (
        <div className="flex items-center gap-2 rounded-lg bg-input/30 px-2.5 py-1.5">
          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {castingAcceptUrl(created.token)}
          </code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              const ok = await copyToClipboard(castingAcceptUrl(created.token));
              if (ok) toast.success(tc("copied"));
              else toast.error(t("castingCopyFailed"));
            }}
          >
            <IconCopy className="size-4" />
            {tc("copy")}
          </Button>
        </div>
      )}

      {invites && invites.length > 0 && (
        <div className="space-y-0.5">
          {invites.map((invite: CastingInviteDto) => (
            <div key={invite.id} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <IconMask className="size-4" stroke={1.8} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-foreground">
                  {invite.inviteeContact ?? invite.inviteeUserId ?? t("castingSomeone")}
                </span>
                <span className="text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      STATUS_TONE[invite.status]
                    )}
                  >
                    {statusLabels[invite.status]}
                  </span>
                </span>
              </div>
              {invite.status === "pending" && (
                <button
                  type="button"
                  onClick={() => revokeMut.mutate(invite.id)}
                  className="flex size-7 items-center justify-center rounded-md text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white"
                  aria-label={t("castingRevoke")}
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
