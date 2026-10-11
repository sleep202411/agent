import { CONTENT_REVIEW_MAX_DURATION_SECONDS } from "@repo/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { addContentReviewComment, type ContentReviewDetail } from "./api/content-review-api";
export function ContentReviewComment({
  workspaceId,
  generation,
  record,
  onSaved,
  onAccessLost,
}: {
  workspaceId: string;
  generation: number;
  record: ContentReviewDetail | undefined;
  onSaved: (record: ContentReviewDetail) => void;
  onAccessLost: (message: string) => void;
}) {
  const theme = useTheme(),
    t = useTranslations();
  const [seconds, setSeconds] = useState("0"),
    [body, setBody] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [attemptedAt, setAttemptedAt] = useState<ContentReviewDetail>();
  const latestRecord = useRef(record);
  useLayoutEffect(() => {
    if (record) latestRecord.current = record;
  }, [record]);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  const time =
    seconds.trim() !== "" && /^\d+(?:\.\d+)?$/.test(seconds.trim()) ? Number(seconds) : NaN;
  const valid =
    Number.isFinite(time) &&
    time >= 0 &&
    time <= Math.min(record?.durationSeconds ?? 0, CONTENT_REVIEW_MAX_DURATION_SECONDS) &&
    body.trim().length > 0 &&
    body.trim().length <= 2000;
  const uncertain = attemptedAt !== undefined && attemptedAt === record;
  async function submit() {
    if (!record || active.current || uncertain || !valid || generation !== getAuthGeneration())
      return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const result = await addContentReviewComment(
        workspaceId,
        generation,
        record.id,
        { seconds: time, body },
        controller.signal
      );
      if (!controller.signal.aborted && generation === getAuthGeneration()) {
        setBody("");
        onSaved(result);
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation === getAuthGeneration()) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const status =
          cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (status === 401 || status === 403) {
          onAccessLost(message);
          return;
        }
        setError(message);
        setAttemptedAt(latestRecord.current ?? record);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted && generation === getAuthGeneration()) setBusy(false);
      }
    }
  }
  if (!record) return null;
  return (
    <View
      style={{ gap: 8, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
    >
      <ThemedText type="smallBold">{t("contentReviewHistory.addComment")}</ThemedText>
      <ThemedText type="small">{t("contentReviewHistory.timestamp")}</ThemedText>
      <TextInput
        accessibilityLabel={t("contentReviewHistory.timestamp")}
        value={seconds}
        onChangeText={setSeconds}
        keyboardType="decimal-pad"
        editable={!busy && !uncertain}
        style={{ color: theme.text, padding: 12, borderWidth: 1, borderColor: theme.textSecondary }}
      />
      <TextInput
        accessibilityLabel={t("contentReviewHistory.commentBody")}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
        editable={!busy && !uncertain}
        style={{
          color: theme.text,
          padding: 12,
          minHeight: 90,
          borderWidth: 1,
          borderColor: theme.textSecondary,
        }}
      />
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {uncertain && <ThemedText>{t("contentReviewHistory.checkBeforeRetry")}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || uncertain || !valid }}
        disabled={busy || uncertain || !valid}
        onPress={() => void submit()}
        style={{ padding: 12, opacity: busy || uncertain || !valid ? 0.5 : 1 }}
      >
        <ThemedText>{t("contentReviewHistory.addComment")}</ThemedText>
      </Pressable>
    </View>
  );
}
