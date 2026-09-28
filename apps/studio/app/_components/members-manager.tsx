"use client";

import { useAuth } from "@/app/_components/auth-provider";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api";
import { getAssetsRealtimeKernel } from "@/lib/canvas-authoring/assets-realtime-kernel";
import {
  addMember,
  createInvite,
  inviteUrl,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  updateMemberRole,
  defaultRoleForScope,
  rolesForScope,
  type AssignableShareRole,
  type CreatedInvite,
  type ShareScope,
  type SharingMember,
} from "@/lib/collab/sharing-api";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

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
  const { user } = useAuth();
  const viewerId = user?.id == null ? null : String(user.id);
  return (
    <MembersManagerView
      key={JSON.stringify([viewerId, scope.kind, scope.id, canManage])}
      scope={scope}
      canManage={canManage}
      viewerId={viewerId}
    />
  );
}
function MembersManagerView({
  scope,
  canManage,
  viewerId,
}: {
  scope: ShareScope;
  canManage: boolean;
  viewerId: string | null;
}) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const roleLabel = (r: string) =>
    t(
      `roles.${r}` as
        | "roles.admin"
        | "roles.editor"
        | "roles.viewer"
        | "roles.producer"
        | "roles.reviewer"
    );
  const queryClient = useQueryClient();
  const membersKey = ["share-members", scope.kind, scope.id, viewerId] as const;
  const {
    data: members,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: membersKey,
    queryFn: ({ signal }) => listMembers(scope, signal),
    enabled: Boolean(viewerId),
    retry: false,
  });

  // Role vocabulary is per scope: a Story project assigns story roles, every
  // other scope assigns the platform ones.
  const roleOptions = rolesForScope(scope);
  const [account, setAccount] = useState("");
  const [role, setRole] = useState<AssignableShareRole>(defaultRoleForScope(scope));
  const [search, setSearch] = useState("");
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: membersKey }),
      ...(scope.kind === "story-project" || scope.kind === "workspace"
        ? [
            queryClient.invalidateQueries({
              predicate: ({ queryKey }) =>
                queryKey[0] === "story-studio" &&
                (scope.kind === "workspace" || queryKey[2] === scope.id),
            }),
          ]
        : []),
    ]);
  };

  // Realtime: refresh the roster when membership changes server-side — including
  // a change another admin made. Workspace scope only (project members differ).
  useEffect(() => {
    if (!viewerId || scope.kind !== "workspace") return;
    const sub = getAssetsRealtimeKernel({ workspaceId: scope.id }).subscribe({
      onEvent: (event) => {
        if (event.kind === "team_member_changed" && event.workspaceId === scope.id) {
          void queryClient.invalidateQueries({
            queryKey: ["share-members", scope.kind, scope.id, viewerId],
          });
        }
      },
    });
    return () => sub.close();
  }, [scope.kind, scope.id, viewerId, queryClient]);

  const mounted = useRef(false);
  const activeAction = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeAction.current?.abort();
      activeAction.current = null;
    };
  }, []);
  function runAction<R>(
    execute: (signal: AbortSignal) => Promise<R>,
    success: (result: R, current: () => boolean) => void | Promise<void>,
    failure: string
  ) {
    if (!mounted.current || !viewerId || !canManage || accessDenied || activeAction.current) return;
    const claim = new AbortController();
    activeAction.current = claim;
    setPending(true);
    const current = () => mounted.current && activeAction.current === claim;
    void (async () => {
      try {
        const result = await execute(claim.signal);
        if (current()) await success(result, current);
      } catch (error) {
        if (current()) toast.error(errMsg(error, failure));
      } finally {
        if (current()) {
          activeAction.current = null;
          setPending(false);
        }
      }
    })();
  }
  const addMut = {
    isPending: pending,
    mutate: () =>
      runAction(
        (signal) => addMember(scope, account.trim(), role, signal),
        (m) => {
          setAccount("");
          void invalidate();
          toast.success(t("addedMember", { name: m.nickname ?? t("memberFallback") }));
        },
        t("addMemberFailed")
      ),
  };
  const roleMut = {
    isPending: pending,
    mutate: (v: { memberId: string; nextRole: AssignableShareRole }) =>
      runAction(
        (signal) => updateMemberRole(scope, v.memberId, v.nextRole, signal),
        () => {
          void invalidate();
        },
        t("changeRoleFailed")
      ),
  };
  const removeMut = {
    isPending: pending,
    mutate: (memberId: string) =>
      runAction(
        (signal) => removeMember(scope, memberId, signal),
        () => {
          void invalidate();
        },
        t("removeMemberFailed")
      ),
  };

  // ── Invite links ──────────────────────────────────────────────────────────
  const [linkRole, setLinkRole] = useState<AssignableShareRole>(defaultRoleForScope(scope));
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const invitesKey = ["share-invites", scope.kind, scope.id, viewerId] as const;
  const invitesQuery = useQuery({
    queryKey: invitesKey,
    queryFn: ({ signal }) => listInvites(scope, signal),
    enabled: Boolean(viewerId && canManage),
  });
  const invites = invitesQuery.data;
  const inviteError = canManage ? invitesQuery.error : null;
  const accessDenied = [error, inviteError].some(
    (e) => e instanceof ApiRequestError && (e.status === 401 || e.status === 403)
  );
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: invitesKey });

  const createLinkMut = {
    isPending: pending,
    mutate: () =>
      runAction(
        (signal) => createInvite(scope, linkRole, undefined, signal),
        async (inv, current) => {
          setCreated(inv);
          void invalidateInvites();
          const copied = await copyToClipboard(inviteUrl(inv.token));
          if (current()) toast.success(copied ? t("inviteLinkCopied") : t("inviteLinkCreated"));
        },
        t("createInviteFailed")
      ),
  };
  const revokeLinkMut = {
    isPending: pending,
    mutate: (inviteId: string) =>
      runAction(
        (signal) => revokeInvite(scope, inviteId, signal),
        () => {
          if (created?.inviteId === inviteId) setCreated(null);
          void invalidateInvites();
          toast.success(t("inviteLinkRevoked"));
        },
        t("revokeLinkFailed")
      ),
  };
  const copyMut = {
    isPending: pending,
    mutate: () =>
      runAction(
        () => copyToClipboard(inviteUrl(created!.token)),
        (ok) => {
          if (ok) toast.success(tc("copied"));
          else toast.error(t("copyFailed"));
        },
        t("copyFailed")
      ),
  };

  const canChangeRoles =
    scope.kind !== "workspace" ? canManage : Boolean(members?.some((m) => m.isSelf && m.isOwner));

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
    <div className="min-w-0 space-y-3">
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
            disabled={pending}
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            className="flex-1"
          />
          <select
            disabled={pending}
            value={role}
            onChange={(event) => setRole(event.target.value as AssignableShareRole)}
            className="h-9 rounded-md bg-input/30 px-2 text-sm text-foreground outline-none"
            aria-label={t("role")}
          >
            {roleOptions.map((r) => (
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
        {isError ? (
          <div role="alert" className="space-y-3 px-1.5 py-3 text-sm">
            <p>{error.message}</p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {tc("retry")}
            </Button>
          </div>
        ) : isLoading || !filtered ? (
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
                <span className="text-xs text-muted-foreground">
                  {scope.kind === "workspace" && member.accessScope === "project_only"
                    ? t("projectOnlyMember")
                    : roleLabel(member.role)}
                </span>
              </div>
              {scope.kind === "workspace" &&
                !member.isOwner &&
                member.accessScope !== "project_only" && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={!canChangeRoles ? 0 : undefined}
                          aria-label={!canChangeRoles ? t("contactOwnerRole") : undefined}
                        >
                          <select
                            aria-label={t("changeMemberRole", {
                              name: member.nickname ?? member.userId,
                            })}
                            value={member.role}
                            disabled={!canChangeRoles || pending}
                            onChange={(event) => {
                              if (canChangeRoles)
                                roleMut.mutate({
                                  memberId: member.memberId,
                                  nextRole: event.target.value as AssignableShareRole,
                                });
                            }}
                            className="h-8 rounded-md bg-input/30 px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {!roleOptions.includes(member.role as AssignableShareRole) && (
                              <option value={member.role}>{roleLabel(member.role)}</option>
                            )}
                            {roleOptions.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        </span>
                      </TooltipTrigger>
                      {!canChangeRoles && <TooltipContent>{t("contactOwnerRole")}</TooltipContent>}
                    </Tooltip>
                  </TooltipProvider>
                )}
              {canManage &&
              !member.isOwner &&
              !member.isSelf &&
              member.accessScope !== "project_only" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={pending}
                    aria-label={t("memberActions")}
                    className="flex size-7 items-center justify-center rounded-md text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <IconDotsVertical className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {scope.kind !== "workspace" &&
                      roleOptions.map((r) => (
                        <DropdownMenuItem
                          key={r}
                          onSelect={() =>
                            roleMut.mutate({ memberId: member.memberId, nextRole: r })
                          }
                        >
                          <IconCheck className={`size-4 ${member.role === r ? "" : "opacity-0"}`} />
                          {roleLabel(r)}
                        </DropdownMenuItem>
                      ))}
                    {scope.kind !== "workspace" && <DropdownMenuSeparator />}
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
              <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {inviteUrl(created.token)}
              </code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => copyMut.mutate()}
              >
                <IconCopy className="size-4" />
                {tc("copy")}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <select
              disabled={pending}
              value={linkRole}
              onChange={(event) => setLinkRole(event.target.value as AssignableShareRole)}
              className="h-9 rounded-md bg-input/30 px-2 text-sm text-foreground outline-none"
              aria-label={t("inviteLinkRole")}
            >
              {roleOptions.map((r) => (
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
  const [failed, setFailed] = useState(false);
  const initial = (member.nickname ?? member.userId ?? "?").charAt(0).toUpperCase();
  if (member.avatar && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
      <img
        src={member.avatar}
        alt=""
        onError={() => setFailed(true)}
        className="size-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
      {initial}
    </span>
  );
}
