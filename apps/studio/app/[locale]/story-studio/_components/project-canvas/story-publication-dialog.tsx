"use client";

import {
  IconAlertTriangle,
  IconCheck,
  IconCloudOff,
  IconCloudUpload,
  IconLoader2,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import type { StoryPublicationErrorKind } from "../../_lib/story-publication-errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { StoryPublicationIssue, StoryPublicationState } from "./use-story-publication";
import type { StoryPublicationActivePhase } from "./story-publication-flow";

const PUBLICATION_PHASES = ["saving", "preparing", "submitting"] as const;

/** Publication details own progress and errors; this dialog only confirms submission. */
export function StoryPublicationDialog({
  state,
  draftRevision,
  canMutate,
  disabledReason,
  onClose,
  onConfirm,
  onCloseAutoFocus,
}: {
  state: StoryPublicationState;
  draftRevision: number;
  canMutate: boolean;
  disabledReason: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  return (
    <Dialog open={state.status === "confirming"} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-sm font-medium text-white/80">{t("confirmation.title")}</p>
          <p className="text-xs text-white/45">
            {t("confirmation.draftRevision", { revision: draftRevision })}
          </p>
          <p className="text-xs leading-5 text-white/55">{t("confirmation.detail")}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canMutate}
            title={disabledReason ?? undefined}
            onClick={() => {
              if (canMutate) void onConfirm();
            }}
          >
            <IconCloudUpload className="size-4" />
            {t("actions.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StoryPublicationProgress({ phase }: { phase: StoryPublicationActivePhase }) {
  const t = useTranslations("storyStudio.canvas.publish");
  const activeIndex = PUBLICATION_PHASES.indexOf(phase);
  return (
    <div aria-live="polite" className="space-y-1 py-2">
      {PUBLICATION_PHASES.map((item, index) => {
        const complete = index < activeIndex;
        const active = item === phase;
        return (
          <div
            key={item}
            aria-current={active ? "step" : undefined}
            className="flex items-start gap-3 py-2"
          >
            <div
              className={cn(
                "mt-0.5 grid size-6 shrink-0 place-items-center text-white/25",
                complete && "text-white/70",
                active && "text-white"
              )}
            >
              {complete ? (
                <IconCheck className="size-4" />
              ) : active ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </div>
            <div>
              <p className={cn("text-sm text-white/35", active && "font-medium text-white/85")}>
                {t(`phases.${item}.title`)}
              </p>
              {active ? (
                <p className="mt-1 text-xs leading-5 text-white/45">
                  {t(`phases.${item}.description`)}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StoryPublicationFailure({
  message,
  issues,
  errorKind,
  onLocateIssue,
}: {
  message: string;
  issues: readonly StoryPublicationIssue[];
  errorKind?: StoryPublicationErrorKind | null;
  onLocateIssue?: (issue: StoryPublicationIssue) => void;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  const { signIn } = useAuth();
  const rows: readonly StoryPublicationIssue[] = issues.length
    ? issues
    : [{ message, nodeId: null }];
  return (
    <div role="alert" className="space-y-4 py-2">
      {errorKind ? (
        <p className="text-xs leading-5 text-white/65">{t(`actionError.${errorKind}`)}</p>
      ) : null}
      {rows.map((issue, index) => (
        <div
          key={`${issue.chapterId ?? "project"}:${issue.nodeId ?? "release"}:${index}`}
          className="flex items-start gap-3"
        >
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            {issue.chapterTitle ? (
              <p className="mb-1 text-xs text-white/50">{issue.chapterTitle}</p>
            ) : null}
            <p className="break-words text-sm leading-6 text-destructive">{issue.message}</p>
            {(issue.nodeId || issue.chapterId) && onLocateIssue ? (
              <button
                type="button"
                className="mt-2 text-xs font-medium text-white/75 underline underline-offset-4 hover:text-white"
                onClick={() => onLocateIssue(issue)}
              >
                {t("failure.locate")}
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {errorKind === "auth" ? (
        <Button type="button" variant="secondary" onClick={signIn}>
          {t("statusError.signIn")}
        </Button>
      ) : null}
    </div>
  );
}

export function StoryPublicationOfflineDialog({
  open,
  pending,
  mode = "offline",
  onClose,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  pending: boolean;
  mode?: "withdraw" | "offline";
  onClose: () => void;
  onConfirm: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        onCloseAutoFocus={onCloseAutoFocus}
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${mode}.title`)}</DialogTitle>
          <DialogDescription>{t(`${mode}.description`)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconCloudOff className="size-4" />
            )}
            {t(`${mode}.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
