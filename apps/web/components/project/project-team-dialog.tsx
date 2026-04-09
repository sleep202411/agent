import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCopy, IconLoader2, IconMail, IconUserPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { env } from "@/src/env";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/src/store";
import { backendApi } from "@/src/lib/api";
import type { ProjectOptionItem, V1ProjectMember } from "@/src/types/workspace";

// ─── Constants ──────────────────────────────────────────

const ROLE = { MEMBER: 0, ADMIN: 8, OWNER: 10 } as const;
const STATUS = {
  WAIT_JOIN: "WAIT_JOIN",
  WAIT_APPROVE: "WAIT_APPROVE",
  REJECTED: "REJECTED",
  JOINED: "JOINED",
} as const;

// ─── Helpers ────────────────────────────────────────────

function getMemberName(member: V1ProjectMember) {
  return String(
    member.name ??
      member.nickname ??
      member.account ??
      member.email ??
      member.userId ??
      member.id ??
      ""
  );
}

function getMemberInitial(member: V1ProjectMember) {
  const name = getMemberName(member);
  return name.charAt(0).toUpperCase() || "U";
}

// ─── Status Badge ───────────────────────────────────────

function StatusBadge({ status, t }: { status?: string; t: (key: string) => string }) {
  const config: Record<string, { label: string; className: string }> = {
    JOINED: { label: t("statusJoined"), className: "bg-success/10 text-success" },
    WAIT_APPROVE: { label: t("statusWaitApprove"), className: "bg-warning/10 text-warning" },
    WAIT_JOIN: { label: t("statusWaitJoin"), className: "bg-muted text-muted-foreground" },
    REJECTED: { label: t("statusRejected"), className: "bg-destructive/10 text-destructive" },
  };
  const c = config[status ?? ""] ?? {
    label: status || "",
    className: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", c.className)}>
      {c.label}
    </span>
  );
}

// ─── Edit Role Dialog ───────────────────────────────────

function EditRoleDialog({
  open,
  onOpenChange,
  member,
  projectId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: V1ProjectMember | null;
  projectId: string;
  onSaved: () => void;
}) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const [role, setRole] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && member) {
      setRole(String(member.role ?? 0));
    }
  }, [open, member]);

  const handleSubmit = async () => {
    if (!member || saving) return;
    setSaving(true);
    try {
      await backendApi.post("/api/user/projectMember/addUpdate", {
        data: { projectId, account: String(member.userId ?? ""), role: Number(role) },
      });
      toast.success(t("updatePermissionSuccess"));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      console.error("[EditRoleDialog] update failed:", error);
      toast.error(t("updatePermissionFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("editMember")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("permission")}</div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("normalMember")}</SelectItem>
              <SelectItem value="8">{t("admin")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving && <IconLoader2 className="size-3.5 animate-spin" />}
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Dialog ────────────────────────────────────────

interface ProjectTeamDialogProps {
  open: boolean;
  project?: ProjectOptionItem | null;
  onOpenChange: (open: boolean) => void;
}

export function ProjectTeamDialog({ open, project, onOpenChange }: ProjectTeamDialogProps) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const currentUser = useAppSelector((s) => s.auth.user);

  const [activeTab, setActiveTab] = useState<"members" | "invite">("members");
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<V1ProjectMember[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [account, setAccount] = useState("");
  const [role, setRole] = useState("0");
  const [saving, setSaving] = useState(false);
  const [editMember, setEditMember] = useState<V1ProjectMember | null>(null);
  const [deleteMember, setDeleteMember] = useState<V1ProjectMember | null>(null);

  const selfMember = useMemo(
    () => members.find((m) => String(m.userId ?? m.id) === String(currentUser?.id ?? "")),
    [currentUser?.id, members]
  );
  const myRole = selfMember?.role ?? 0;
  const isAdmin = myRole >= ROLE.ADMIN;

  const loadData = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const [memberList, code] = await Promise.all([
        backendApi.post<V1ProjectMember[]>(
          `/api/user/projectMember/list/member/${String(project.id)}`
        ),
        backendApi.post(`/api/user/projectMember/inviteCode/${String(project.id)}`, {
          data: { shareType: "PROJECT" },
        }),
      ]);
      setMembers(memberList ?? []);
      if (code) {
        const origin = env.PARENT_ORIGIN || window.location.origin;
        const worldId = String(project.worldId ?? "");
        setInviteLink(
          `${origin}/pages/invite/invite?code=${String(code)}&projectId=${String(project.id)}${worldId ? `&worldId=${worldId}` : ""}`
        );
      }
    } catch (error) {
      console.error("[ProjectTeamDialog] load failed:", error);
      toast.error(t("loadTeamFailed"));
    } finally {
      setLoading(false);
    }
  }, [project?.id, project?.worldId, t]);

  useEffect(() => {
    if (!open) return;
    setActiveTab("members");
    setAccount("");
    setRole("0");
    void loadData();
  }, [open, loadData]);

  const handleInvite = async () => {
    if (!project?.id || !account.trim()) return;
    setSaving(true);
    try {
      await backendApi.post("/api/user/projectMember/addUpdate", {
        data: { projectId: String(project.id), account: account.trim(), role: Number(role) },
      });
      toast.success(t("inviteSuccess"));
      setAccount("");
      setRole("0");
      await loadData();
    } catch (error) {
      console.error("[ProjectTeamDialog] invite failed:", error);
      toast.error(t("inviteFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteMember?.id) return;
    try {
      await backendApi.post(`/api/user/projectMember/delete/${String(deleteMember.id)}`);
      toast.success(tc("deleteSuccess"));
      setDeleteMember(null);
      await loadData();
    } catch (error) {
      console.error("[ProjectTeamDialog] delete failed:", error);
      toast.error(tc("deleteFailed"));
    }
  };

  const handleApprove = async (member: V1ProjectMember, approve: boolean) => {
    if (!member.id) return;
    try {
      await backendApi.post(
        `/api/user/projectMember/approveInvite/${String(member.id)}/${approve}`
      );
      toast.success(approve ? t("approveSuccess") : t("rejectSuccess"));
      await loadData();
    } catch (error) {
      console.error("[ProjectTeamDialog] approve failed:", error);
      toast.error(t("operationFailed"));
    }
  };

  const handleCopyLink = () => {
    if (!inviteLink) return;
    const text = `${t("inviteText")} [${project?.name ?? ""}] ${inviteLink}`;
    navigator.clipboard.writeText(text).then(
      () => toast.success(tc("copySuccess")),
      () => toast.error(tc("copyFailed"))
    );
  };

  const isSelf = (m: V1ProjectMember) => String(m.userId ?? m.id) === String(currentUser?.id ?? "");

  const canEditMember = (m: V1ProjectMember) =>
    isAdmin && !isSelf(m) && m.status === STATUS.JOINED && (m.role ?? 0) < ROLE.OWNER;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tc("team")}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex h-80 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex min-h-[380px] gap-5">
              {/* Sidebar */}
              <div className="w-32 shrink-0 space-y-1 border-r border-border pr-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("members")}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    activeTab === "members"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/30"
                  )}
                >
                  {t("teamMembers")}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("invite")}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    activeTab === "invite"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/30"
                  )}
                >
                  {t("inviteMember")}
                </button>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                {activeTab === "members" ? (
                  <div>
                    {/* Table header */}
                    <div className="grid grid-cols-[2fr_1fr_1fr] border-b border-border px-1 pb-3 text-xs text-muted-foreground">
                      <span>{t("memberCol")}</span>
                      <span>{t("statusCol")}</span>
                      <span>{t("actionCol")}</span>
                    </div>

                    {/* Member list */}
                    <div className="max-h-[300px] overflow-auto">
                      {members.length === 0 ? (
                        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                          {t("noMembers")}
                        </div>
                      ) : (
                        members.map((member) => (
                          <div
                            key={String(member.id)}
                            className="grid grid-cols-[2fr_1fr_1fr] items-center border-b border-border/50 px-1 py-3 last:border-b-0"
                          >
                            {/* Member info */}
                            <div className="flex items-center gap-3">
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                                {getMemberInitial(member)}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {getMemberName(member)}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(member.role ?? 0) >= ROLE.OWNER
                                    ? t("owner")
                                    : (member.role ?? 0) >= ROLE.ADMIN
                                      ? t("admin")
                                      : t("normalMember")}
                                </div>
                              </div>
                            </div>

                            {/* Status */}
                            <div>
                              <StatusBadge status={String(member.status ?? "")} t={t} />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                              {member.status === STATUS.WAIT_APPROVE ? (
                                <>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    color="success"
                                    onClick={() => void handleApprove(member, true)}
                                  >
                                    {t("approve")}
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    color="destructive"
                                    onClick={() => void handleApprove(member, false)}
                                  >
                                    {t("reject")}
                                  </Button>
                                </>
                              ) : member.status === STATUS.JOINED ? (
                                <>
                                  {(member.role ?? 0) >= ROLE.ADMIN ? (
                                    <span className="rounded px-2 py-0.5 text-[11px] font-medium text-primary bg-primary/10">
                                      {(member.role ?? 0) >= ROLE.OWNER ? t("owner") : t("admin")}
                                    </span>
                                  ) : isSelf(member) ? (
                                    <span className="rounded px-2 py-0.5 text-[11px] font-medium text-success bg-success/10">
                                      {t("me")}
                                    </span>
                                  ) : (
                                    <>
                                      {canEditMember(member) && (
                                        <Button
                                          size="xs"
                                          variant="ghost"
                                          color="muted"
                                          onClick={() => setEditMember(member)}
                                        >
                                          {tc("edit")}
                                        </Button>
                                      )}
                                      {isAdmin && (
                                        <Button
                                          size="xs"
                                          variant="ghost"
                                          color="destructive"
                                          onClick={() => setDeleteMember(member)}
                                        >
                                          {tc("delete")}
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Invite by account */}
                    {isAdmin ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-muted-foreground">
                          {t("inviteByAccount")}
                        </div>
                        <div className="flex gap-2">
                          <Input
                            className="flex-1"
                            value={account}
                            onChange={(e) => setAccount(e.target.value)}
                            placeholder={t("accountPlaceholder")}
                          />
                          <Select value={role} onValueChange={setRole}>
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">{t("normalMember")}</SelectItem>
                              <SelectItem value="8">{t("admin")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={() => void handleInvite()}
                            disabled={!account.trim() || saving}
                          >
                            {saving && <IconLoader2 className="size-3.5 animate-spin" />}
                            <IconUserPlus className="size-3.5" />
                            {t("invite")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                        {t("noInvitePermission")}
                      </div>
                    )}

                    {/* Invite link */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">
                        {t("inviteByLink")}
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground break-all">
                        {inviteLink
                          ? `${t("inviteText")} [${project?.name ?? ""}] ${inviteLink}`
                          : t("generatingInviteLink")}
                      </div>
                      <Button
                        variant="outline"
                        color="muted"
                        size="sm"
                        onClick={handleCopyLink}
                        disabled={!inviteLink}
                      >
                        <IconCopy className="size-3.5" />
                        {t("copyLink")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              {tc("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit role sub-dialog */}
      <EditRoleDialog
        open={!!editMember}
        onOpenChange={(v) => !v && setEditMember(null)}
        member={editMember}
        projectId={String(project?.id ?? "")}
        onSaved={() => {
          setEditMember(null);
          void loadData();
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteMember} onOpenChange={(v) => !v && setDeleteMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteMemberTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteMemberContent")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              onClick={() => void handleDelete()}
            >
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
