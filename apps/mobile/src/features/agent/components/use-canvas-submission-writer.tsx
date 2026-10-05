import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import type {
  GenerationCommand,
  GenerationRetry,
  GenerationReceipt,
} from "@/features/ai-lab/jobs-api";
import type {
  CanvasSubmission,
  CanvasSubmissionRecord,
} from "../../../../canvas-editor/submission-schema";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasWriteScope } from "../api/story-canvas-update";
import { canvasReconciliation } from "../lib/story-canvas-reconciliation";
import {
  persistCanvasSubmission,
  persistCanvasRetry,
  persistCanvasReceipt,
} from "../lib/story-canvas-submission";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

type Request = {
  id: number;
  scope: CanvasWriteScope;
  userId: string;
  type: CanvasSubmission["type"];
  command: CanvasSubmissionRecord;
  signal: AbortSignal;
  finish(error?: Error, update?: string | null): void;
  loaded?: CanvasLoaded;
};
/** Hidden native runtime bridge; unmount retires reads, saves and their promises. */
export function useCanvasSubmissionWriter(
  scope: CanvasWriteScope,
  userId: string,
  type: CanvasSubmission["type"]
) {
  const t = useTranslations();
  const queue = useMemo(() => canvasReconciliation(scope, userId), [scope, userId]);
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null),
    serial = useRef(0);
  const lifetime = useRef<{
    active: boolean;
    scope: CanvasWriteScope;
    userId: string;
    type: CanvasSubmission["type"];
    controllers: Set<AbortController>;
  } | null>(null);
  useLayoutEffect(() => {
    const token = { active: true, scope, userId, type, controllers: new Set<AbortController>() };
    lifetime.current = token;
    return () => {
      token.active = false;
      for (const controller of token.controllers) controller.abort();
    };
  }, [scope, userId, type]);
  const encode = useCallback(
    (command: CanvasSubmissionRecord, signal: AbortSignal): Promise<string | null> => {
      const life = lifetime.current;
      if (
        !life?.active ||
        life.scope !== scope ||
        life.userId !== userId ||
        life.type !== type ||
        signal.aborted ||
        getAuthGeneration() !== scope.generation
      )
        return Promise.reject(Error("Canvas session expired."));
      if (pending.current) return Promise.reject(Error("A canvas save is already in progress."));
      return new Promise((resolve, reject) => {
        const abort = () => entry.finish(Error("Canvas save interrupted."));
        let settled = false;
        const entry: Request = {
          id: ++serial.current,
          scope,
          userId,
          type,
          command,
          signal,
          finish(error, update) {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            if (pending.current === entry) pending.current = null;
            if (life.active && lifetime.current === life) setRequest(null);
            if (error) reject(error);
            else resolve(update ?? null);
          },
        };
        pending.current = entry;
        signal.addEventListener("abort", abort, { once: true });
        setRequest(entry);
      });
    },
    [scope, userId, type]
  );
  const save = useCallback(
    async (run: (signal: AbortSignal) => Promise<void>, signal: AbortSignal) => {
      const life = lifetime.current;
      if (
        !life?.active ||
        life.scope !== scope ||
        life.userId !== userId ||
        life.type !== type ||
        signal.aborted ||
        getAuthGeneration() !== scope.generation
      )
        throw Error("Canvas session expired.");
      if (life.controllers.size) throw Error("A canvas save is already in progress.");
      const controller = new AbortController();
      life.controllers.add(controller);
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        await run(controller.signal);
        if (!life.active || controller.signal.aborted || getAuthGeneration() !== scope.generation)
          throw Error("Canvas session expired.");
      } finally {
        signal.removeEventListener("abort", abort);
        life.controllers.delete(controller);
      }
    },
    [scope, userId, type]
  );
  const beforeSubmit = useCallback(
    (command: GenerationCommand, signal: AbortSignal) =>
      save(
        (active) =>
          persistCanvasSubmission(scope, userId, type, command, active, { queue, encode }),
        signal
      ),
    [save, scope, userId, type, queue, encode]
  );
  const beforeRetry = useCallback(
    (command: GenerationRetry, signal: AbortSignal) =>
      save(
        (active) => persistCanvasRetry(scope, userId, type, command, active, { queue, encode }),
        signal
      ),
    [save, scope, userId, type, queue, encode]
  );
  const afterReceipt = useCallback(
    (
      command: GenerationCommand | GenerationRetry,
      receipt: GenerationReceipt,
      signal: AbortSignal
    ) =>
      save(
        (active) =>
          persistCanvasReceipt(scope, userId, type, command, receipt, active, { queue, encode }),
        signal
      ),
    [save, scope, userId, type, queue, encode]
  );
  const current = (value: Request) =>
    pending.current?.id === value.id &&
    !value.signal.aborted &&
    getAuthGeneration() === scope.generation;
  const accept = (value: Request) => {
    if (pending.current?.id !== value.id) return false;
    if (!current(value)) {
      value.finish(Error("Canvas session expired."));
      return false;
    }
    return true;
  };
  const fail = (value: Request, message: string) => {
    if (accept(value)) value.finish(Error(message));
  };
  const bridge =
    request &&
    request.scope === scope &&
    request.userId === userId &&
    request.type === type &&
    !request.signal.aborted &&
    getAuthGeneration() === scope.generation ? (
      request.loaded ? (
        <StoryCanvasEncoder
          key={`encode:${request.id}`}
          loaded={request.loaded}
          edit={{ action: "submission", submission: request.command }}
          generation={scope.generation}
          title={t("storyCanvas.title")}
          runtimeError={t("storyCanvas.loadError")}
          onError={(message) => fail(request, message)}
          onResult={(update) => {
            if (accept(request)) request.finish(undefined, update);
          }}
        />
      ) : (
        <StoryCanvasReader
          key={`read:${request.id}`}
          scope={scope}
          title={t("storyCanvas.title")}
          runtimeError={t("storyCanvas.loadError")}
          onError={(message) => fail(request, message)}
          onResult={(loaded) => {
            if (!accept(request)) return;
            if (loaded.documentId !== scope.documentId)
              return fail(request, "Canvas document changed.");
            setRequest({ ...request, loaded });
          }}
        />
      )
    ) : null;
  return { beforeSubmit, beforeRetry, afterReceipt, bridge };
}
