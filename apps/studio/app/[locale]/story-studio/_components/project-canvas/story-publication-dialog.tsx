"use client";

import { IconAlertTriangle, IconCheck, IconCloudUpload, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
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
import { isStoryPublicationPending, type StoryPublicationState } from "./use-story-publication";
import type { StoryPublicationActivePhase } from "./story-publication-flow";

const PUBLICATION_PHASES = ["saving", "preparing", "submitting"] as const;

export function StoryPublicationDialog({
  state,
  draftRevision,
  canMutate,
  disabledReason,
  onClose,
  onConfirm,
  onRetry,
  onLocateNode,
}: {
  state: StoryPublicationState;
  draftRevision: number;
  canMutate: boolean;
  disabledReason: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onLocateNode?: (nodeId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  const { signIn } = useAuth();
  const pending = isStoryPublicationPending(state);
  const open = state.status !== "closed";
  const title = dialogTitle(state, t);
  const description = dialogDescription(state, t);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="rounded-[22px] bg-[oklch(0.205_0_0/0.98)] p-5 text-white shadow-[0_32px_100px_rgba(0,0,0,0.72)] sm:max-w-lg"
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
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-semibold tracking-[-0.01em] text-white">
            {title}
          </DialogTitle>
          <DialogDescription className="max-w-[46ch] text-xs leading-5 text-white/48">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div aria-live="polite">
          {state.status === "confirming" ? (
            <div className="rounded-2xl bg-white/[0.055] p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/72">
                  <IconCloudUpload className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/76">{t("confirmation.title")}</p>
                  <p className="mt-1 text-[11px] leading-5 text-white/42">
                    {t("confirmation.draftRevision", { revision: draftRevision })}
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-white/48">
                    {t("confirmation.detail")}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {isPublicationActivePhase(state.status) ? (
            <PublicationProgress phase={state.status} />
          ) : null}

          {state.status === "failed" ? (
            <>
              {state.errorKind ? (
                <p className="mb-3 text-xs leading-5 text-white/65">
                  {t(`actionError.${state.errorKind}`)}
                </p>
              ) : null}
              <PublicationFailure
                message={state.message}
                issues={state.issues ?? []}
                onLocateNode={onLocateNode}
              />
            </>
          ) : null}

          {state.status === "succeeded" ? (
            <div className="rounded-2xl bg-white/[0.055] p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-black">
                  <IconCheck className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/80">{t("success.version")}</p>
                  <p className="mt-1 text-[11px] leading-5 text-white/46">{t("success.detail")}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {state.status === "confirming" ? (
          <DialogFooter className="mt-1">
            <Button type="button" variant="secondary" size="xl" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary-cta"
              size="xl"
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
        ) : null}

        {state.status === "failed" ? (
          <DialogFooter className="mt-1">
            <Button type="button" variant="secondary" size="xl" onClick={onClose}>
              {t("actions.close")}
            </Button>
            {state.errorKind === "auth" ? (
              <Button type="button" variant="secondary" size="xl" onClick={signIn}>
                {t("statusError.signIn")}
              </Button>
            ) : null}
            {state.phase !== "permission" ? (
              <Button
                type="button"
                size="xl"
                disabled={!canMutate}
                title={disabledReason ?? undefined}
                onClick={() => {
                  if (canMutate) void onRetry();
                }}
              >
                {t("actions.retry")}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}

        {state.status === "succeeded" ? (
          <DialogFooter className="mt-1">
            <Button type="button" size="xl" onClick={onClose}>
              {t("actions.close")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PublicationProgress({ phase }: { phase: StoryPublicationActivePhase }) {
  const t = useTranslations("storyStudio.canvas.publish");
  const activeIndex = PUBLICATION_PHASES.indexOf(phase);

  return (
    <div className="space-y-1.5 rounded-2xl bg-white/[0.045] p-2">
      {PUBLICATION_PHASES.map((item, index) => {
        const complete = index < activeIndex;
        const active = item === phase;
        return (
          <div
            key={item}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
              active && "bg-white/[0.07]"
            )}
          >
            <div
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-white/28",
                complete && "bg-white text-black",
                active && "text-white/72"
              )}
            >
              {complete ? (
                <IconCheck className="size-3.5" />
              ) : active ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </div>
            <div className="min-w-0">
              <p className={cn("text-xs font-medium text-white/34", active && "text-white/78")}>
                {phaseTitle(item, t)}
              </p>
              {active ? (
                <p className="mt-0.5 text-[10px] leading-4 text-white/40">
                  {phaseDescription(item, t)}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PublicationFailure({
  message,
  issues,
  onLocateNode,
}: {
  message: string;
  issues: { message: string; nodeId: string | null }[];
  onLocateNode?: (nodeId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  const rows = issues.length > 0 ? issues : [{ message, nodeId: null }];
  return (
    <div className="space-y-2">
      {rows.map((issue) => (
        <div
          key={`${issue.nodeId ?? "release"}:${issue.message}`}
          className="flex items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-destructive"
        >
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs leading-5">{issue.message}</p>
            {issue.nodeId && onLocateNode ? (
              <button
                type="button"
                className="mt-2 text-[11px] font-semibold text-white/80 underline-offset-2 hover:underline"
                onClick={() => onLocateNode(issue.nodeId!)}
              >
                {t("failure.locate")}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

type PublicationT = ReturnType<typeof useTranslations<"storyStudio.canvas.publish">>;

function dialogTitle(state: StoryPublicationState, t: PublicationT): string {
  switch (state.status) {
    case "succeeded":
      return t("success.title");
    case "failed":
      return t("failure.title");
    case "saving":
    case "preparing":
    case "submitting":
      return t("progress.title");
    case "closed":
    case "confirming":
      return t("title");
  }
}

function dialogDescription(state: StoryPublicationState, t: PublicationT): string {
  switch (state.status) {
    case "succeeded":
      return t("success.description");
    case "failed":
      return t("failure.description");
    case "saving":
    case "preparing":
    case "submitting":
      return t("progress.description");
    case "closed":
    case "confirming":
      return t("description");
  }
}

function phaseTitle(phase: StoryPublicationActivePhase, t: PublicationT): string {
  switch (phase) {
    case "saving":
      return t("phases.saving.title");
    case "preparing":
      return t("phases.preparing.title");
    case "submitting":
      return t("phases.submitting.title");
  }
}

function phaseDescription(phase: StoryPublicationActivePhase, t: PublicationT): string {
  switch (phase) {
    case "saving":
      return t("phases.saving.description");
    case "preparing":
      return t("phases.preparing.description");
    case "submitting":
      return t("phases.submitting.description");
  }
}

function isPublicationActivePhase(
  value: StoryPublicationState["status"]
): value is StoryPublicationActivePhase {
  return value === "saving" || value === "preparing" || value === "submitting";
}
