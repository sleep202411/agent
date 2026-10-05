"use client";

import { useAuth } from "@/app/_components/auth-provider";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
type MembersManagerProps = {
  scope: ShareScope;
  canManage: boolean;
  renderRoleGuide?: (role: AssignableShareRole | null, source: "member" | "link") => ReactNode;
};

export function MembersManager({ scope, canManage, renderRoleGuide }: MembersManagerProps) {
  const { user } = useAuth();
  const viewerId = user?.id == null ? null : String(user.id);
  return (
    <MembersManagerView
      key={JSON.stringify([viewerId, scope.kind, scope.id, canManage])}
      scope={scope}
      canManage={canManage}
      viewerId={viewerId}
      renderRoleGuide={renderRoleGuide}
    />
  );
}
function MembersManagerView({
  scope,
  canManage,
  viewerId,
  renderRoleGuide,
}: MembersManagerProps & {
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
  const [invitationMode, setInvitationMode] = useState<"member" | "link">("member");
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
  const [linkExpiry, setLinkExpiry] = useState<"never" | "7" | "30">("7");
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
        (signal) =>
          createInvite(scope, linkRole, linkExpiry === "never" ? null : Number(linkExpiry), signal),
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
        <Tabs
          className="min-w-0"
          value={invitationMode}
          onValueChange={(value) => setInvitationMode(value as "member" | "link")}
        >
          <TabsList
            variant="segmented"
            className="w-full sm:w-fit"
            aria-label={t("invitationMode")}
          >
            <TabsTrigger value="member" disabled={pending}>
              <IconUserPlus className="size-4" />
              {t("inviteByAccount")}
            </TabsTrigger>
            <TabsTrigger value="link" disabled={pending}>
              <IconLink className="size-4" />
              {t("inviteByLink")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="member" className="min-w-0">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (account.trim() && !pending) addMut.mutate();
              }}
            >
              <Input
                placeholder={t("addByEmailOrPhone")}
                aria-label={t("addByEmailOrPhone")}
                disabled={pending || accessDenied}
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                className="min-w-0 basis-full sm:flex-1 sm:basis-0"
              />
              <Select
                disabled={pending || accessDenied}
                value={role}
                onValueChange={(value) => setRole(value as AssignableShareRole)}
              >
                <SelectTrigger
                  size="default"
                  className="h-9 min-w-28 bg-input/30 text-sm"
                  aria-label={t("role")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={!account.trim() || pending || accessDenied}>
                <IconUserPlus className="size-4" />
                {t("add")}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="link" className="min-w-0 space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("inviteLinkHint", {
                scope: scope.kind === "workspace" ? t("thisTeam") : t("thisProject"),
              })}
            </p>

            {created && (
              <div className="flex min-w-0 items-center gap-2 rounded-lg bg-input/30 px-2.5 py-1.5">
                <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {inviteUrl(created.token)}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending || accessDenied}
                  onClick={() => copyMut.mutate()}
                >
                  <IconCopy className="size-4" />
                  {tc("copy")}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Select
                disabled={pending || accessDenied}
                value={linkRole}
                onValueChange={(value) => setLinkRole(value as AssignableShareRole)}
              >
                <SelectTrigger
                  size="default"
                  className="h-9 min-w-28 bg-input/30 text-sm"
                  aria-label={t("inviteLinkRole")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                disabled={pending || accessDenied}
                value={linkExpiry}
                onValueChange={(value) => setLinkExpiry(value as "never" | "7" | "30")}
              >
                <SelectTrigger
                  size="default"
                  className="h-9 min-w-32 bg-input/30 text-sm"
                  aria-label={t("inviteLinkExpiryLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="never">{t("inviteLinkExpiryNever")}</SelectItem>
                  <SelectItem value="7">{t("inviteLinkExpiryDays", { days: 7 })}</SelectItem>
                  <SelectItem value="30">{t("inviteLinkExpiryDays", { days: 30 })}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || accessDenied}
                onClick={() => createLinkMut.mutate()}
              >
                <IconLink className="size-4" />
                {t("createLink")}
              </Button>
            </div>

            {invitesQuery.isError && (
              <div role="alert" className="space-y-2 text-sm">
                <p>{invitesQuery.error.message}</p>
                <Button variant="secondary" size="sm" onClick={() => void invitesQuery.refetch()}>
                  {tc("retry")}
                </Button>
              </div>
            )}
            {invitesQuery.isLoading && <Skeleton className="h-11 w-full rounded-lg" />}
            {invites && invites.length > 0 && (
              <div
                className="max-h-48 space-y-0.5 overflow-y-auto"
                role="region"
                aria-label={t("existingInviteLinks")}
              >
                <Separator className="mb-2" />
                <p className="pb-1 text-xs font-medium">{t("existingInviteLinks")}</p>
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
                        {inv.expiresAt == null
                          ? t("neverExpires")
                          : (() => {
                              const days = expiryDays(inv.expiresAt);
                              return days <= 0 ? t("expired") : t("expiresInDays", { days });
                            })()}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={pending || accessDenied}
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
          </TabsContent>
        </Tabs>
      )}

      {renderRoleGuide?.(
        canManage ? (invitationMode === "member" ? role : linkRole) : null,
        invitationMode
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
              {(scope.kind === "workspace" || (canManage && canChangeRoles && !member.isSelf)) &&
                !member.isOwner &&
                member.accessScope !== "project_only" && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={!canChangeRoles ? 0 : undefined}
                          aria-label={!canChangeRoles ? t("contactOwnerRole") : undefined}
                        >
                          <Select
                            value={member.role}
                            disabled={!canChangeRoles || pending || accessDenied}
                            onValueChange={(value) => {
                              if (canChangeRoles)
                                roleMut.mutate({
                                  memberId: member.memberId,
                                  nextRole: value as AssignableShareRole,
                                });
                            }}
                          >
                            <SelectTrigger
                              size="sm"
                              className="h-8 min-w-24 shrink-0 bg-input/30 text-xs disabled:cursor-not-allowed"
                              aria-label={t("changeMemberRole", {
                                name: member.nickname ?? member.userId,
                              })}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" align="end">
                              {!roleOptions.includes(member.role as AssignableShareRole) && (
                                <SelectItem value={member.role}>
                                  {roleLabel(member.role)}
                                </SelectItem>
                              )}
                              {roleOptions.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {roleLabel(r)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
