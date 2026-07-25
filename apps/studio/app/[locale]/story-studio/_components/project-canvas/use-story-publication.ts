"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  createStoryBuild,
  getStoryWorkbench,
  publishStoryBuild,
  storyApiErrorMessage,
  type ExperienceReleaseResult,
  type StoryBuild,
  type StoryBuildDiagnostic,
  type StoryCapability,
  type StoryExperienceCurrentRelease,
} from "@/lib/story-projects-api";
import {
  runStoryPublication,
  StoryPublicationFlowError,
  type StoryPublicationActivePhase,
  type StoryPublicationErrorCode,
  type StoryPublicationFlowResult,
} from "./story-publication-flow";
import { StorySubmissionKeyRegistry } from "./story-submission-key-registry";

export type SavedDraftSnapshotRunner = <T>(
  submit: (expectedDraftRevision: number) => Promise<T>
) => Promise<T>;

export type StoryPublicationFailureCode =
  | StoryPublicationErrorCode
  | "WORKSPACE_REQUIRED"
  | "PERMISSION_DENIED"
  | "UNEXPECTED";

export type StoryPublicationState =
  | { status: "closed" }
  | { status: "confirming" }
  | { status: StoryPublicationActivePhase }
  | {
      status: "succeeded";
      sourceDraftRevision: number;
      build: StoryBuild;
      release: ExperienceReleaseResult;
    }
  | {
      status: "failed";
      phase: StoryPublicationActivePhase | "permission";
      code: StoryPublicationFailureCode;
      message: string;
      diagnostics: StoryBuildDiagnostic[];
    };

export interface UseStoryPublicationOptions {
  workspaceId: string | null;
  projectId: string;
  capabilities: readonly StoryCapability[];
  withSavedDraftSnapshot: SavedDraftSnapshotRunner;
  onPublished?: (result: StoryPublicationFlowResult) => void | Promise<void>;
}

const REQUIRED_CAPABILITIES = [
  "story.edit",
  "story.build",
  "story.release",
] as const satisfies readonly StoryCapability[];

export function useStoryPublication({
  workspaceId,
  projectId,
  capabilities,
  withSavedDraftSnapshot,
  onPublished,
}: UseStoryPublicationOptions) {
  const t = useTranslations("storyStudio.canvas.publish");
  const queryClient = useQueryClient();
  const [state, setState] = useState<StoryPublicationState>({ status: "closed" });
  const [lastSucceeded, setLastSucceeded] = useState<StoryPublicationFlowResult | null>(null);
  const runningRef = useRef(false);
  const publicationSubmissionKeys = useMemo(
    () =>
      new StorySubmissionKeyRegistry(
        `story-publication:${workspaceId ?? "no-workspace"}:${projectId}`,
        () => {
          try {
            return globalThis.window?.sessionStorage ?? null;
          } catch {
            return null;
          }
        }
      ),
    [projectId, workspaceId]
  );

  const missingCapabilities = useMemo(
    () => REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability)),
    [capabilities]
  );
  const canPublish = Boolean(workspaceId) && missingCapabilities.length === 0;
  const disabledReason = !workspaceId
    ? t("errors.workspaceRequired")
    : missingCapabilities.length > 0
      ? t("errors.permissionDenied")
      : null;

  const open = useCallback(() => {
    if (runningRef.current) return;
    if (!workspaceId) {
      setState({
        status: "failed",
        phase: "permission",
        code: "WORKSPACE_REQUIRED",
        message: t("errors.workspaceRequired"),
        diagnostics: [],
      });
      return;
    }
    if (missingCapabilities.length > 0) {
      setState({
        status: "failed",
        phase: "permission",
        code: "PERMISSION_DENIED",
        message: t("errors.permissionDenied"),
        diagnostics: [],
      });
      return;
    }
    setState({ status: "confirming" });
  }, [missingCapabilities.length, t, workspaceId]);

  const close = useCallback(() => {
    if (!runningRef.current) setState({ status: "closed" });
  }, []);

  const execute = useCallback(async () => {
    if (runningRef.current) return;
    if (!workspaceId || missingCapabilities.length > 0) {
      open();
      return;
    }

    runningRef.current = true;
    let currentPhase: StoryPublicationActivePhase = "saving";
    let result: StoryPublicationFlowResult;
    try {
      result = await runStoryPublication({
        saveDraftSnapshot: () =>
          withSavedDraftSnapshot(async (expectedDraftRevision) => expectedDraftRevision),
        loadWorkbench: () => getStoryWorkbench(workspaceId, projectId),
        createProductionBuild: (input, idempotencyKey) =>
          createStoryBuild(workspaceId, projectId, input, idempotencyKey),
        publishProductionBuild: (buildId) =>
          publishStoryBuild(workspaceId, projectId, buildId, {
            status: "published",
            setCurrent: true,
          }),
        buildSubmissionKeys: {
          keyFor: (fingerprint) =>
            publicationSubmissionKeys.keyFor("production-full", fingerprint, () =>
              globalThis.crypto.randomUUID()
            ),
          confirm: (fingerprint) =>
            publicationSubmissionKeys.confirm("production-full", fingerprint),
        },
        onPhaseChange: (phase) => {
          currentPhase = phase;
          setState({ status: phase });
        },
      });
    } catch (error) {
      const failure = toPublicationFailure(error, currentPhase, t);
      runningRef.current = false;
      setState(failure);
      return;
    }

    setLastSucceeded(result);
    const currentReleaseKey = ["story-studio", "current-release", workspaceId, projectId] as const;
    queryClient.setQueryData<StoryExperienceCurrentRelease>(currentReleaseKey, {
      projectId,
      gameId: result.release.gameId,
      published: result.release.status === "published",
      currentVersion: result.release.contentVersion,
      manifestUrl: result.release.manifestUrl,
      currentBuild:
        result.release.status === "published"
          ? {
              id: result.build.id,
              sourceDraftRevision: result.build.sourceDraftRevision,
              videoSnapshotHash: result.build.videoSnapshotHash,
            }
          : null,
      checkedAt: new Date().toISOString(),
    });
    const refreshes: Promise<unknown>[] = [
      queryClient.invalidateQueries({
        queryKey: ["story-studio", "workbench", workspaceId, projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["story-studio", "interactive-film-projects"],
      }),
      queryClient.invalidateQueries({
        queryKey: currentReleaseKey,
      }),
    ];
    if (onPublished) refreshes.push(Promise.resolve().then(() => onPublished(result)));
    runningRef.current = false;
    setState({ status: "succeeded", ...result });
    void Promise.allSettled(refreshes);
  }, [
    missingCapabilities.length,
    onPublished,
    open,
    projectId,
    publicationSubmissionKeys,
    queryClient,
    t,
    withSavedDraftSnapshot,
    workspaceId,
  ]);

  return {
    state,
    isOpen: state.status !== "closed",
    isPending: isStoryPublicationPending(state),
    canPublish,
    disabledReason,
    missingCapabilities,
    lastSucceeded,
    open,
    close,
    confirm: execute,
    retry: execute,
  };
}

export function isStoryPublicationPending(state: StoryPublicationState): boolean {
  return state.status === "saving" || state.status === "building" || state.status === "publishing";
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
      diagnostics: [],
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
    diagnostics: error.diagnostics,
  };
}

function publicationErrorFallback(
  code: StoryPublicationErrorCode,
  t: ReturnType<typeof useTranslations<"storyStudio.canvas.publish">>
): string {
  switch (code) {
    case "SAVE_FAILED":
      return t("errors.saveFailed");
    case "WORKBENCH_FAILED":
      return t("errors.workbenchFailed");
    case "DRAFT_REVISION_MISMATCH":
      return t("errors.revisionMismatch");
    case "BUILD_FAILED":
      return t("errors.buildFailed");
    case "BUILD_NOT_READY":
      return t("errors.buildNotReady");
    case "RUNTIME_UNAVAILABLE":
      return t("errors.runtimeUnavailable");
    case "PUBLISH_FAILED":
      return t("errors.publishFailed");
  }
}
