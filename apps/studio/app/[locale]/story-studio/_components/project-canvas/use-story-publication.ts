"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  interactiveFilmPublicationQueryKey,
  prepareInteractiveFilmRelease,
  submitInteractiveFilmRelease,
} from "@/lib/interactive-film-api";
import {
  storyApiErrorMessage,
  storyApiErrorIssues,
  type StoryApiIssue,
  type StoryCapability,
} from "@/lib/story-projects-api";
import {
  runStoryPublication,
  StoryPublicationFlowError,
  type StoryPublicationActivePhase,
  type StoryPublicationErrorCode,
  type StoryPublicationFlowResult,
} from "./story-publication-flow";

export type SavedDraftSnapshotRunner = <T>(
  submit: (expectedDraftRevision: number) => Promise<T>
) => Promise<T>;

export type StoryPublicationFailureCode =
  | StoryPublicationErrorCode
  | "PERMISSION_DENIED"
  | "UNEXPECTED";

export type StoryPublicationState =
  | { status: "closed" }
  | { status: "confirming" }
  | { status: StoryPublicationActivePhase }
  | ({ status: "succeeded" } & StoryPublicationFlowResult)
  | {
      status: "failed";
      phase: StoryPublicationActivePhase | "permission";
      code: StoryPublicationFailureCode;
      message: string;
      /** Structured blockers the server attached to the failure, if any. */
      issues: StoryApiIssue[];
    };

export interface UseStoryPublicationOptions {
  projectId: string;
  capabilities: readonly StoryCapability[];
  expectedVideoSnapshotHash: string | null;
  withSavedDraftSnapshot: SavedDraftSnapshotRunner;
}

const REQUIRED_CAPABILITIES = [
  "story.edit",
  "story.build",
  "story.release",
] as const satisfies readonly StoryCapability[];

export function useStoryPublication({
  projectId,
  capabilities,
  expectedVideoSnapshotHash,
  withSavedDraftSnapshot,
}: UseStoryPublicationOptions) {
  const t = useTranslations("storyStudio.canvas.publish");
  const queryClient = useQueryClient();
  const [state, setState] = useState<StoryPublicationState>({ status: "closed" });
  const runningRef = useRef(false);

  const missingCapabilities = useMemo(
    () => REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability)),
    [capabilities]
  );
  const canSubmit = missingCapabilities.length === 0;
  const disabledReason = missingCapabilities.length > 0 ? t("errors.permissionDenied") : null;

  const open = useCallback(() => {
    if (runningRef.current) return;
    if (missingCapabilities.length > 0) {
      setState({
        status: "failed",
        phase: "permission",
        code: "PERMISSION_DENIED",
        message: t("errors.permissionDenied"),
        issues: [],
      });
      return;
    }
    setState({ status: "confirming" });
  }, [missingCapabilities.length, t]);

  const close = useCallback(() => {
    if (!runningRef.current) setState({ status: "closed" });
  }, []);

  const execute = useCallback(async () => {
    if (runningRef.current) return;
    if (missingCapabilities.length > 0) {
      open();
      return;
    }
    if (!expectedVideoSnapshotHash || !/^[a-f0-9]{64}$/.test(expectedVideoSnapshotHash)) {
      setState({
        status: "failed",
        phase: "permission",
        code: "UNEXPECTED",
        message: t("errors.unexpected"),
        issues: [],
      });
      return;
    }

    runningRef.current = true;
    let currentPhase: StoryPublicationActivePhase = "saving";
    let result: StoryPublicationFlowResult;
    try {
      result = await runStoryPublication({
        saveDraftSnapshot: () =>
          withSavedDraftSnapshot(async (expectedDraftRevision) => expectedDraftRevision),
        prepareRelease: (expectedDraftRevision) =>
          prepareInteractiveFilmRelease(projectId, {
            expectedDraftRevision,
            expectedVideoSnapshotHash,
          }),
        submitRelease: (release) => submitInteractiveFilmRelease(projectId, release),
        onPhaseChange: (phase) => {
          currentPhase = phase;
          setState({ status: phase });
        },
      });
    } catch (error) {
      runningRef.current = false;
      setState(toPublicationFailure(error, currentPhase, t));
      return;
    }

    queryClient.setQueryData(interactiveFilmPublicationQueryKey(projectId), result.publication);
    const refreshes = [
      queryClient.invalidateQueries({ queryKey: ["story-studio", "workbench", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["story-studio", "chapter-workbench", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["story-studio", "script-workbench", projectId] }),
      queryClient.invalidateQueries({ queryKey: interactiveFilmPublicationQueryKey(projectId) }),
    ];
    runningRef.current = false;
    setState({ status: "succeeded", ...result });
    void Promise.allSettled(refreshes);
  }, [
    expectedVideoSnapshotHash,
    missingCapabilities.length,
    open,
    projectId,
    queryClient,
    t,
    withSavedDraftSnapshot,
  ]);

  return {
    state,
    isPending: isStoryPublicationPending(state),
    canSubmit,
    disabledReason,
    open,
    close,
    confirm: execute,
    retry: execute,
  };
}

export function isStoryPublicationPending(state: StoryPublicationState): boolean {
  return state.status === "saving" || state.status === "preparing" || state.status === "submitting";
}

function toPublicationFailure(
  error: unknown,
  currentPhase: StoryPublicationActivePhase,
  t: ReturnType<typeof useTranslations<"storyStudio.canvas.publish">>
): Extract<StoryPublicationState, { status: "failed" }> {
  if (!(error instanceof StoryPublicationFlowError)) {
    return {
      status: "failed",
      phase: currentPhase,
      code: "UNEXPECTED",
      message: storyApiErrorMessage(error, t("errors.unexpected")),
      issues: storyApiErrorIssues(error),
    };
  }
  const fallback = publicationErrorFallback(error.code, t);
  return {
    status: "failed",
    phase: error.phase,
    code: error.code,
    message:
      error.upstreamError === undefined
        ? fallback
        : storyApiErrorMessage(error.upstreamError, fallback),
    issues: storyApiErrorIssues(error.upstreamError),
  };
}

function publicationErrorFallback(
  code: StoryPublicationErrorCode,
  t: ReturnType<typeof useTranslations<"storyStudio.canvas.publish">>
): string {
  switch (code) {
    case "SAVE_FAILED":
      return t("errors.saveFailed");
    case "PREPARE_FAILED":
      return t("errors.prepareFailed");
    case "SUBMIT_FAILED":
      return t("errors.submitFailed");
    case "SUBMIT_STATUS_INVALID":
      return t("errors.submitStatusInvalid");
  }
}
