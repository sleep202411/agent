import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { setStringAsync } from "expo-clipboard";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";

/** A read failure leaves the saved generation receipt intact. */
export function GenerationStatusUnavailable({
  loaded,
  error,
}: {
  loaded: CanvasLoaded;
  error?: string;
}) {
  const t = useTranslations();
  const [feedback, setFeedback] = useState<
    "storyCanvas.taskIdCopied" | "aiLab.failureDetails.copyFailed"
  >();
  const operation = useRef<symbol | undefined>(undefined);
  useEffect(
    () => () => {
      operation.current = undefined;
    },
    []
  );
  const ids = [
    ...new Set(
      Object.values(loaded.snapshot.nodes).flatMap((raw) => {
        const node = raw as { type?: string; data?: { generation?: { jobId?: unknown } } } | null;
        const id = node?.data?.generation?.jobId;
        return node?.type &&
          ["prompt", "video", "audio"].includes(node.type) &&
          typeof id === "string" &&
          id
          ? [id]
          : [];
      })
    ),
  ];
  const copy = async (id: string) => {
    const token = Symbol();
    operation.current = token;
    setFeedback(undefined);
    try {
      if (!(await setStringAsync(id))) throw Error("Clipboard unavailable");
      if (operation.current === token) setFeedback("storyCanvas.taskIdCopied");
    } catch {
      if (operation.current === token) setFeedback("aiLab.failureDetails.copyFailed");
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold" accessibilityRole="alert">
        {t("storyCanvas.statusReadUnavailableTitle")}
      </ThemedText>
      <ThemedText type="small">{t("storyCanvas.statusReadUnavailable")}</ThemedText>
      {error ? (
        <ThemedText type="small" selectable>
          {error}
        </ThemedText>
      ) : null}
      {ids.map((id) => (
        <View key={id} style={{ gap: 4 }}>
          <ThemedText type="small" selectable>
            {id}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => void copy(id)}
            style={{ paddingVertical: 12 }}
          >
            <ThemedText type="smallBold">{t("storyCanvas.copyTaskId")}</ThemedText>
          </Pressable>
        </View>
      ))}
      {feedback ? <ThemedText accessibilityRole="alert">{t(feedback)}</ThemedText> : null}
    </View>
  );
}
