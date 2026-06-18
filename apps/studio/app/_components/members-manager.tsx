"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck,
  IconCopy,
  IconDotsVertical,
  IconLink,
  IconSearch,
  IconTrash,
  IconUserPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api";
import {
  addMember,
  createInvite,
  inviteUrl,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  updateMemberRole,
  type AssignableRole,
  type CreatedInvite,
  type ShareScope,
  type SharingMember,
} from "@/lib/collab/sharing-api";

const ROLES: AssignableRole[] = ["admin", "editor", "viewer"];
const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiRequestError ? e.message : fallback;

function expiryDays(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Member roster + management for a share scope (team workspace OR project).
 * Add by email/phone, search, change role, remove — admin-gated. Reused by the
 * team Settings/Members page and the per-project Share modal so the logic lives
 * once. Server is the source of truth; this only hides affordances.
 *
 * Layout/IA mirrors imagine.art's members panel (add row · search · roster
 * table); all color/styling follows the studio DESIGN.md (dark, zero-chroma,
 * no borders).
 */
export function MembersManager({ scope, canManage }: { scope: ShareScope; canManage: boolean }) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const roleLabel = (r: string) =>
    t(`roles.${r}` as "roles.admin" | "roles.editor" | "roles.viewer");
  const queryClient = useQueryClient();
  const membersKey = ["share-members", scope.kind, scope.id] as const;
  const { data: members, isLoading } = useQuery({
    queryKey: membersKey,
    queryFn: () => listMembers(scope),
  });

  const [account, setAccount] = useState("");
  const [role, setRole] = useState<AssignableRole>("editor");
  const [search, setSearch] = useState("");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: membersKey });

  const addMut = useMutation({
    mutationFn: () => addMember(scope, account.trim(), role),
    onSuccess: (m) => {
      setAccount("");
      void invalidate();
      toast.success(t("addedMember", { name: m.nickname ?? t("memberFallback") }));
    },
    onError: (e) => toast.error(errMsg(e, t("addMemberFailed"))),
  });
  const roleMut = useMutation({
    mutationFn: (v: { memberId: string; nextRole: AssignableRole }) =>
      updateMemberRole(scope, v.memberId, v.nextRole),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errMsg(e, t("changeRoleFailed"))),
  });
  const removeMut = useMutation({
    mutationFn: (memberId: string) => removeMember(scope, memberId),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errMsg(e, t("removeMemberFailed"))),
  });

  // ── Invite links ──────────────────────────────────────────────────────────
  const [linkRole, setLinkRole] = useState<AssignableRole>("editor");
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const invitesKey = ["share-invites", scope.kind, scope.id] as const;
  const { data: invites } = useQuery({
    queryKey: invitesKey,
    queryFn: () => listInvites(scope),
    enabled: canManage,
  });
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: invitesKey });

  const createLinkMut = useMutation({
    mutationFn: () => createInvite(scope, linkRole),
    onSuccess: async (inv) => {
      setCreated(inv);
      void invalidateInvites();
      const copied = await copyToClipboard(inviteUrl(inv.token));
      toast.success(copied ? t("inviteLinkCopied") : t("inviteLinkCreated"));
    },
    onError: (e) => toast.error(errMsg(e, t("createInviteFailed"))),
  });
  const revokeLinkMut = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(scope, inviteId),
    onSuccess: (_data, inviteId) => {
      if (created?.inviteId === inviteId) setCreated(null);
      void invalidateInvites();
      toast.success(t("inviteLinkRevoked"));
    },
    onError: (e) => toast.error(errMsg(e, t("revokeLinkFailed"))),
  });

  const filtered = useMemo(() => {
    if (!members) return members;
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.nickname ?? "").toLowerCase().includes(q) || (m.userId ?? "").toLowerCase().includes(q)
    );
  }, [members, search]);

  return (
    <div className="space-y-3">
      {canManage && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (account.trim() && !addMut.isPending) addMut.mutate();
          }}
        >
          <Input
            placeholder={t("addByEmailOrPhone")}
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            className="flex-1"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as AssignableRole)}
            className="h-9 rounded-md bg-input/30 px-2 text-sm text-foreground outline-none"
            aria-label={t("role")}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={!account.trim() || addMut.isPending}>
            <IconUserPlus className="size-4" />
            {t("add")}
          </Button>
        </form>
      )}

      {(members?.length ?? 0) > 6 && (
        <div className="relative">
          <IconSearch className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchMembers")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
      )}

      <div className="max-h-80 space-y-0.5 overflow-auto">
        {isLoading || !filtered ? (
          <>
            {[0, 1].map((key) => (
              <Skeleton key={key} className="h-11 w-full rounded-lg" />
            ))}
          </>
        ) : filtered.length === 0 ? (
          <p className="px-1.5 py-6 text-center text-sm text-muted-foreground">
            {t("noMembersFound")}
          </p>
        ) : (
          filtered.map((member) => (
            <div key={member.memberId} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5">
              <MemberAvatar member={member} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-foreground">
                  {member.nickname ?? member.userId}
                  {member.isSelf && (
                    <span className="text-muted-foreground"> {t("youSuffix")}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{roleLabel(member.role)}</span>
              </div>
              {canManage && !member.isOwner && !member.isSelf ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t("memberActions")}
                    className="flex size-7 items-center justify-center rounded-md text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <IconDotsVertical className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {ROLES.map((r) => (
                      <DropdownMenuItem
                        key={r}
                        onSelect={() => roleMut.mutate({ memberId: member.memberId, nextRole: r })}
                      >
                        <IconCheck className={`size-4 ${member.role === r ? "" : "opacity-0"}`} />
                        {roleLabel(r)}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => removeMut.mutate(member.memberId)}
                    >
                      <IconTrash className="size-4" />
                      {tc("remove")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                member.isOwner && (
                  <span className="text-xs text-muted-foreground">{t("roles.owner")}</span>
                )
              )}
            </div>
          ))
        )}
      </div>

      {canManage && (
        <div className="space-y-3 pt-1">
          <Separator />
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconLink className="size-4 text-muted-foreground" />
              {t("inviteLink")}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("inviteLinkHint", {
                scope: scope.kind === "workspace" ? t("thisTeam") : t("thisProject"),
              })}
            </p>
          </div>

          {created && (
            <div className="flex items-center gap-2 rounded-lg bg-input/30 px-2.5 py-1.5">
              <code className="flex-1 truncate text-xs text-muted-foreground">
                {inviteUrl(created.token)}
              </code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const ok = await copyToClipboard(inviteUrl(created.token));
                  if (ok) toast.success(tc("copied"));
                  else toast.error(t("copyFailed"));
                }}
              >
                <IconCopy className="size-4" />
                {tc("copy")}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <select
              value={linkRole}
              onChange={(event) => setLinkRole(event.target.value as AssignableRole)}
              className="h-9 rounded-md bg-input/30 px-2 text-sm text-foreground outline-none"
              aria-label={t("inviteLinkRole")}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={createLinkMut.isPending}
              onClick={() => createLinkMut.mutate()}
            >
              <IconLink className="size-4" />
              {t("createLink")}
            </Button>
          </div>

          {invites && invites.length > 0 && (
            <div className="space-y-0.5">
              {invites.map((inv) => (
                <div
                  key={inv.inviteId}
                  className="flex items-center gap-3 rounded-lg px-1.5 py-1.5"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <IconLink className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {t("roleLink", { role: roleLabel(inv.role) })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {(() => {
                        const days = expiryDays(inv.expiresAt);
                        return days <= 0 ? t("expired") : t("expiresInDays", { days });
                      })()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => revokeLinkMut.mutate(inv.inviteId)}
                    className="flex size-7 items-center justify-center rounded-md text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white"
                    aria-label={t("revokeLink")}
                  >
                    <IconTrash className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemberAvatar({ member }: { member: SharingMember }) {
  if (member.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
      <img src={member.avatar} alt="" className="size-8 shrink-0 rounded-full object-cover" />
    );
  }
  const initial = (member.nickname ?? member.userId ?? "?").charAt(0).toUpperCase();
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
      {initial}
    </span>
  );
}
