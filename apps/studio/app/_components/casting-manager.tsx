"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconCopy, IconMask, IconTrash, IconUserPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
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

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

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
  const { user } = useAuth();
  const viewerId = user?.id == null ? "" : String(user.id);
  return (
    <CastingManagerContent
      key={JSON.stringify([viewerId, projectId, canManage])}
      viewerId={viewerId}
      projectId={projectId}
      canManage={canManage}
    />
  );
}

function CastingManagerContent({
  viewerId,
  projectId,
  canManage,
}: {
  viewerId: string;
  projectId: string;
  canManage: boolean;
}) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"user" | "contact">("user");
  const [value, setValue] = useState("");
  const [created, setCreated] = useState<CreatedCastingInvite | null>(null);

  const invitesKey = ["casting-invites", projectId, viewerId] as const;
  const query = useQuery({
    queryKey: invitesKey,
    queryFn: ({ signal }) => listCastingInvites(projectId, signal),
    enabled: Boolean(viewerId) && canManage,
    retry: false,
  });
  const denied = query.error instanceof ApiRequestError && [401, 403].includes(query.error.status);
  const invites = denied ? undefined : query.data;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: invitesKey });
  const mounted = useRef(false);
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, []);
  function runAction<R>(
    execute: (signal: AbortSignal) => Promise<R>,
    success: (result: R, current: () => boolean) => void | Promise<void>,
    failure: string
  ) {
    if (!mounted.current || !viewerId || !canManage || denied || active.current) return;
    const claim = new AbortController();
    active.current = claim;
    setPending(true);
    const current = () => mounted.current && active.current === claim;
    void (async () => {
      try {
        const result = await execute(claim.signal);
        if (current()) await success(result, current);
      } catch (error) {
        if (current()) toast.error(errMsg(error, failure));
      } finally {
        if (current()) {
          active.current = null;
          setPending(false);
        }
      }
    })();
  }
  const createInvite = () =>
    runAction(
      (signal) =>
        createCastingInvite(
          projectId,
          mode === "user" ? { inviteeUserId: value.trim() } : { inviteeContact: value.trim() },
          signal
        ),
      async (invite, current) => {
        setValue("");
        setCreated(invite);
        void invalidate();
        const copied = await copyToClipboard(castingAcceptUrl(invite.token));
        if (current())
          toast.success(copied ? t("castingLinkCreatedCopied") : t("castingLinkCreated"));
      },
      t("castingCreateFailed")
    );
  const revokeInvite = (id: string) =>
    runAction(
      (signal) => revokeCastingInvite(projectId, id, signal),
      () => {
        if (created?.id === id) setCreated(null);
        void invalidate();
        toast.success(t("castingRevoked"));
      },
      t("castingRevokeFailed")
    );
  const copyInvite = () => {
    if (!created) return;
    runAction(
      () => copyToClipboard(castingAcceptUrl(created.token)),
      (ok) => {
        if (ok) toast.success(tc("copied"));
        else toast.error(t("castingCopyFailed"));
      },
      t("castingCopyFailed")
    );
  };
  if (!canManage || !viewerId) return null;

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
            disabled={pending || denied}
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
          if (value.trim()) createInvite();
        }}
      >
        <Input
          placeholder={
            mode === "user" ? t("castingUserPlaceholder") : t("castingContactPlaceholder")
          }
          disabled={pending || denied}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={!value.trim() || pending || denied}>
          <IconUserPlus className="size-4" />
          {t("castingInvite")}
        </Button>
      </form>

      {created && !denied && (
        <div className="flex items-center gap-2 rounded-lg bg-input/30 px-2.5 py-1.5">
          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {castingAcceptUrl(created.token)}
          </code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={copyInvite}
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
                  disabled={pending || denied}
                  onClick={() => revokeInvite(invite.id)}
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
