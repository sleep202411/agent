import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { uuid } from "expo-modules-core";
import { View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import type { CandidateScope } from "../api/story-candidates-api";
import { openStoryCanvasDocument } from "../api/story-canvas-document";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
import { canvasRuntimeHtml } from "../lib/story-canvas-bridge";
import { createCanvasHost } from "../lib/story-canvas-host";
import { CanvasRuntimeFrame, type CanvasFrameHandle } from "./story-canvas-runtime-frame";

/** One mount is one cancellable document read. The parent remounts to refresh. */
export function StoryCanvasReader({
  scope,
  title,
  runtimeError,
  onResult,
  onError,
}: {
  scope: CandidateScope;
  title: string;
  runtimeError: string;
  onResult(value: CanvasSnapshot): void;
  onError(message: string): void;
}) {
  const [sessionId] = useState(() => uuid.v4());
  const html = useMemo(() => canvasRuntimeHtml(sessionId), [sessionId]);
  const frame = useRef<CanvasFrameHandle>(null);
  const host = useRef<ReturnType<typeof createCanvasHost> | null>(null);
  const [mounted, setMounted] = useState(false);
  const callbacks = useRef({ onResult, onError, runtimeError });
  useLayoutEffect(() => {
    callbacks.current = { onResult, onError, runtimeError };
  }, [onResult, onError, runtimeError]);
  const fail = useRef<() => void>(() => {});
  const { projectId, generation } = scope;
  useEffect(() => {
    const scope = { projectId, generation };
    const controller = new AbortController();
    let settled = false;
    const current = () => !controller.signal.aborted && getAuthGeneration() === scope.generation;
    const finish = (error?: string, value?: CanvasSnapshot) => {
      if (!current() || settled) return;
      settled = true;
      clearTimeout(timer);
      host.current?.dispose();
      setMounted(false);
      if (error !== undefined) callbacks.current.onError(error);
      else if (value) callbacks.current.onResult(value);
    };
    fail.current = () => finish(callbacks.current.runtimeError);
    const timer = setTimeout(() => {
      finish(callbacks.current.runtimeError);
      controller.abort();
    }, 30000);
    void openStoryCanvasDocument(scope, controller.signal)
      .then((snapshot) => {
        if (!current() || settled) return;
        host.current = createCanvasHost({
          scope,
          sessionId,
          snapshot,
          send: (message) => frame.current?.send(message),
          onResult: (message) => finish(undefined, message.snapshot),
          onError: (message) => finish(message),
        });
        setMounted(true);
      })
      .catch((error) => finish(error instanceof Error ? error.message : String(error)));
    return () => {
      controller.abort();
      clearTimeout(timer);
      host.current?.dispose();
      host.current = null;
    };
  }, [projectId, generation, sessionId]);
  return mounted ? (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 1 }}
    >
      <CanvasRuntimeFrame
        ref={frame}
        html={html}
        title={title}
        onMessage={(raw) => host.current?.receive(raw)}
        onError={() => fail.current()}
      />
    </View>
  ) : null;
}
