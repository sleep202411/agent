"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import {
  getInteractiveFilmPublication,
  interactiveFilmPublicationQueryKey,
  offlineInteractiveFilm,
  type InteractiveFilmPublication,
} from "@/lib/interactive-film-api";
import { storyApiErrorMessage, type StoryWorkbench } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../../_stores/story-project-ui-store";
import {
  storyPublicationActionErrorKind,
  storyPublicationErrorKind,
} from "../../_lib/story-publication-errors";
import { useStoryPublication } from "./use-story-publication";

/** Publication operations for the project's publishing controls. */
export function useStoryProjectPublication({
  projectId,
  workbench,
  beforePrepareRelease,
  enabled = true,
}: {
  projectId: string;
  workbench: StoryWorkbench | null;
  beforePrepareRelease?: () => Promise<StoryWorkbench | void>;
  enabled?: boolean;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  const { user, isCurrentAccount } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const [offlineIntent, setOfflineIntent] = useState(false);
  const liveDraft = useStoryProjectUiStore((state) => state.liveDraft);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const canRead = Boolean(workbench?.project.capabilities.includes("story.read"));
  const canRelease = Boolean(workbench?.project.capabilities.includes("story.release"));
  const publicationKey = interactiveFilmPublicationQueryKey(projectId, userId);
  const publicationQuery = useQuery({
    queryKey: publicationKey,
    queryFn: ({ signal }) => getInteractiveFilmPublication(projectId, signal),
    enabled: enabled && canRead && userId != null,
    retry: 1,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchOnWindowFocus: true,
  });
  const publication = canRead ? (publicationQuery.data ?? null) : null;
  const status = publication?.status ?? null;
  const statusErrorKind = publicationQuery.isError
    ? storyPublicationErrorKind(publicationQuery.error)
    : null;
  const statusErrorReason = statusErrorKind
    ? `${t(`statusError.${statusErrorKind}.guidance`)} ${storyApiErrorMessage(
        publicationQuery.error,
        t("statusError.service.guidance")
      )}`
    : null;
  const statusBlockedReason = !workbench
    ? t("projectLoading")
    : liveDraft?.conflicted
      ? t("draftConflict")
      : canRead && publicationQuery.isPending
        ? t("statusChecking")
        : canRead && publicationQuery.isError
          ? statusErrorReason
          : status === "reviewing"
            ? t("reviewingLocked")
            : status === "published"
              ? t("publishedUpdateLocked")
              : null;
  const readPublicationStatus = useCallback(
    (signal: AbortSignal) => getInteractiveFilmPublication(projectId, signal),
    [projectId]
  );
  const submission = useStoryPublication({
    projectId,
    capabilities: workbench?.project.capabilities ?? [],
    expectedProjectVersion: workbench?.project.projectVersion ?? null,
    expectedDraftRevision: liveDraft?.revision ?? workbench?.draft.revision ?? null,
    expectedVideoSnapshotHash:
      liveDraft?.videoSnapshotHash ?? workbench?.video.snapshotHash ?? null,
    withSavedDraftSnapshot: draftBarrier ?? undefined,
    beforePrepareRelease,
    submitBlockedReason: statusBlockedReason,
    readPublicationStatus,
  });

  const canOffline =
    canRelease && !publicationQuery.isError && (status === "reviewing" || status === "published");
  const offlineOwner = useRef<{
    controller: AbortController;
    running: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const owner = { controller: new AbortController(), running: false };
    offlineOwner.current = owner;
    return () => {
      owner.controller.abort();
      if (offlineOwner.current === owner) offlineOwner.current = null;
    };
  }, [projectId, userId, canRelease]);
  const offlineMutation = useMutation({
    onMutate: () => offlineOwner.current,
    mutationFn: async () => {
      const owner = offlineOwner.current;
      if (
        !canOffline ||
        submission.isPending ||
        !owner ||
        !owner.running ||
        owner.controller.signal.aborted ||
        userId == null ||
        !isCurrentAccount(userId)
      ) {
        throw new DOMException("Publication action abandoned", "AbortError");
      }
      try {
        const next = await offlineInteractiveFilm(projectId, owner.controller.signal);
        if (next.status !== "offline") throw new Error(t("errors.offlineFailed"));
        return { next, owner };
      } catch (failure) {
        if (
          owner === offlineOwner.current &&
          !owner.controller.signal.aborted &&
          isCurrentAccount(userId)
        ) {
          try {
            // A completed status change must survive a failed follow-up GET.
            const next = await getInteractiveFilmPublication(projectId, owner.controller.signal);
            if (
              owner === offlineOwner.current &&
              !owner.controller.signal.aborted &&
              isCurrentAccount(userId) &&
              next?.status === "offline"
            )
              return { next, owner };
          } catch {
            // Preserve the original action error when its outcome is still unknown.
          }
        }
        throw failure;
      }
    },
    onSuccess: ({ next, owner }) => {
      if (
        owner !== offlineOwner.current ||
        owner.controller.signal.aborted ||
        userId == null ||
        !isCurrentAccount(userId)
      )
        return;
      queryClient.setQueryData<InteractiveFilmPublication>(publicationKey, next);
      setOfflineIntent(false);
      toast.success(t("offline.success"));
      void queryClient.invalidateQueries({ queryKey: publicationKey });
    },
    onError: (error, _variables, owner) => {
      if (
        owner === offlineOwner.current &&
        owner &&
        !owner.controller.signal.aborted &&
        userId != null &&
        isCurrentAccount(userId) &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        const kind = storyPublicationActionErrorKind(error);
        const detail = storyApiErrorMessage(error, t("errors.offlineFailed"));
        toast.error(kind ? `${t(`actionError.${kind}`)} ${detail}` : detail);
      }
    },
    onSettled: (_data, _error, _variables, owner) => {
      if (owner) owner.running = false;
    },
  });
  // Drop an idle confirmation as soon as its permission or verified state is
  // lost. An accepted request remains visible until its outcome settles.
  if (offlineIntent && !canOffline && !offlineMutation.isPending) setOfflineIntent(false);
  const mutateOffline = offlineMutation.mutate;
  const confirmOffline = useCallback(() => {
    const owner = offlineOwner.current;
    if (
      !canOffline ||
      submission.isPending ||
      !owner ||
      owner.running ||
      owner.controller.signal.aborted ||
      userId == null ||
      !isCurrentAccount(userId)
    )
      return;
    // Set synchronously so two clicks cannot enqueue independent requests.
    owner.running = true;
    mutateOffline();
  }, [canOffline, isCurrentAccount, mutateOffline, submission.isPending, userId]);
  const openOffline = useCallback(() => {
    if (canOffline && !submission.isPending && !offlineOwner.current?.running) {
      setOfflineIntent(true);
    }
  }, [canOffline, submission.isPending]);
  const closeOffline = useCallback(() => {
    if (!offlineOwner.current?.running) setOfflineIntent(false);
  }, []);

  return {
    publication,
    status,
    publicationQuery,
    submission,
    draftRevision: liveDraft?.revision ?? workbench?.draft.revision ?? 0,
    canSubmit: submission.canSubmit && !offlineMutation.isPending,
    disabledReason: submission.disabledReason,
    canRead,
    statusErrorKind,
    statusErrorReason,
    canOffline,
    offlineIntent,
    offlineMutation: {
      isPending: offlineMutation.isPending,
      mutate: confirmOffline,
    },
    openOffline,
    closeOffline,
  };
}
