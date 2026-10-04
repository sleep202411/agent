"use client";
import { TaskContractLink } from "@/app/(site)/crews/_components/task-contract-link";

import { workflowStateLabel } from "@/app/(site)/crews/_lib/workflow-state-label";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@/components/ui/sheet";
import { TaskFeedbackPanel } from "../_components/task-feedback-panel";
import { TaskDeliveryProgress } from "../[id]/workspace/_components/tasks/task-delivery-progress";
import { useState } from "react";
import Link from "next/link";
import { IconChevronDown, IconHistory, IconSend, IconMail } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import { CrewApiError } from "../_hooks/api";
import { useCrewTask, useCrewTaskTimeline } from "../_hooks/use-tasks";
import { displayNameOf, useUserDisplays } from "../_hooks/use-users";
import type { CrewTaskPriority, CrewTaskStatus } from "../_hooks/types";
import { TaskDeadline, TaskStateBadge } from "../_components/task-deadline";
import { TaskUnreadMarker } from "../_components/task-unread-marker";
import { SubmitTaskDialog } from "../[id]/workspace/_components/tasks/task-dialogs";
import { TaskDeliverySummary } from "../[id]/workspace/_components/tasks/task-delivery-summary";
import { TaskReviewForm } from "../[id]/workspace/_components/tasks/task-review-form";

export interface TrackingTask {
  id: string;
  title: string;
  number: number;
  status: CrewTaskStatus;
  workflowState: { name: string; systemKey: string | null; semantic: CrewTaskStatus };
  priority: CrewTaskPriority;
  taskKind: string | null;
  dueAt: string | null;
  crew: { id: string; name: string };
  canSubmit: boolean;
  canReview: boolean;
}

export function TaskTrackingCard({
  task,
  warningHours,
}: {
  task: TrackingTask;
  warningHours: number;
}) {
  const t = useTranslations("crewTaskCenter");
  const taskT = useTranslations("crewTasks");
  const locale = useLocale() as Locale;
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<"submit" | "review" | "feedback" | null>(null);
  return (
    <li className="min-w-0 rounded-lg bg-[#1e1e1e]">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="mb-1 text-xs text-muted-foreground">
            {task.crew.name} · TASK-{task.number}
          </p>
          <Link
            className="break-words text-sm font-semibold hover:underline"
            href={localizePath(
              `/crews/${task.crew.id}/workspace?tab=tasks&task=${task.id}`,
              locale
            )}
          >
            {task.title}
            <TaskUnreadMarker taskId={task.id} />
          </Link>
        </div>
        <TaskDeadline dueAt={task.dueAt} status={task.status} warningHours={warningHours} />
        <TaskStateBadge
          dueAt={task.dueAt}
          status={task.status}
          warningHours={warningHours}
          label={workflowStateLabel(task.workflowState, taskT)}
        />
        {task.canSubmit && action !== "submit" ? (
          <Button
            size="sm"
            onClick={() => {
              setExpanded(true);
              setAction("submit");
            }}
          >
            <IconSend className="size-4" />
            {t("submit")}
          </Button>
        ) : null}
        {task.canReview ? (
          <Button
            size="sm"
            onClick={() => {
              setExpanded(true);
              setAction("review");
            }}
          >
            {t("review")}
          </Button>
        ) : null}
        {["submitted", "approved", "revision_requested"].includes(task.status) ? (
          <Button size="sm" variant="ghost" color="muted" onClick={() => setAction("feedback")}>
            <IconMail className="size-4" />
            {t("feedback")}
          </Button>
        ) : null}
        <button
          type="button"
          className="flex min-h-11 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground hover:bg-white/5"
          aria-expanded={expanded}
          aria-controls={`history-${task.id}`}
          onClick={() => {
            setExpanded(!expanded);
            setAction(null);
          }}
        >
          <IconHistory className="size-4" />
          {t("history")}
          <IconChevronDown className={`size-4 ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
      {expanded && !action ? (
        <div id={`history-${task.id}`} className="border-t border-white/10 p-5">
          <TaskTrackingDetails task={task} action={action} onCloseAction={() => setAction(null)} />
        </div>
      ) : null}
      <Sheet
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>{task.title}</SheetTitle>
            <SheetDescription>
              {task.crew.name} · TASK-{task.number}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {action && (
              <TaskTrackingDetails
                task={task}
                action={action}
                onCloseAction={() => setAction(null)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </li>
  );
}

function TaskTrackingDetails({
  task,
  action,
  onCloseAction,
}: {
  task: TrackingTask;
  action: "submit" | "review" | "feedback" | null;
  onCloseAction: () => void;
}) {
  const t = useTranslations("crewTaskCenter");
  const taskT = useTranslations("crewTasks");
  const locale = useLocale();
  const detail = useCrewTask(task.id);
  const timeline = useCrewTaskTimeline(task.id, !detail.isError);
  const historyDenied =
    timeline.error instanceof CrewApiError && [401, 403, 404].includes(timeline.error.status);
  const events =
    detail.isError || historyDenied
      ? []
      : (timeline.data?.pages.flatMap((page) => page.items) ?? []);
  const displays = useUserDisplays(
    events.flatMap((event) => (event.actorUserId ? [event.actorUserId] : []))
  );
  // A failed task access check invalidates cached history as well as delivery.
  if (detail.isError || historyDenied) {
    return (
      <div role="alert">
        <p>{(detail.isError ? detail.error : timeline.error)?.message}</p>
        <Button onClick={() => void (detail.isError ? detail.refetch() : timeline.refetch())}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  const labels: Record<string, string> = {
    "task.created": "activity.created",
    "task.submitted": "activity.submitted",
    "task.approved": "activity.approved",
    "task.revision_requested": "activity.revisionRequested",
    "commitment.accepted": "activity.commitmentAccepted",
    "commitment.at_risk": "activity.commitmentRisk",
    "commitment.withdrawn": "activity.commitmentWithdrawn",
    "commitment.handover": "activity.commitmentHandover",
  };
  return (
    <div className="space-y-6">
      {detail.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : detail.data ? (
        <>
          {action && action !== "feedback" && <TaskDeliveryProgress status={detail.data.status} />}
          {!action && detail.data.description ? (
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {detail.data.description}
            </p>
          ) : null}
          {action === "submit" &&
          task.canSubmit &&
          ["open", "in_progress", "revision_requested"].includes(detail.data.status) ? (
            <SubmitTaskDialog
              inline
              open
              crewId={task.crew.id}
              task={detail.data}
              onOpenChange={(open) => !open && onCloseAction()}
              onSubmitted={onCloseAction}
            />
          ) : null}
          <TaskContractLink crewId={task.crew.id} assetId={detail.data.contractAssetNodeId} />
          <TaskDeliverySummary task={detail.data} />
          {action === "review" && task.canReview && detail.data.status === "submitted" ? (
            <div className="space-y-4">
              <TaskReviewForm task={detail.data} onReviewed={onCloseAction} />
            </div>
          ) : null}
          {action === "feedback" ? <TaskFeedbackPanel task={detail.data} /> : null}
        </>
      ) : null}
      <section aria-label={t("history")}>
        <h3 className="mb-4 text-sm font-semibold">{t("history")}</h3>
        {timeline.isPending ? <p role="status">{t("loading")}</p> : null}
        {timeline.isError ? (
          <div role="alert">
            <p>{timeline.error.message}</p>
            <Button
              onClick={() =>
                void (timeline.isFetchNextPageError ? timeline.fetchNextPage() : timeline.refetch())
              }
            >
              {t("retry")}
            </Button>
          </div>
        ) : null}
        {!timeline.isError && !timeline.isPending && !events.length ? (
          <p className="text-sm text-muted-foreground">{t("emptyHistory")}</p>
        ) : null}
        {!timeline.isError || timeline.isFetchNextPageError ? (
          <ol className="ml-2 space-y-5 border-l border-white/15 pl-5">
            {events.map((event) => (
              <li key={event.id} className="relative text-sm">
                <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-sky-400" />
                <p>
                  <span className="font-medium">
                    {event.actorUserId
                      ? displayNameOf(event.actorUserId, displays)
                      : taskT("systemAssistant")}
                  </span>
                  {" · "}
                  {taskT(labels[event.kind] ?? "activity.changed", {
                    version: Number(event.payload.versionNumber ?? 1),
                  })}
                </p>
                <time dateTime={event.createdAt} className="text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString(locale)}
                </time>
                {event.body && !event.deletedAt ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                    {event.body}
                  </p>
                ) : null}
                {typeof event.payload.note === "string" ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                    {event.payload.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {timeline.hasNextPage && !timeline.isError ? (
          <Button
            className="mt-4"
            variant="outline"
            disabled={timeline.isFetchingNextPage}
            onClick={() => void timeline.fetchNextPage()}
          >
            {t("loadMoreHistory")}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
