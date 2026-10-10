import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { setStringAsync } from "expo-clipboard";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import type { GenerationJob } from "./jobs-api";

export function GenerationFailureDetails({
  job,
}: {
  job: Pick<GenerationJob, "id" | "modelId" | "error">;
}) {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<"copied" | "copyFailed">();
  const [copying, setCopying] = useState(false);
  const operation = useRef<symbol | undefined>(undefined);
  useEffect(
    () => () => {
      operation.current = undefined;
    },
    []
  );
  const message = job.error?.userMessage.trim() || t("aiLab.status.failed");
  const fields = [
    { label: t("aiLab.failureDetails.taskId"), value: job.id },
    { label: t("aiLab.failureDetails.model"), value: job.modelId },
    ...(job.error?.code ? [{ label: t("aiLab.failureDetails.code"), value: job.error.code }] : []),
  ];
  const copy = async () => {
    if (operation.current) return;
    const token = Symbol();
    operation.current = token;
    setCopying(true);
    setFeedback(undefined);
    try {
      if (
        !(await setStringAsync(
          [message, ...fields.map(({ label, value }) => `${label}: ${value}`)].join("\n")
        ))
      )
        throw new Error("Clipboard unavailable");
      if (operation.current === token) setFeedback("copied");
    } catch {
      if (operation.current === token) setFeedback("copyFailed");
    } finally {
      if (operation.current === token) {
        operation.current = undefined;
        setCopying(false);
      }
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <ThemedText selectable numberOfLines={expanded ? undefined : 3}>
        {message}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ padding: 12 }}
      >
        <ThemedText type="smallBold">{t("aiLab.failureDetails.open")}</ThemedText>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 8 }}>
          <ThemedText type="smallBold">{t("aiLab.failureDetails.title")}</ThemedText>
          {fields.map(({ label, value }) => (
            <View key={label} style={{ gap: 4 }}>
              <ThemedText type="small">{label}</ThemedText>
              <ThemedText selectable>{value}</ThemedText>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={copying}
            accessibilityState={{ disabled: copying }}
            onPress={() => void copy()}
            style={{ padding: 12, opacity: copying ? 0.45 : 1 }}
          >
            <ThemedText type="smallBold">{t("aiLab.failureDetails.copy")}</ThemedText>
          </Pressable>
          {feedback ? (
            <ThemedText accessibilityRole="alert">
              {t(`aiLab.failureDetails.${feedback}`)}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
