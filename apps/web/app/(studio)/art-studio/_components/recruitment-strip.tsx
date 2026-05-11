"use client";

import { useState } from "react";
import { IconCheck, IconUserSearch, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { env } from "@/src/env";
import { useCertificationRoles } from "@/src/hooks/use-certification";
import {
  useAgreeJobApply,
  useRecruitmentList,
  useRefuseJobApply,
} from "@/src/hooks/use-recruitment";
import { useTranslations } from "@/src/i18n/i18n";
import type { JobApplicant } from "@/src/services/recruitment";

const USER_BASE = env.USER_BASE_URL;

function avatarUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return `${USER_BASE}/${path}`;
}

export function RecruitmentStrip() {
  const t = useTranslations("workspace");
  const { data, isLoading } = useRecruitmentList();
  const { data: roleMap } = useCertificationRoles();
  const [rejectTarget, setRejectTarget] = useState<JobApplicant | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const list = data ?? [];

  if (!isLoading && list.length === 0) return null;

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <IconUserSearch className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("myRecruitment")}</h2>
      </div>

      <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
        {isLoading && Array.from({ length: 2 }).map((_, i) => <RecruitmentSkeleton key={i} />)}
        {!isLoading &&
          list.map((item) => (
            <RecruitmentRow
              key={item.id}
              item={item}
              roleName={item.roleId ? roleMap?.[String(item.roleId)] : undefined}
              onRejectClick={() => {
                setRejectTarget(item);
                setRejectReason("");
              }}
            />
          ))}
      </div>

      <RejectDialog
        target={rejectTarget}
        reason={rejectReason}
        onReasonChange={setRejectReason}
        onClose={() => setRejectTarget(null)}
      />
    </section>
  );
}

function RecruitmentRow({
  item,
  roleName,
  onRejectClick,
}: {
  item: JobApplicant;
  roleName: string | undefined;
  onRejectClick: () => void;
}) {
  const t = useTranslations("workspace");
  const agree = useAgreeJobApply();
  const avatar = avatarUrl(item.applyUsernameAvatar);
  const name = item.applyUsername || t("unnamedUser");
  const applyDate = item.createTime ? item.createTime.split("T")[0] : "—";

  const handleAgree = async () => {
    try {
      await agree.mutateAsync(item.id);
      toast.success(t("passSuccess"));
    } catch {
      toast.error(t("processFailed"));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <UserAvatar src={avatar} seed={item.applyUsername} name={name} size="lg" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[item.projectName, roleName ?? t("unknownRole"), applyDate].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="soft"
          color="muted"
          onClick={onRejectClick}
          disabled={agree.isPending}
        >
          <IconX className="size-3.5" />
          {t("rejectApply")}
        </Button>
        <Button size="sm" onClick={handleAgree} loading={agree.isPending}>
          <IconCheck className="size-3.5" />
          {t("passApply")}
        </Button>
      </div>
    </div>
  );
}

function RejectDialog({
  target,
  reason,
  onReasonChange,
  onClose,
}: {
  target: JobApplicant | null;
  reason: string;
  onReasonChange: (v: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("workspace");
  const refuse = useRefuseJobApply();
  const open = target !== null;

  const handleConfirm = async () => {
    if (!target) return;
    try {
      await refuse.mutateAsync({ applyId: target.id, message: reason });
      toast.success(t("rejectSuccess"));
      onClose();
    } catch {
      toast.error(t("processFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("confirmReject")}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={t("rejectReasonPlaceholder")}
          maxLength={200}
          rows={4}
        />
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={onClose} disabled={refuse.isPending}>
            {t("cancel")}
          </Button>
          <Button color="destructive" onClick={handleConfirm} loading={refuse.isPending}>
            {t("rejectApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecruitmentSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="size-10 animate-pulse rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-8 w-32 animate-pulse rounded bg-muted" />
    </div>
  );
}
