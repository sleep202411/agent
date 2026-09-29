import { useState } from "react";
import { Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { removeTaskComment } from "./task-comment-api";
export function TaskCommentRemove({
  commentId,
  generation,
  disabled,
  onRemoved,
  onRefresh,
}: {
  commentId: string;
  generation: number;
  disabled: boolean;
  onRemoved: () => void;
  onRefresh: () => void;
}) {
  const active = useScreenActive(),
    t = useTranslations();
  const op = useAuthFormOperation(commentId, active && generation === getAuthGeneration());
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState<string>();
  if (!active || generation !== getAuthGeneration()) return null;
  if (!confirm)
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled || op.busy}
        onPress={() => setConfirm(true)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskActivity.deleteComment")}</ThemedText>
      </Pressable>
    );
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskActivity.confirmDelete")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={disabled || op.busy}
        style={{ padding: 12 }}
        onPress={() => {
          void op.run(
            () => removeTaskComment(commentId),
            () => {
              setConfirm(false);
              setError(undefined);
              onRemoved();
            },
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>
          {t(op.busy ? "taskActivity.deletingComment" : "taskActivity.confirmDeleteAction")}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={() => {
          setConfirm(false);
          setError(undefined);
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("common.cancel")}</ThemedText>
      </Pressable>
      {error && (
        <Pressable
          accessibilityRole="button"
          disabled={op.busy}
          onPress={onRefresh}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskActivity.refreshComments")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
