import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasWriteScope } from "../api/story-canvas-update";
import { canvasReconciliation } from "../lib/story-canvas-reconciliation";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

/** Mounted only while an editable canvas is foregrounded with no open forms.
 * Idle polling discovers completed outputs; failures require an explicit retry. */
export function StoryCanvasMediaSync({
  scope,
  userId,
  onSnapshot,
  onSaved,
}: {
  scope: CanvasWriteScope;
  userId: string;
  onSnapshot(value: CanvasLoaded): void;
  onSaved(): void;
}) {
  const t = useTranslations();
  const queue = useMemo(() => canvasReconciliation(scope, userId), [scope, userId]);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"idle" | "read" | "encode" | "save" | "error">("idle");
  const [fresh, setFresh] = useState<CanvasLoaded>();
  const [error, setError] = useState<string>();
  const life = useRef<{
    controller: AbortController;
    attempt: number;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const callbacks = useRef({ onSnapshot, onSaved });
  useLayoutEffect(() => {
    callbacks.current = { onSnapshot, onSaved };
  }, [onSnapshot, onSaved]);
  useEffect(() => {
    const token = { controller: new AbortController(), attempt } as NonNullable<
      typeof life.current
    >;
    life.current = token;
    const current = () =>
      !token.controller.signal.aborted && getAuthGeneration() === scope.generation;
    const idle = () => {
      setPhase("idle");
      token.timer = setTimeout(() => {
        if (current()) setAttempt((n) => n + 1);
      }, 15000);
    };
    void (async () => {
      try {
        setError(undefined);
        if (queue.read()) {
          setPhase("save");
          await queue.resume(token.controller.signal);
          if (current()) callbacks.current.onSaved();
        } else if (queue.canPrepare()) setPhase("read");
        else idle();
      } catch (cause) {
        if (current()) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setPhase("error");
        }
      }
    })();
    return () => {
      token.controller.abort();
      clearTimeout(token.timer);
    };
  }, [queue, scope.generation, attempt]);
  const current = () =>
    life.current?.attempt === attempt &&
    !life.current.controller.signal.aborted &&
    getAuthGeneration() === scope.generation;
  const failed = (cause: unknown) => {
    if (!current()) return;
    setError(cause instanceof Error ? cause.message : String(cause));
    setPhase("error");
  };
  const idle = (value?: CanvasLoaded) => {
    if (!current()) return;
    if (value) callbacks.current.onSnapshot(value);
    setPhase("idle");
    life.current!.timer = setTimeout(() => {
      if (current()) setAttempt((n) => n + 1);
    }, 15000);
  };
  return (
    <>
      {phase === "error" && (
        <View style={{ gap: 4 }}>
          <ThemedText type="small" accessibilityRole="alert">
            {error}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((n) => n + 1)}
            style={{ paddingVertical: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.media.retrySync")}</ThemedText>
          </Pressable>
        </View>
      )}
      {phase === "read" && (
        <StoryCanvasReader
          key={`read:${attempt}`}
          scope={scope}
          title={t("storyCanvas.title")}
          runtimeError={t("storyCanvas.loadError")}
          onError={failed}
          onResult={(value) => {
            if (!current()) return;
            if (value.documentId !== scope.documentId) return failed(t("storyCanvas.changed"));
            try {
              if (!queue.canPrepare()) return idle();
              setFresh(value);
              setPhase("encode");
            } catch (cause) {
              failed(cause);
            }
          }}
        />
      )}
      {phase === "encode" && fresh && (
        <StoryCanvasEncoder
          key={`encode:${attempt}`}
          loaded={fresh}
          edit={{ action: "reconcileShotMedia" }}
          generation={scope.generation}
          title={t("storyCanvas.title")}
          runtimeError={t("storyCanvas.loadError")}
          onError={failed}
          onResult={(update) => {
            if (!current()) return;
            try {
              if (!queue.canPrepare()) return idle();
              if (!update) return idle(fresh);
              queue.prepare({ clientKey: uuid.v4(), yjsUpdateBase64: update });
              setPhase("save");
              const token = life.current!;
              void queue
                .resume(token.controller.signal)
                .then(() => {
                  if (!token.controller.signal.aborted && getAuthGeneration() === scope.generation)
                    callbacks.current.onSaved();
                })
                .catch((cause) => {
                  if (!token.controller.signal.aborted) failed(cause);
                });
            } catch (cause) {
              failed(cause);
            }
          }}
        />
      )}
    </>
  );
}
