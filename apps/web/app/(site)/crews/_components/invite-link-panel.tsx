"use client";

/**
 * The "anyone with the link" half of inviting.
 *
 * Access is chosen before the link is minted, never after: a link that could be
 * upgraded later would silently widen what everyone who already holds it can
 * do. Both bounds default to open (no expiry, no cap) because that is what a
 * crew posting a link into a group chat actually wants — revoke is the control
 * that matters, and it is one click away in the list below.
 *
 * The raw token is rendered exactly once, right after creation. Nothing can
 * read it back, so the copy affordance is the whole point of that moment.
 */

import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { toast } from "sonner";
import { IconCopy, IconLink, IconLoader2, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  crewInviteUrl,
  useCreateCrewInviteLink,
  useCrewInviteLinkPages,
  useRevokeCrewInviteLink,
  type CrewInviteLinkDTO,
} from "@/app/(site)/crews/_hooks/use-invite-links";
import {
  isCrewInviteAccessPreset,
  policyKeysForAccessPreset,
  type CrewInviteAccessPreset,
} from "@/app/(site)/crews/_lib/member-access-preset";

type ExpiryChoice = "never" | "7" | "30";
type UsesChoice = "unlimited" | "5" | "25";

interface InviteLinkPanelProps {
  crewId: string;
  canGrantPolicies: boolean;
  open: boolean;
  task?: { id: string; version: number; title: string };
}

export function InviteLinkPanel(props: InviteLinkPanelProps) {
  const { user } = useCurrentUser();
  if (!props.open || !user) return null;
  return (
    <InviteLinkSession
      key={`${props.crewId}:${user.id}:${props.task?.id ?? ""}:${props.task?.version ?? ""}`}
      {...props}
    />
  );
}

function InviteLinkSession({ crewId, canGrantPolicies, open, task }: InviteLinkPanelProps) {
  const active = useRef(true);
  const createPending = useRef(false);
  const revokePending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const t = useTranslations("workspace");
  const commonT = useTranslations("common");

  const [accessPreset, setAccessPreset] = useState<CrewInviteAccessPreset>("standard");
  const [expiry, setExpiry] = useState<ExpiryChoice>("never");
  const [uses, setUses] = useState<UsesChoice>("unlimited");
  const [freshLink, setFreshLink] = useState<{ id: string; url: string } | null>(null);
  const freshUrl = freshLink?.url;

  const links = useCrewInviteLinkPages(crewId, open, task?.id);
  const { mutateAsync: createLink, isPending: creating } = useCreateCrewInviteLink(crewId);
  const { mutateAsync: revokeLink, isPending: revoking } = useRevokeCrewInviteLink(crewId);

  const visibleLinks = links.data?.filter((link) =>
    task ? link.taskId === task.id : !link.taskId
  );

  const handleCreate = async () => {
    if (!active.current || createPending.current) return;
    createPending.current = true;
    try {
      const created = await createLink({
        policyKeys: !task && canGrantPolicies ? policyKeysForAccessPreset(accessPreset) : [],
        ...(task ? { taskId: task.id, taskVersion: task.version, maxUses: 1 } : {}),
        ...(expiry === "never" ? {} : { expiresInDays: Number(expiry) }),
        ...(!task && uses !== "unlimited" ? { maxUses: Number(uses) } : {}),
      });
      if (!active.current) return;
      const url = crewInviteUrl(created.token);
      setFreshLink({ id: created.id, url });
      await copy(url);
    } catch (err) {
      if (active.current) toast.error(err instanceof Error ? err.message : t("addMemberFailed"));
    } finally {
      createPending.current = false;
    }
  };

  const copy = async (url: string) => {
    if (!active.current) return;
    try {
      await navigator.clipboard.writeText(url);
      if (active.current) toast.success(t("inviteLinkCopied"));
    } catch {
      // A denied clipboard is not a failed link — the URL is on screen and
      // selectable, so say what to do instead of reporting an error.
      if (active.current) toast.message(t("inviteLinkCopyFailed"));
    }
  };

  const handleRevoke = async (link: CrewInviteLinkDTO) => {
    if (!active.current || revokePending.current) return;
    revokePending.current = true;
    try {
      await revokeLink(link.id);
      if (active.current) {
        setFreshLink((current) => (current?.id === link.id ? null : current));
        toast.success(t("inviteLinkRevoked"));
      }
    } catch (err) {
      if (active.current) toast.error(err instanceof Error ? err.message : t("addMemberFailed"));
    } finally {
      revokePending.current = false;
    }
  };

  return (
    <FieldGroup>
      <p className="text-[11px] leading-5 text-muted-foreground">
        {task ? t("taskInviteIntro", { task: task.title }) : t("inviteLinkIntro")}
      </p>

      {canGrantPolicies && !task ? (
        <Field>
          <FieldLabel>{t("addMemberAccessLabel")}</FieldLabel>
          <Select
            value={accessPreset}
            onValueChange={(value) => {
              if (isCrewInviteAccessPreset(value)) setAccessPreset(value);
            }}
            disabled={creating}
          >
            <SelectTrigger className="h-10 w-full rounded-lg px-3 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="standard">{t("memberAccessPresetStandard")}</SelectItem>
              <SelectItem value="finance">{t("memberAccessPresetFinance")}</SelectItem>
              <SelectItem value="admin">{t("memberAccessPresetAdmin")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>{t("inviteLinkExpiryLabel")}</FieldLabel>
          <Select
            value={expiry}
            onValueChange={(v) => setExpiry(v as ExpiryChoice)}
            disabled={creating}
          >
            <SelectTrigger className="h-10 w-full rounded-lg px-3 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="never">{t("inviteLinkExpiryNever")}</SelectItem>
              <SelectItem value="7">{t("inviteLinkExpiryDays", { days: 7 })}</SelectItem>
              <SelectItem value="30">{t("inviteLinkExpiryDays", { days: 30 })}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {!task ? (
          <Field>
            <FieldLabel>{t("inviteLinkUsesLabel")}</FieldLabel>
            <Select
              value={uses}
              onValueChange={(v) => setUses(v as UsesChoice)}
              disabled={creating}
            >
              <SelectTrigger className="h-10 w-full rounded-lg px-3 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="unlimited">{t("inviteLinkUsesUnlimited")}</SelectItem>
                <SelectItem value="5">{t("inviteLinkUsesLimited", { count: 5 })}</SelectItem>
                <SelectItem value="25">{t("inviteLinkUsesLimited", { count: 25 })}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </div>

      <Button type="button" onClick={() => void handleCreate()} disabled={creating}>
        {creating ? (
          <IconLoader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <IconLink className="mr-2 size-4" />
        )}
        {t("inviteLinkCreate")}
      </Button>

      {freshUrl ? (
        <div className="rounded-xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08]">
          <p className="m-0 mb-2 text-xs font-medium text-foreground">{t("inviteLinkCreated")}</p>
          <div className="flex items-center gap-2">
            <Input readOnly value={freshUrl} onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => void copy(freshUrl)}
              aria-label={t("inviteLinkCopy")}
            >
              <IconCopy className="size-4" />
            </Button>
          </div>
          <p className="m-0 mt-2 text-[11px] leading-5 text-muted-foreground">
            {t("inviteLinkTokenOnceHint")}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-foreground">{t("inviteLinkActive")}</span>
        {links.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">{links.error?.message || commonT("loadFailed")}</p>
            <Button
              type="button"
              variant="outline"
              color="muted"
              disabled={links.isFetching}
              onClick={() => void links.refetch()}
            >
              {commonT("retry")}
            </Button>
          </div>
        ) : null}
        {links.isLoading ? (
          <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (visibleLinks?.length ?? 0) === 0 ? (
          !links.isError ? (
            <p className="m-0 text-[11px] leading-5 text-muted-foreground">{t("inviteLinkNone")}</p>
          ) : null
        ) : (
          visibleLinks?.map((link) => (
            <div
              key={link.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-white/[0.06]"
            >
              <div className="min-w-0">
                <p className="m-0 text-xs font-medium text-foreground">
                  {t(
                    link.kind === "community" ? "inviteLinkKindCommunity" : "inviteLinkKindMember"
                  )}
                </p>
                <p className="m-0 truncate text-xs text-foreground">
                  {link.maxUses === null
                    ? t("inviteLinkUsageSummary", { used: link.useCount })
                    : t("inviteLinkUsageOfLimit", {
                        used: link.useCount,
                        limit: link.maxUses,
                      })}
                  {link.state === "expired" ? ` · ${t("inviteLinkStateExpired")}` : null}
                  {link.state === "exhausted" ? ` · ${t("inviteLinkStateExhausted")}` : null}
                </p>
                <p className="m-0 text-[11px] leading-5 text-muted-foreground">
                  {link.expiresAt
                    ? t("inviteLinkExpiresAt", {
                        date: new Date(link.expiresAt).toLocaleDateString(),
                      })
                    : t("inviteLinkNeverExpires")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                color="muted"
                disabled={revoking}
                onClick={() => void handleRevoke(link)}
                aria-label={t("inviteLinkRevoke")}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ))
        )}
        {links.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            color="muted"
            disabled={links.isFetching}
            onClick={() => void links.fetchNextPage()}
          >
            {commonT("loadMore")}
          </Button>
        ) : null}
      </div>
    </FieldGroup>
  );
}
