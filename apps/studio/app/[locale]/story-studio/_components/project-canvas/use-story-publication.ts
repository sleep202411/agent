"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  getInteractiveFilmPublication,
  interactiveFilmPublicationQueryKey,
  prepareInteractiveFilmRelease,
  submitInteractiveFilmRelease,
} from "@/lib/interactive-film-api";
import {
  storyApiErrorBody,
  storyApiErrorMessage,
  type StoryCapability,
} from "@/lib/story-projects-api";
import {
  runStoryPublication,
  StoryPublicationFlowError,
  type StoryPublicationActivePhase,
  type StoryPublicationErrorCode,
  type StoryPublicationFlowResult,
} from "./story-publication-flow";
import {
  storyPublicationActionErrorKind,
  type StoryPublicationErrorKind,
} from "../../_lib/story-publication-errors";

export type SavedDraftSnapshotRunner = <T>(
  submit: (expectedDraftRevision: number) => Promise<T>
) => Promise<T>;

export type StoryPublicationFailureCode =
  | StoryPublicationErrorCode
  | "PERMISSION_DENIED"
  | "UNEXPECTED";

export interface StoryPublicationIssue {
  message: string;
  nodeId: string | null;
}

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
      issues?: StoryPublicationIssue[];
      errorKind?: StoryPublicationErrorKind | null;
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
  const { user, isCurrentAccount } = useAuth();
  const userId = user?.id ?? null;

  const missingCapabilities = useMemo(
    () => REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability)),
    [capabilities]
  );
  const canSubmit = userId != null && missingCapabilities.length === 0;
  const scope = useMemo(() => ({ projectId, userId, canSubmit }), [projectId, userId, canSubmit]);
  const owner = useRef<{
    scope: typeof scope;
    controller: AbortController;
    running: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const next = { scope, controller: new AbortController(), running: false };
    owner.current = next;
    return () => {
      next.controller.abort();
      if (owner.current === next) owner.current = null;
    };
  }, [scope]);
  const [result, setResult] = useState<{
    scope: typeof scope;
    state: StoryPublicationState;
  } | null>(null);
  const state: StoryPublicationState =
    result?.scope === scope ? result.state : { status: "closed" };
  const setState = useCallback(
    (state: StoryPublicationState) => setResult({ scope, state }),
    [scope]
  );
  const disabledReason = missingCapabilities.length > 0 ? t("errors.permissionDenied") : null;

  const open = useCallback(() => {
    if (owner.current?.running) return;
    if (!canSubmit) {
      setState({
        status: "failed",
        phase: "permission",
        code: "PERMISSION_DENIED",
        message: t("errors.permissionDenied"),
      });
      return;
    }
    setState({ status: "confirming" });
  }, [canSubmit, setState, t]);

  const close = useCallback(() => {
    if (!owner.current?.running) setState({ status: "closed" });
  }, [setState]);

  const execute = useCallback(async () => {
    if (owner.current?.running) return;
    if (!canSubmit) {
      open();
      return;
    }
    if (!expectedVideoSnapshotHash || !/^[a-f0-9]{64}$/.test(expectedVideoSnapshotHash)) {
      setState({
        status: "failed",
        phase: "permission",
        code: "UNEXPECTED",
        message: t("errors.unexpected"),
      });
      return;
    }

    const current = owner.current;
    const isCurrent = () =>
      Boolean(
        current &&
        owner.current === current &&
        !current.controller.signal.aborted &&
        userId != null &&
        isCurrentAccount(userId)
      );
    if (!current || current.scope !== scope || !isCurrent()) return;
    const assertCurrent = () => {
      if (!isCurrent()) throw new DOMException("Publication abandoned", "AbortError");
    };
    const refreshPublicationStatus = async () => {
      assertCurrent();
      const publication = await getInteractiveFilmPublication(projectId, current.controller.signal);
      assertCurrent();
      queryClient.setQueryData(interactiveFilmPublicationQueryKey(projectId, userId), publication);
      return publication;
    };
    current.running = true;
    let currentPhase: StoryPublicationActivePhase = "saving";
    let result: StoryPublicationFlowResult;
    try {
      result = await runStoryPublication({
        saveDraftSnapshot: async () => {
          assertCurrent();
          const publication = await refreshPublicationStatus();
          assertCurrent();
          if (publication?.status === "reviewing" || publication?.status === "published") {
            throw new Error(
              t(publication.status === "reviewing" ? "reviewingLocked" : "publishedUpdateLocked")
            );
          }
          return withSavedDraftSnapshot(async (expectedDraftRevision) => {
            assertCurrent();
            return expectedDraftRevision;
          });
        },
        prepareRelease: (expectedDraftRevision) => {
          assertCurrent();
          return prepareInteractiveFilmRelease(
            projectId,
            {
              expectedDraftRevision,
              expectedVideoSnapshotHash,
            },
            current.controller.signal
          );
        },
        submitRelease: (release) => {
          assertCurrent();
          return submitInteractiveFilmRelease(projectId, release, current.controller.signal);
        },
        onPhaseChange: (phase) => {
          assertCurrent();
          currentPhase = phase;
          setState({ status: phase });
        },
      });
    } catch (error) {
      if (
        error instanceof StoryPublicationFlowError &&
        error.phase === "submitting" &&
        isCurrent()
      ) {
        try {
          // A failed gateway response may follow a completed submission.
          await refreshPublicationStatus();
        } catch {
          // Retain the action error; every retry checks status before another write.
        }
      }
      current.running = false;
      if (!isCurrent()) return;
      setState(toPublicationFailure(error, currentPhase, t));
      return;
    }

    if (!isCurrent()) return;
    queryClient.setQueryData(
      interactiveFilmPublicationQueryKey(projectId, userId),
      result.publication
    );
    const refreshes = [
      queryClient.invalidateQueries({ queryKey: ["story-studio", "workbench", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["story-studio", "chapter-workbench", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["story-studio", "script-workbench", projectId] }),
      queryClient.invalidateQueries({
        queryKey: interactiveFilmPublicationQueryKey(projectId, userId),
      }),
    ];
    current.running = false;
    setState({ status: "succeeded", ...result });
    void Promise.allSettled(refreshes);
  }, [
    expectedVideoSnapshotHash,
    canSubmit,
    scope,
    userId,
    isCurrentAccount,
    setState,
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
      errorKind: storyPublicationActionErrorKind(error),
    };
  }
  const fallback = publicationErrorFallback(error.code, t);
  const issues =
    error.upstreamError === undefined ? [] : storyPublicationIssues(error.upstreamError);
  return {
    status: "failed",
    phase: error.phase,
    code: error.code,
    message:
      issues[0]?.message ??
      (error.upstreamError === undefined
        ? fallback
        : storyApiErrorMessage(error.upstreamError, fallback)),
    issues,
    errorKind: storyPublicationActionErrorKind(error.upstreamError),
  };
}

export function storyPublicationIssues(error: unknown): StoryPublicationIssue[] {
  const diagnostics = storyApiErrorBody(error)?.diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (!message) return [];
    const nodeId =
      typeof record.nodeId === "string" && record.nodeId.includes(":") ? record.nodeId : null;
    return [{ message, nodeId }];
  });
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
