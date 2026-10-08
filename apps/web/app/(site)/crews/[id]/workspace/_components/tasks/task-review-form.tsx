"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { IconCheck, IconClipboardCheck } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useTranslations } from "@/src/i18n/i18n";
import { useReviewCrewTask, type CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { useCurrentUser } from "@/src/hooks/use-user";
interface Props {
  task: CrewTaskDTO;
  onReviewed: (decision: "approve" | "request_revision") => void;
}
export function TaskReviewForm(props: Props) {
  const { user } = useCurrentUser();
  return (
    <ReviewSession
      key={JSON.stringify([
        user?.id,
        props.task.crewId,
        props.task.id,
        props.task.submissions[0]?.id,
      ])}
      {...props}
    />
  );
}
function ReviewSession({ task, onReviewed }: Props) {
  const instructionsId = useId();
  const submissionId = task.submissions[0]?.id;
  const t = useTranslations("crewTasks");
  const review = useReviewCrewTask(task.crewId);
  const [reviewNote, setReviewNote] = useState("");
  const [deadline, setDeadline] = useState("");
  const [validationTime, setValidationTime] = useState(() => Date.now());
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const validDeadline = (now = validationTime) => {
    if (!deadline) return true;
    const date = new Date(deadline);
    const local =
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-") +
      "T" +
      [date.getHours(), date.getMinutes()].map((n) => String(n).padStart(2, "0")).join(":");
    return (
      local === deadline &&
      Number.isFinite(date.getTime()) &&
      date.getTime() > now &&
      (!task.dueAt || date.getTime() > new Date(task.dueAt).getTime())
    );
  };
  const latestSubmission = task.submissions[0];
  const videoAssets =
    latestSubmission?.assets?.filter((a) => a.contentType?.startsWith("video/")) ?? [];
  const clipId = task.storyboardClipId;
  const showPrimaryPicker = Boolean(clipId && videoAssets.length >= 1);

  const defaultAssetId = (() => {
    if (!videoAssets.length) return undefined;
    const answers =
      (latestSubmission?.professionalDelivery as { answers?: Record<string, unknown> } | null)
        ?.answers ?? {};
    const assetIdForSlot = (slot: string): string | undefined => {
      const v = answers[slot];
      if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
      return typeof v === "string" ? v : undefined;
    };
    const preferredId =
      assetIdForSlot("video_with_subtitle") ??
      assetIdForSlot("final_video") ??
      assetIdForSlot("video_without_subtitle");
    if (preferredId && videoAssets.some((v) => v.id === preferredId)) {
      return preferredId;
    }
    return videoAssets[0].id;
  })();

  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>(defaultAssetId);

  const revisionLimitReached =
    task.revisionLimit != null && task.revisionRoundsUsed >= task.revisionLimit;
  const alive = useRef(true);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const decide = async (decision: "approve" | "request_revision") => {
    if (!submissionId || !alive.current || pending.current || task.status !== "submitted") return;
    if (decision === "request_revision" && (revisionLimitReached || !reviewNote.trim())) return;
    if (decision === "request_revision" && !validDeadline(Date.now())) {
      setValidationTime(Date.now());
      toast.error(t("revisionDeadlineInvalid"));
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      await review.mutateAsync({
        taskId: task.id,
        expectedSubmissionId: submissionId,
        decision,
        note: reviewNote,
        ...(decision === "request_revision" && deadline
          ? { revisionDueAt: new Date(deadline).toISOString() }
          : {}),
        ...(decision === "approve" && selectedAssetId ? { bindAssetNodeId: selectedAssetId } : {}),
      });
      if (!alive.current) return;
      toast.success(decision === "approve" ? t("approved") : t("revisionRequested"));
      setReviewNote("");
      setDeadline("");
      onReviewed(decision);
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : t("actionFailed"));
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg bg-white/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <IconClipboardCheck className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{t("reviewSubmission")}</h3>
      </div>
      {latestSubmission?.professionalDelivery?.definition.approvalPolicy ===
        "fd3_or_production_lead" && (
        <p className="mb-3 text-sm text-muted-foreground">{t("cardApproval")}</p>
      )}
      <Textarea
        aria-label={t("reviewNotePlaceholder")}
        aria-describedby={instructionsId}
        disabled={saving}
        value={reviewNote}
        onChange={(event) => setReviewNote(event.target.value)}
        placeholder={t("reviewNotePlaceholder")}
        maxLength={5000}
        className="min-h-24 border-white/[0.09] bg-[#090a0d]"
      />
      <p
        id={instructionsId}
        className={cn(
          "mt-2 text-xs leading-relaxed text-muted-foreground",
          revisionLimitReached && "text-amber-300"
        )}
      >
        {revisionLimitReached ? t("revisionLimitReached") : t("revisionInstructionsRequired")}
      </p>
      <div className="mt-3 space-y-2 text-sm">
        <label className="block">
          {t("revisionDeadlineLabel", { timezone })}
          <Input
            type="datetime-local"
            value={deadline}
            disabled={saving}
            onChange={(event) => {
              setDeadline(event.target.value);
              setValidationTime(Date.now());
            }}
          />
        </label>
        <p className="text-muted-foreground">{t("revisionDeadlineHelp")}</p>
        {task.dueAt && (
          <p>
            {t("revisionDeadlineCurrent", {
              date: new Date(task.dueAt).toLocaleString(),
              timezone,
            })}
          </p>
        )}
        {deadline && !validDeadline() && <p role="alert">{t("revisionDeadlineInvalid")}</p>}
      </div>
      {showPrimaryPicker && (
        <div className="mt-3 space-y-1">
          <label className="block text-xs font-medium text-[#e2e3e6]">
            {t("clipPrimaryAsset")}
            <NativeSelect
              aria-label={t("clipPrimaryAsset")}
              disabled={saving}
              value={selectedAssetId ?? defaultAssetId ?? ""}
              onChange={(val) => setSelectedAssetId(val || undefined)}
              className="mt-1"
            >
              {videoAssets.map((asset) => (
                <NativeSelectOption key={asset.id} value={asset.id}>
                  {asset.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <p className="text-[11px] text-muted-foreground">{t("clipPrimaryAssetHint")}</p>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          color="muted"
          disabled={!submissionId || saving || revisionLimitReached || !reviewNote.trim()}
          onClick={() => void decide("request_revision")}
        >
          {t("requestRevision")}
        </Button>
        <Button
          size="sm"
          disabled={!submissionId || saving}
          onClick={() => void decide("approve")}
          icon={<IconCheck />}
        >
          {t("approve")}
        </Button>
      </div>
    </section>
  );
}
