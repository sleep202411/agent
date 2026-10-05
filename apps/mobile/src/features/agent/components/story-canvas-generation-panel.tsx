import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { GenerationPanel } from "@/features/ai-lab/panel";
import {
  getStoryCanvasGenerationProject,
  type GenerationProject,
} from "@/features/ai-lab/projects-api";
import { readCanvasGenerationSeed } from "@/features/ai-lab/canvas-seed";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasWriteScope } from "../api/story-canvas-update";
import { StoryCanvasReader } from "./story-canvas-reader";
import { useCanvasSubmissionWriter } from "./use-canvas-submission-writer";

export function StoryCanvasGenerationPanel({
  scope,
  userId,
  nodeId,
  title,
  close,
}: {
  scope: CanvasWriteScope;
  userId: string;
  nodeId: string;
  title: string;
  close(): void;
}) {
  const theme = useTheme(),
    t = useTranslations(),
    insets = useSafeAreaInsets();
  const [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!busy) close();
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom,
          gap: 8,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            gap: 12,
          }}
        >
          <ThemedText type="smallBold" numberOfLines={2} style={{ flex: 1 }}>
            {title}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={close}
            style={{ padding: 12, opacity: busy ? 0.45 : 1 }}
          >
            <ThemedText type="small">{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        <Load
          key={attempt}
          scope={scope}
          userId={userId}
          nodeId={nodeId}
          onBusyChange={setBusy}
          retry={() => setAttempt((value) => value + 1)}
        />
      </View>
    </Modal>
  );
}
function Load({
  scope,
  userId,
  nodeId,
  onBusyChange,
  retry,
}: {
  scope: CanvasWriteScope;
  userId: string;
  nodeId: string;
  onBusyChange(value: boolean): void;
  retry(): void;
}) {
  const t = useTranslations();
  const [project, setProject] = useState<GenerationProject>();
  const [loaded, setLoaded] = useState<CanvasLoaded>();
  const [card, setCard] = useState<ReturnType<typeof readCanvasGenerationSeed>>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void getStoryCanvasGenerationProject(scope.projectId, scope.generation, controller.signal)
      .then((value) => {
        if (controller.signal.aborted || getAuthGeneration() !== scope.generation) return;
        if (!value.canGenerate) throw Error(t("aiLab.projectReadOnly"));
        setProject(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && getAuthGeneration() === scope.generation)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [scope, t]);
  if (error)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <ThemedText type="small" accessibilityRole="alert">
          {error}
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 12 }}>
          <ThemedText type="small">{t("common.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  if (project && loaded && card)
    return (
      <Composer
        scope={scope}
        userId={userId}
        nodeId={nodeId}
        project={project}
        card={card}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <>
      <ActivityIndicator />
      {!loaded && (
        <StoryCanvasReader
          scope={scope}
          title={t("storyCanvas.title")}
          runtimeError={t("storyCanvas.loadError")}
          onError={setError}
          onResult={(value) => {
            try {
              if (value.documentId !== scope.documentId) throw Error("Canvas document changed.");
              setCard(readCanvasGenerationSeed(value.snapshot, nodeId));
              setLoaded(value);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        />
      )}
    </>
  );
}
function Composer({
  scope,
  userId,
  nodeId,
  project,
  card,
  onBusyChange,
}: {
  scope: CanvasWriteScope;
  userId: string;
  nodeId: string;
  project: GenerationProject;
  card: ReturnType<typeof readCanvasGenerationSeed>;
  onBusyChange(value: boolean): void;
}) {
  const { beforeSubmit, beforeRetry, afterReceipt, bridge } = useCanvasSubmissionWriter(
    scope,
    userId,
    card.mode
  );
  const canvas = useMemo(
    () => ({
      documentId: scope.documentId,
      nodeId,
      mode: card.mode,
      seed: card.seed,
      beforeSubmit,
      beforeRetry,
      afterReceipt,
    }),
    [scope.documentId, nodeId, card, beforeSubmit, beforeRetry, afterReceipt]
  );
  return (
    <>
      {bridge}
      <GenerationPanel
        userId={userId}
        generation={scope.generation}
        project={project}
        canvas={canvas}
        onBusyChange={onBusyChange}
      />
    </>
  );
}
