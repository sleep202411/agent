import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { inquiryKey } from "./inquiry-api";
import { fetchTaskCommentPermission, postTaskComment } from "./task-comment-api";
type Props = {
  crewId: string;
  taskId: string;
  userId: string;
  generation: number;
  onSent: () => void;
};
export function TaskComment(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Composer
      key={`${props.crewId}:${props.taskId}:${props.userId}:${props.generation}`}
      {...props}
    />
  ) : null;
}
function Composer({ crewId, taskId, userId, generation, onSent }: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const op = useAuthFormOperation(taskId, true);
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<{ revision: number; allowed?: boolean; error?: string }>();
  const [body, setBody] = useState(""),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const intent = useRef<{ body: string; clientKey: string } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCommentPermission(crewId, userId, controller.signal).then(
      (allowed) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAccess({ revision, allowed });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAccess({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, userId, generation, revision]);
  const current = access?.revision === revision ? access : undefined;
  if (!current) return <ActivityIndicator accessibilityLabel={t("courses.loading")} />;
  if (current.error)
    return (
      <View>
        <ThemedText accessibilityRole="alert">{current.error}</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => setRevision((v) => v + 1)}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("inbox.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  if (!current.allowed) return null;
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        multiline
        accessibilityLabel={t("taskActivity.writeComment")}
        placeholder={t("taskActivity.writeComment")}
        placeholderTextColor={theme.textSecondary}
        value={body}
        onChangeText={setBody}
        editable={!op.busy && !attempted}
        maxLength={10000}
        style={{ color: theme.text, minHeight: 80, padding: 12 }}
      />
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && (
        <ThemedText type="small">{t("taskActivity.retryCommentHint")}</ThemedText>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy || !body.trim()}
        style={{ padding: 12 }}
        onPress={() => {
          void op.run(
            async () => {
              intent.current ??= { body: body.trim(), clientKey: inquiryKey() };
              setAttempted(true);
              return postTaskComment(taskId, userId, intent.current);
            },
            () => {
              intent.current = undefined;
              setAttempted(false);
              setBody("");
              setError(undefined);
              onSent();
            },
            (cause) => {
              setError(cause instanceof Error ? cause.message : String(cause));
              const status =
                cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
              if (status === 401 || status === 403 || status === 404) setRevision((v) => v + 1);
            }
          );
        }}
      >
        <ThemedText>
          {t(
            op.busy
              ? "taskActivity.sendingComment"
              : attempted
                ? "inbox.retry"
                : "taskActivity.sendComment"
          )}
        </ThemedText>
      </Pressable>
    </View>
  );
}
