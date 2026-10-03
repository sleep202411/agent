"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconBolt, IconDeviceFloppy, IconUsers } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";
import { listWorkspaceMembers } from "@/lib/collab/sharing-api";
import { deleteWorkspace, updateWorkspace, type WorkspaceRef } from "@/lib/collab/projects-api";
import { LetterAvatar, PageHeader, Panel } from "../_components/settings-ui";

const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/** Active-workspace Overview — identity, team name, members, credits, danger zone. */
export default function OverviewSettingsPage() {
  const t = useTranslations("settings");
  const { activeWorkspace: ws, loading, error, fetching, refresh } = useWorkspace();
  const { user } = useAuth();

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </main>
    );
  }

  if (!ws || error) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
        <PageHeader title={t("overview")} />
        <ReadFailure
          error={error}
          fallback={t("workspaceUnavailable")}
          busy={fetching}
          retry={refresh}
        />
      </main>
    );
  }
  return <WorkspaceOverview key={`${user?.id}:${ws.id}:${ws.role}`} ws={ws} />;
}

function WorkspaceOverview({ ws }: { ws: WorkspaceRef }) {
  const t = useTranslations("settings");
  const canManage = ws.role === "owner" || ws.role === "admin";
  const isOwner = ws.role === "owner";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader title={t("overview")} />

      <Panel>
        <div className="flex items-center gap-4">
          <LetterAvatar name={ws.name} src={ws.avatarUrl} size="size-12" className="text-base" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium">{ws.name}</span>
            <span className="text-sm text-muted-foreground">
              {t("workspace")}
              {ws.role ? ` · ${t(`role.${ws.role}`)}` : ""}
            </span>
          </div>
        </div>
      </Panel>

      <TeamNamePanel key={ws.id} ws={ws} editable={canManage} />

      <MembersPanel ws={ws} canManage={canManage} />

      <CreditsSummaryPanel ws={ws} />

      {!ws.isDefault && isOwner && <DangerZone ws={ws} />}
    </main>
  );
}

function TeamNamePanel({ ws, editable }: { ws: WorkspaceRef; editable: boolean }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { refresh } = useWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState(ws.name);
  const [committed, setCommitted] = useState(ws.name);
  const dirty = name.trim().length > 0 && name.trim() !== committed;
  const owner = useOperationOwner();

  const renameMut = useMutation({
    mutationFn: () => {
      if (!editable) throw new Error(t("couldntUpdateName"));
      return updateWorkspace(ws.id, { name: name.trim() }, owner.signal());
    },
    onSuccess: (updated) => {
      if (!owner.current()) return;
      setCommitted(updated.name);
      setName(updated.name);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["fizzstudio", "workspaces"] });
      toast.success(t("workspaceNameUpdated"));
    },
    onError: (e) => {
      if (owner.current()) toast.error(errMsg(e, t("couldntUpdateName")));
    },
  });

  return (
    <Panel title={t("workspaceName")}>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (editable && dirty && !renameMut.isPending) renameMut.mutate();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!editable || renameMut.isPending}
          maxLength={120}
          className="flex-1"
        />
        {editable && (
          <Button type="submit" disabled={!dirty || renameMut.isPending}>
            <IconDeviceFloppy className="size-4" />
            {tc("save")}
          </Button>
        )}
      </form>
    </Panel>
  );
}

function MembersPanel({ ws, canManage }: { ws: WorkspaceRef; canManage: boolean }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const { user } = useAuth();
  const {
    data: members,
    error,
    isPending,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["share-members", "workspace", ws.id, user?.id] as const,
    queryFn: ({ signal }) => listWorkspaceMembers(ws.id, signal),
    enabled: Boolean(user),
  });
  const count = members?.length ?? 0;

  return (
    <Panel
      title={members ? t("teamMembersWithCount", { count }) : t("teamMembers")}
      icon={<IconUsers className="size-4 text-muted-foreground" />}
    >
      {error ? (
        <ReadFailure
          error={error}
          fallback={t("membersLoadFailed")}
          busy={isFetching}
          retry={() => void refetch()}
        />
      ) : isPending ? (
        <Skeleton className="h-8 w-40 rounded-lg" />
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {(members ?? []).slice(0, 6).map((m) =>
              m.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
                <img
                  key={m.memberId}
                  src={m.avatar}
                  alt=""
                  className="size-8 rounded-full object-cover"
                />
              ) : (
                <LetterAvatar key={m.memberId} name={m.nickname ?? m.userId} />
              )
            )}
            {count === 0 && (
              <span className="text-sm text-muted-foreground">{t("noMembersYet")}</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canManage && (
              <Button onClick={() => router.push("/settings/members")}>{t("inviteMembers")}</Button>
            )}
            <Button variant="secondary" onClick={() => router.push("/settings/members")}>
              {t("manageAccess")}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function CreditsSummaryPanel({ ws }: { ws: WorkspaceRef }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const { data: balance, error, isFetching, refetch } = useComputeWalletBalance(true, ws.id);

  return (
    <Panel title={t("credits")} icon={<IconBolt className="size-4 text-muted-foreground" />}>
      {error && (
        <ReadFailure
          error={error}
          fallback={t("creditsLoadFailed")}
          busy={isFetching}
          retry={() => void refetch()}
        />
      )}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
            <IconBolt className="size-5 text-white/85" stroke={1.8} />
            {balance ? balance.available.toLocaleString() : "—"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{t("sharedTeamBalancePool")}</div>
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={() => router.push("/settings/billing")}
        >
          {t("manageCredits")}
        </Button>
      </div>
    </Panel>
  );
}

function DangerZone({ ws }: { ws: WorkspaceRef }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const { workspaces, setActiveWorkspaceId, refresh } = useWorkspace();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const owner = useOperationOwner();

  const deleteMut = useMutation({
    mutationFn: () => deleteWorkspace(ws.id, owner.signal()),
    onSuccess: () => {
      if (!owner.current()) return;
      const next = workspaces.find((w) => w.isDefault);
      if (next) setActiveWorkspaceId(next.id);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["fizzstudio", "workspaces"] });
      toast.success(t("teamDeleted", { name: ws.name }));
      setConfirmOpen(false);
      router.push("/settings/overview");
    },
    onError: (e) => {
      if (owner.current()) toast.error(errMsg(e, t("couldntDeleteTeam")));
    },
  });

  return (
    <Panel title={t("dangerZone")} icon={<IconAlertTriangle className="size-4 text-destructive" />}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("dangerZoneDescription")}</p>
        <Button variant="destructive" className="shrink-0" onClick={() => setConfirmOpen(true)}>
          {t("deleteTeam")}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteTeamConfirmTitle", { name: ws.name })}</DialogTitle>
            <DialogDescription>{t("deleteTeamConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate()}
            >
              {t("deleteTeam")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function ReadFailure({
  error,
  fallback,
  busy,
  retry,
}: {
  error: unknown;
  fallback: string;
  busy: boolean;
  retry: () => void;
}) {
  const t = useTranslations("common");
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span>{errMsg(error, fallback)}</span>
      <Button variant="secondary" size="sm" disabled={busy} onClick={retry}>
        {t("retry")}
      </Button>
    </div>
  );
}

/** Requests and completion effects belong to the mounted account/workspace. */
function useOperationOwner() {
  const { user, isCurrentAccount } = useAuth();
  const controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const next = new AbortController();
    controller.current = next;
    return () => next.abort();
  }, []);
  const current = () =>
    Boolean(
      user?.id != null &&
      isCurrentAccount(user.id) &&
      controller.current &&
      !controller.current.signal.aborted
    );
  return {
    current,
    signal: () => {
      if (!current()) throw new DOMException("Workspace session changed", "AbortError");
      return controller.current!.signal;
    },
  };
}
