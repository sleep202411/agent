import { storyboardPending } from "../lib/storyboard-pending";
import { canvasStoryboard } from "../lib/canvas-storyboard";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import { canvasUpdatePending, type CanvasUpdateCommand } from "../api/story-canvas-update";
import {
  openPlatformCanvasDocument,
  platformCanvasUpdatePending,
} from "../api/platform-canvas-document";
import { StoryCanvasEncoder } from "./story-canvas-encoder";
import { StoryCanvasReader } from "./story-canvas-reader";
export type StoryboardEdit = NonNullable<ComponentProps<typeof StoryCanvasEncoder>["edit"]>;
/** Immediate canvas action. Only transport receipts are persisted; no user-facing draft flow. */
export function StoryboardMutation({
  scope,
  userId,
  edit,
  saved,
  onlyIfEmpty = false,
}: {
  scope: CanvasEditScope;
  userId: string;
  edit: StoryboardEdit;
  onlyIfEmpty?: boolean;
  saved(value: CanvasLoaded): void;
}) {
  const t = useTranslations();
  const client = useMemo(
    () =>
      "kind" in scope
        ? platformCanvasUpdatePending(scope, userId)
        : canvasUpdatePending(scope, userId),
    [scope, userId]
  );
  const receipt = useMemo(() => storyboardPending(scope, userId), [scope, userId]);
  const controller = useRef<AbortController | null>(null);
  const command = useRef<CanvasUpdateCommand | null>(null);
  const [phase, setPhase] = useState<"read" | "encode" | "save" | "reload">("read");
  const [loaded, setLoaded] = useState<CanvasLoaded>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => c.abort();
  }, []);
  const current = () =>
    controller.current &&
    !controller.current.signal.aborted &&
    scope.generation === getAuthGeneration();
  const fail = (e: unknown) => {
    if (current()) setError(e instanceof Error ? e.message : String(e));
  };
  const submit = async (value: CanvasUpdateCommand) => {
    if (!current()) return;
    command.current = value;
    setPhase("save");
    try {
      receipt.write(value);
      await client.submit(value, controller.current!.signal);
      if (current()) receipt.write(null);
      if (current()) setPhase("reload");
    } catch (e) {
      fail(e);
    }
  };
  return (
    <View>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            onPress={() => {
              setError(undefined);
              if (command.current && phase === "save") void submit(command.current);
              else {
                setAttempt((v) => v + 1);
                setPhase(phase === "reload" ? "reload" : "read");
              }
            }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator />
      )}
      {!error && (phase === "read" || phase === "reload") && (
        <StoryCanvasReader
          key={`${phase}:${attempt}`}
          scope={scope}
          platform={"kind" in scope ? { scope, load: openPlatformCanvasDocument } : undefined}
          title={t("storyboard.title")}
          runtimeError={t("storyCanvas.loadError")}
          onError={fail}
          onResult={(value) => {
            if (!current()) return;
            if (phase === "reload") {
              saved(value);
              return;
            }
            try {
              const recovery = receipt.read(),
                pending = client.read();
              if (
                pending &&
                (!recovery ||
                  pending.clientKey !== recovery.clientKey ||
                  pending.yjsUpdateBase64 !== recovery.yjsUpdateBase64)
              )
                throw Error(t("storyboard.pending"));
              if (recovery) {
                void submit(recovery);
                return;
              }
              if (onlyIfEmpty && canvasStoryboard(value.snapshot).rows.length) {
                saved(value);
                return;
              }
              setLoaded(value);
              setPhase("encode");
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {!error && phase === "encode" && loaded && (
        <StoryCanvasEncoder
          loaded={loaded}
          edit={edit}
          generation={scope.generation}
          title={t("storyboard.title")}
          runtimeError={t("storyCanvas.loadError")}
          onError={fail}
          onResult={(update) => {
            if (!current()) return;
            if (!update) {
              saved(loaded);
              return;
            }
            void submit({ clientKey: uuid.v4(), yjsUpdateBase64: update });
          }}
        />
      )}
    </View>
  );
}
