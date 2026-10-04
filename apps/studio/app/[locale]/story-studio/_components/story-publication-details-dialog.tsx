"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  IconCheck,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import { useSiteRegion } from "@/app/_components/region-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getWebBaseUrl } from "@/lib/web-base";
import { storyApiErrorMessage, type StoryWorkbench } from "@/lib/story-projects-api";
import { missingPublicationFields } from "../_lib/story-publication-draft";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryFilmDetailsEditor } from "./story-film-details-editor";
import { useStoryPublicationDraft } from "./use-story-publication-draft";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";
import { useStoryProjectPublication } from "./project-canvas/use-story-project-publication";
import { StoryPublicationStatus } from "./project-canvas/story-publication-status";
import {
  StoryPublicationDialog,
  StoryPublicationFailure,
  StoryPublicationOfflineDialog,
  StoryPublicationProgress,
} from "./project-canvas/story-publication-dialog";
import type { StoryPublicationIssue } from "./project-canvas/use-story-publication";

interface PublicationDetailsDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  workbench: StoryWorkbench | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function StoryPublicationDetailsDialog(props: PublicationDetailsDialogProps) {
  const t = useTranslations("storyStudio.publication");
  const { user, loading: authLoading, signIn } = useAuth();
  if (authLoading || (user && props.loading && !props.workbench))
    return (
      <PublicationMessageDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <IconLoader2 className="size-6 animate-spin" />
        <p>{t("loading")}</p>
      </PublicationMessageDialog>
    );
  if (!user)
    return (
      <PublicationMessageDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <p>{t("signInRequired")}</p>
        <Button onClick={signIn}>{t("signIn")}</Button>
      </PublicationMessageDialog>
    );
  if (!props.workbench)
    return (
      <PublicationMessageDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <p role="alert">{storyApiErrorMessage(props.error, t("loadFailed"))}</p>
        <Button variant="secondary" onClick={props.onRetry}>
          {t("retry")}
        </Button>
      </PublicationMessageDialog>
    );
  return (
    <AccountPublicationDialog
      key={`${user.id}:${props.projectId}`}
      projectId={props.projectId}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onCloseAutoFocus={props.onCloseAutoFocus}
      workbench={props.workbench}
      refresh={props.onRetry}
      loadError={props.error ? storyApiErrorMessage(props.error, t("loadFailed")) : null}
    />
  );
}

function AccountPublicationDialog({
  projectId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  workbench,
  refresh,
  loadError,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  workbench: StoryWorkbench;
  refresh: () => void;
  loadError: string | null;
}) {
  const t = useTranslations("storyStudio.publication");
  const publishT = useTranslations("storyStudio.canvas.publish");
  const commonT = useTranslations("common");
  const { user, signIn, isCurrentAccount } = useAuth();
  const userId = user?.id ?? null;
  const router = useRouter();
  const locale = useLocale();
  const region = useSiteRegion();
  const draft = useStoryPublicationDraft(projectId, workbench);
  const management = useStoryProjectPublication({
    projectId,
    workbench,
    beforePrepareRelease: draft.prepareSnapshot,
    enabled: open,
  });
  const { submission, status, publication } = management;
  const state = submission.state;
  const candidates = useStoryCandidateAssets({
    projectId,
    canEdit: draft.canEdit,
    enabled: open && management.canRead,
  });
  const [navigating, setNavigating] = useState(false);
  const [saved, setSaved] = useState(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const detailsContentRef = useRef<HTMLDivElement>(null);
  const draftBarrier = useStoryProjectUiStore((store) => store.draftBarrier);
  const draftBarrierRef = useRef(draftBarrier);
  const ownerRef = useRef<{ active: boolean; navigating: boolean } | null>(null);
  useLayoutEffect(() => {
    draftBarrierRef.current = draftBarrier;
  }, [draftBarrier]);
  useLayoutEffect(() => {
    const owner = { active: true, navigating: false };
    ownerRef.current = owner;
    return () => {
      owner.active = false;
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [projectId, userId]);
  const pending =
    draft.saving || submission.isPending || management.offlineMutation.isPending || navigating;
  const missing = missingPublicationFields(draft.value);
  const emptyChapters = workbench.chapters.filter(
    (chapter) => !chapter.entryNodeId || !chapter.nodeCount
  );
  const invalidMedia = [
    draft.value.listing.trailerAssetId,
    ...draft.value.listing.screenshotAssetIds,
    draft.value.coverAssetId,
  ]
    .filter((id): id is string => Boolean(id))
    .filter((id) => {
      const asset =
        candidates.items.find((candidate) => candidate.asset.id === id)?.asset ??
        (workbench.project.cover?.id === id ? workbench.project.cover : null);
      return (
        !asset ||
        asset.status !== "ready" ||
        asset.moderationStatus === "blocked" ||
        asset.kind !== (id === draft.value.listing.trailerAssetId ? "video" : "image")
      );
    });
  const blockedReason =
    management.disabledReason ??
    (draft.conflicted
      ? t("conflict")
      : !draft.valid
        ? t("invalidDraft")
        : missing.length
          ? t("completeFields")
          : emptyChapters.length
            ? t("completeChapters")
            : candidates.loading
              ? t("mediaChecking")
              : candidates.failed
                ? t("details.candidateLoadError")
                : invalidMedia.length
                  ? t("mediaUnavailable")
                  : null);
  const canSubmit = management.canSubmit && !pending && !blockedReason;
  const dismissBlocked = pending || state.status === "confirming" || management.offlineIntent;
  const close = () => {
    if (!dismissBlocked) onOpenChange(false);
  };
  const returnToPrimaryAction = (event: Event) => {
    const target = primaryActionRef.current?.disabled
      ? detailsContentRef.current
      : (primaryActionRef.current ?? detailsContentRef.current);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };
  const navigate = async (href: string) => {
    const owner = ownerRef.current;
    if (!owner || pending || owner.navigating || userId === null) return;
    const isCurrent = () => ownerRef.current === owner && owner.active && isCurrentAccount(userId);
    if (!isCurrent()) return;
    owner.navigating = true;
    setNavigating(true);
    try {
      if (draft.canEdit && draft.dirty) await draft.save();
      if (!isCurrent()) return;
      const currentBarrier = draftBarrierRef.current;
      if (currentBarrier) await currentBarrier(async () => undefined);
      if (!isCurrent()) return;
      onOpenChange(false);
      router.push(href);
    } catch (error) {
      if (isCurrent() && !(error instanceof Error && error.name === "AbortError"))
        toast.error(storyApiErrorMessage(error, t("saveFailed")));
    } finally {
      if (isCurrent()) {
        owner.navigating = false;
        setNavigating(false);
      }
    }
  };
  const save = async () => {
    try {
      await draft.save();
      setSaved(true);
    } catch {
      /* Draft hook exposes the actionable error. */
    }
  };
  const locate = (issue: StoryPublicationIssue) => {
    const search = new URLSearchParams({ chapter: issue.chapterId ?? workbench.chapter.id });
    if (issue.nodeId) search.set("focus", issue.nodeId);
    void navigate(`/story-studio/projects/${encodeURIComponent(projectId)}/canvas?${search}`);
  };
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent
        ref={detailsContentRef}
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onEscapeKeyDown={(event) => {
          if (dismissBlocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (dismissBlocked) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (dismissBlocked) event.preventDefault();
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] p-5 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-lg font-semibold">{t("title")}</DialogTitle>
              {management.canRead ? (
                <StoryPublicationStatus
                  publication={publication}
                  pending={management.publicationQuery.isPending}
                  error={management.publicationQuery.error}
                  refetching={management.publicationQuery.isFetching}
                  onRetry={() => void management.publicationQuery.refetch()}
                  onSignIn={signIn}
                />
              ) : null}
            </div>
            <DialogDescription className="mt-1 truncate text-xs text-white/40">
              {workbench.project.title}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span aria-live="polite" className="text-xs text-white/40">
              {draft.saving
                ? t("saving")
                : draft.dirty
                  ? t("unsaved")
                  : saved
                    ? t("saved")
                    : t("draftSaved")}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot="publication-details-close"
              aria-label={commonT("close")}
              disabled={dismissBlocked}
              onClick={close}
              className="size-8 rounded-lg bg-white/[0.06] text-white/55 hover:bg-white/[0.12] hover:text-white"
            >
              <IconX className="size-4" />
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-6 p-5 sm:p-6">
            <div className="min-w-0 space-y-6">
              {loadError ? (
                <Notice
                  message={loadError}
                  action={
                    <Button variant="secondary" onClick={() => void refresh()}>
                      {t("retry")}
                    </Button>
                  }
                />
              ) : null}
              {!draft.canEdit ? <Notice message={t("editDenied")} /> : null}
              {draft.conflicted ? (
                <Notice
                  message={t("conflict")}
                  action={
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void draft.refreshAndKeepDraft().catch(() => {})}
                    >
                      {t("keepDraft")}
                    </Button>
                  }
                />
              ) : null}
              {draft.error ? <Notice message={draft.error} /> : null}
              {management.canRead && management.publicationQuery.isError ? (
                <Notice
                  message={management.statusErrorReason ?? publishT("statusUnavailable")}
                  action={
                    <div className="flex flex-wrap gap-2">
                      {management.statusErrorKind === "auth" ? (
                        <Button variant="secondary" onClick={signIn}>
                          {publishT("statusError.signIn")}
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        disabled={management.publicationQuery.isFetching}
                        onClick={() => void management.publicationQuery.refetch()}
                      >
                        {t("retry")}
                      </Button>
                    </div>
                  }
                />
              ) : null}
              {publication?.rejectReason ? (
                <section className="rounded-2xl bg-white/[0.045] p-5">
                  <h2 className="text-sm font-medium">{t("reviewFeedback")}</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/65">
                    {publication.rejectReason}
                  </p>
                </section>
              ) : null}
              {status === "reviewing" || status === "published" || status === "offline" ? (
                <section className="rounded-2xl bg-white/[0.035] p-5">
                  <h2 className="text-sm font-medium">{t(`state.${status}.title`)}</h2>
                  <p className="mt-2 text-sm leading-6 text-white/50">
                    {t(`state.${status}.description`)}
                  </p>
                  {status === "published" ? (
                    <a
                      className="mt-3 inline-flex items-center gap-2 text-sm text-white/75 underline underline-offset-4"
                      href={`${getWebBaseUrl(region)}/${locale}/play/interactive-film/${encodeURIComponent(publication!.gameId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("viewPublished")}
                      <IconExternalLink className="size-4" />
                    </a>
                  ) : null}
                </section>
              ) : null}
              <StoryFilmDetailsEditor
                projectId={projectId}
                value={draft.value}
                onChange={(value) => {
                  setSaved(false);
                  draft.update(value);
                }}
                cover={workbench.project.cover}
                candidates={candidates}
                disabled={!draft.canEdit || pending}
              />
            </div>
            <div className="space-y-5">
              <section className="space-y-3 border-t border-white/[0.07] pt-5">
                <div>
                  <h2 className="text-sm font-medium">{t("checksTitle")}</h2>
                  <p className="mt-1 text-xs leading-5 text-white/40">{t("checksDescription")}</p>
                </div>
                <ul className="flex flex-wrap gap-x-5 gap-y-3">
                  {(["cover", "description"] as const).map((field) => (
                    <li key={field} className="flex items-center gap-3 text-sm">
                      <span
                        className={`grid size-5 place-items-center rounded-full ${missing.includes(field) ? "bg-white/[0.07] text-white/25" : "bg-white/[0.1] text-white/75"}`}
                      >
                        {missing.includes(field) ? (
                          <span className="size-1 rounded-full bg-current" />
                        ) : (
                          <IconCheck className="size-3.5" />
                        )}
                      </span>
                      <span className="text-white/60">{t(`details.${field}`)}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1">
                  <p className="text-xs text-white/50">
                    {emptyChapters.length
                      ? t("chaptersIncomplete", { count: emptyChapters.length })
                      : t("chaptersReady", { count: workbench.chapters.length })}
                  </p>
                  {emptyChapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void navigate(
                          `/story-studio/projects/${encodeURIComponent(projectId)}/canvas?${new URLSearchParams({ chapter: chapter.id })}`
                        )
                      }
                      className="mt-2 flex w-full items-center justify-between gap-2 text-sm text-white/65 hover:text-white"
                    >
                      {chapter.title}
                      <IconChevronRight className="size-4" />
                    </button>
                  ))}
                </div>
              </section>
              {state.status === "saving" ||
              state.status === "preparing" ||
              state.status === "submitting" ? (
                <StoryPublicationProgress phase={state.status} />
              ) : null}
              {state.status === "failed" ? (
                <section className="rounded-2xl bg-white/[0.035] p-5">
                  <StoryPublicationFailure
                    message={state.message}
                    errorKind={state.errorKind}
                    issues={state.issues ?? []}
                    onLocateIssue={locate}
                  />
                  <Button
                    variant="secondary"
                    disabled={!canSubmit}
                    onClick={() => void submission.retry()}
                  >
                    {t("retrySubmission")}
                  </Button>
                </section>
              ) : null}
              {state.status === "succeeded" ? (
                <p role="status" className="text-sm text-white/70">
                  {t("submitted")}
                </p>
              ) : null}
            </div>
          </div>
        </main>
        <footer className="shrink-0 border-t border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 text-xs leading-5 text-white/40">
              <p>{blockedReason ?? t("submitHint")}</p>
              {draft.dirty ? <p>{t("closeDraftHint")}</p> : null}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3">
              <Button
                variant="secondary"
                disabled={
                  !draft.canEdit || !draft.dirty || !draft.valid || draft.conflicted || pending
                }
                onClick={() => void save()}
                loading={draft.saving}
              >
                {t("saveDraft")}
              </Button>
              {management.canOffline ? (
                <Button
                  ref={primaryActionRef}
                  variant="secondary"
                  disabled={pending}
                  onClick={management.openOffline}
                >
                  {t(status === "reviewing" ? "withdraw" : "offline")}
                </Button>
              ) : (
                <Button
                  ref={primaryActionRef}
                  variant="primary-cta"
                  disabled={!canSubmit}
                  onClick={submission.open}
                >
                  {t("submit")}
                </Button>
              )}
            </div>
          </div>
        </footer>
      </DialogContent>
      <StoryPublicationDialog
        state={state}
        draftRevision={management.draftRevision}
        canMutate={canSubmit}
        disabledReason={blockedReason}
        onClose={submission.close}
        onConfirm={submission.confirm}
        onCloseAutoFocus={returnToPrimaryAction}
      />
      <StoryPublicationOfflineDialog
        mode={status === "reviewing" ? "withdraw" : "offline"}
        open={management.offlineIntent}
        pending={management.offlineMutation.isPending}
        onClose={management.closeOffline}
        onConfirm={() => management.offlineMutation.mutate()}
        onCloseAutoFocus={returnToPrimaryAction}
      />
    </Dialog>
  );
}

function Notice({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.045] p-4 text-sm leading-6 text-destructive"
    >
      <p>{message}</p>
      {action}
    </div>
  );
}
function PublicationMessageDialog({
  children,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("storyStudio.publication");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("details.introDescription")}</DialogDescription>
        <div className="flex min-h-40 flex-col items-center justify-center gap-4 p-4 text-center text-sm text-white/60">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
