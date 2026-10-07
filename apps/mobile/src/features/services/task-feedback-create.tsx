import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import type { TaskDetail } from "./task-detail-api";
import {
  creationOutbox,
  createTaskFeedback,
  feedbackTarget,
  type FeedbackCreation,
} from "./task-feedback-create-api";
export function TaskFeedbackCreate({
  task,
  userId,
  generation,
}: {
  task: TaskDetail;
  userId: string;
  generation: number;
}) {
  const focused = useIsFocused();
  const target = feedbackTarget(task, userId);
  return focused && generation === getAuthGeneration() && target ? (
    <Form
      key={JSON.stringify([task.id, userId, generation, target.submissionId])}
      task={task}
      userId={userId}
      generation={generation}
      target={target}
    />
  ) : null;
}
function Form({
  task,
  userId,
  generation,
  target,
}: {
  task: TaskDetail;
  userId: string;
  generation: number;
  target: NonNullable<ReturnType<typeof feedbackTarget>>;
}) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(task.id, true);
  const [outbox] = useState(() => creationOutbox(task.id, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<FeedbackCreation | null>(initial.pending ?? null);
  const [comment, setComment] = useState(initial.pending?.comment ?? "");
  const [scores, setScores] = useState<Record<string, number>>(() =>
    initial.pending
      ? (Object.fromEntries(
          Object.entries(initial.pending.ratings).filter(([key]) => key !== "direction")
        ) as Record<string, number>)
      : {}
  );
  const [error, setError] = useState(initial.error),
    [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => c.abort();
  }, []);
  const keys =
    target.direction === "creator"
      ? (["productionAbility", "understanding", "communication"] as const)
      : (["managementAbility"] as const);
  const locked = !!pending || op.busy || saved || !!initial.error;
  const submit = () => {
    const c = controller.current;
    if (!active || !c || c.signal.aborted) return;
    void op.run(
      async () => {
        const request = pending ?? {
          clientKey: uuid.v4(),
          submissionId: target.submissionId,
          subjectUserId: target.subjectUserId,
          comment,
          publicOnProfile: true,
          ratings:
            target.direction === "creator"
              ? {
                  direction: "creator" as const,
                  productionAbility: scores.productionAbility!,
                  understanding: scores.understanding!,
                  communication: scores.communication!,
                }
              : { direction: "manager" as const, managementAbility: scores.managementAbility! },
        };
        outbox.save(request);
        setPending(request);
        setError("");
        await createTaskFeedback(task.crewId, task.id, userId, generation, request, c.signal);
        outbox.clear(request.clientKey);
      },
      () => setSaved(true),
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  if (!active) return null;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("feedbackHistory.create")}</ThemedText>
      <ThemedText>{t("feedbackHistory.creationHelp")}</ThemedText>
      <ThemedText>
        {t(
          pending && !pending.publicOnProfile
            ? "feedbackHistory.privateRetryNotice"
            : "feedbackHistory.publicNotice"
        )}
      </ThemedText>
      <ThemedText>{target.subjectUserId}</ThemedText>
      {keys.map((key) => (
        <View key={key} style={{ gap: 4 }}>
          <ThemedText>{t(`feedbackHistory.${key}`)}</ThemedText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={`${t(`feedbackHistory.${key}`)} ${value}`}
                accessibilityState={{ checked: scores[key] === value, disabled: locked }}
                disabled={locked}
                onPress={() => setScores((v) => ({ ...v, [key]: value }))}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  backgroundColor: theme.background,
                }}
              >
                <ThemedText
                  style={{
                    color: value <= (scores[key] ?? 0) ? "#FFD84D" : theme.textSecondary,
                    fontSize: 24,
                  }}
                >
                  {value <= (scores[key] ?? 0) ? "★" : "☆"}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <TextInput
        accessibilityLabel={t("feedbackHistory.comment")}
        placeholder={t("feedbackHistory.comment")}
        placeholderTextColor={theme.textSecondary}
        value={comment}
        onChangeText={setComment}
        editable={!locked}
        multiline
        maxLength={2000}
        style={{ color: theme.text, padding: 12, minHeight: 72 }}
      />
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {pending && !saved && <ThemedText>{t("feedbackHistory.retryHelp")}</ThemedText>}
      {saved ? (
        <ThemedText>{t("feedbackHistory.saved")}</ThemedText>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={op.busy || !!initial.error || (!pending && keys.some((key) => !scores[key]))}
          onPress={submit}
          style={{ padding: 12 }}
        >
          <ThemedText>{t(pending ? "feedbackHistory.retry" : "feedbackHistory.submit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
