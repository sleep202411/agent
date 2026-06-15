"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCreditCard,
  IconDeviceFloppy,
  IconUsers,
} from "@tabler/icons-react";
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
import { ApiRequestError } from "@/lib/api";
import { useWorkspace } from "@/app/_components/workspace-context";
import { listWorkspaceMembers } from "@/lib/collab/sharing-api";
import { deleteWorkspace, updateWorkspace, type WorkspaceRef } from "@/lib/collab/projects-api";
import { EmptyState, LetterAvatar, PageHeader, Panel, TeamBadge } from "../_components/settings-ui";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiRequestError ? e.message : fallback;

/** Active-workspace Overview — identity, team name, members, credits, danger zone. */
export default function OverviewSettingsPage() {
  const { activeWorkspace: ws, loading } = useWorkspace();

  if (loading || !ws) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </main>
    );
  }

  const isTeam = ws.type === "team";
  const canManage = ws.role === "owner" || ws.role === "admin";
  const isOwner = ws.role === "owner";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader title="Overview" badge={<TeamBadge label={isTeam ? "Team" : "Personal"} />} />

      <Panel>
        <div className="flex items-center gap-4">
          <LetterAvatar name={ws.name} src={ws.avatarUrl} size="size-12" className="text-base" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium">{ws.name}</span>
            <span className="text-sm text-muted-foreground">
              {isTeam ? "Team" : "Personal"}
              {ws.role ? ` · ${cap(ws.role)}` : ""}
            </span>
          </div>
        </div>
      </Panel>

      <TeamNamePanel key={ws.id} ws={ws} editable={isTeam && canManage} />

      {isTeam && <MembersPanel ws={ws} canManage={canManage} />}

      <Panel
        title="Team credits"
        icon={<IconCreditCard className="size-4 text-muted-foreground" />}
      >
        <EmptyState
          icon={<IconCreditCard className="size-5" />}
          title="Team credits aren't available yet"
          body="A shared team credit pool is coming. For now, credits are per-account — see Plan & Billing."
        />
      </Panel>

      {isTeam && isOwner && <DangerZone ws={ws} />}
    </main>
  );
}

function TeamNamePanel({ ws, editable }: { ws: WorkspaceRef; editable: boolean }) {
  const { refresh } = useWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState(ws.name);
  const [committed, setCommitted] = useState(ws.name);
  const dirty = name.trim().length > 0 && name.trim() !== committed;

  const renameMut = useMutation({
    mutationFn: () => updateWorkspace(ws.id, { name: name.trim() }),
    onSuccess: (updated) => {
      setCommitted(updated.name);
      setName(updated.name);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["fizzstudio", "workspaces"] });
      toast.success("Workspace name updated");
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't update name")),
  });

  return (
    <Panel title={ws.type === "team" ? "Team name" : "Workspace name"}>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !renameMut.isPending) renameMut.mutate();
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
            Save
          </Button>
        )}
      </form>
    </Panel>
  );
}

function MembersPanel({ ws, canManage }: { ws: WorkspaceRef; canManage: boolean }) {
  const router = useRouter();
  const { data: members } = useQuery({
    queryKey: ["share-members", "workspace", ws.id] as const,
    queryFn: () => listWorkspaceMembers(ws.id),
  });
  const count = members?.length ?? 0;

  return (
    <Panel
      title={`Team members${members ? ` (${count})` : ""}`}
      icon={<IconUsers className="size-4 text-muted-foreground" />}
    >
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
          {count === 0 && <span className="text-sm text-muted-foreground">No members yet.</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <Button onClick={() => router.push("/settings/members")}>Invite members</Button>
          )}
          <Button variant="secondary" onClick={() => router.push("/settings/members")}>
            Manage access
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function DangerZone({ ws }: { ws: WorkspaceRef }) {
  const router = useRouter();
  const { workspaces, setActiveWorkspaceId, refresh } = useWorkspace();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMut = useMutation({
    mutationFn: () => deleteWorkspace(ws.id),
    onSuccess: () => {
      const personal = workspaces.find((w) => w.type === "personal");
      if (personal) setActiveWorkspaceId(personal.id);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["fizzstudio", "workspaces"] });
      toast.success(`Deleted “${ws.name}”`);
      setConfirmOpen(false);
      router.push("/settings/overview");
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't delete team")),
  });

  return (
    <Panel title="Danger zone" icon={<IconAlertTriangle className="size-4 text-destructive" />}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Delete this team and remove access for all members. This cannot be undone.
        </p>
        <Button variant="destructive" className="shrink-0" onClick={() => setConfirmOpen(true)}>
          Delete team
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{ws.name}”?</DialogTitle>
            <DialogDescription>
              All members lose access and the team&rsquo;s projects are archived. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate()}
            >
              Delete team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
