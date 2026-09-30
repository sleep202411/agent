import { useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { editTaskComment, type TaskCommentEdit as EditInput } from "./task-comment-api";
import type { TaskActivity } from "./task-timeline-api";
import { TaskMentionPicker } from "./task-mention-picker";
export function TaskCommentEdit({
  item,
  crewId,
  userId,
  generation,
  disabled,
  onSaved,
  onRefresh,
}: {
  item: TaskActivity;
  crewId: string;
  userId: string;
  generation: number;
  disabled: boolean;
  onSaved: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const op = useAuthFormOperation(item.id, active && generation === getAuthGeneration());
  const [draft, setDraft] = useState<EditInput>(),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false),
    [picking, setPicking] = useState(false);
  if (!active || generation !== getAuthGeneration()) return null;
  if (!draft)
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        style={{ padding: 12 }}
        onPress={() => {
          setDraft({
            expectedVersion: item.version,
            body: item.body ?? "",
            mentions: item.mentions,
          });
          setAttempted(false);
          setError(undefined);
        }}
      >
        <ThemedText>{t("taskActivity.editComment")}</ThemedText>
      </Pressable>
    );
  const locked = disabled || op.busy || attempted;
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        multiline
        accessibilityLabel={t("taskActivity.editComment")}
        value={draft.body}
        maxLength={10000}
        editable={!locked}
        onChangeText={(body) =>
          setDraft({
            ...draft,
            body,
            mentions: draft.mentions.filter((m) => body.includes(`@${m.label}`)),
          })
        }
        style={{ color: theme.text, minHeight: 80, padding: 12 }}
      />
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <ThemedText>{t("taskActivity.editRefreshHint")}</ThemedText>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={locked || picking || !draft.body.trim()}
        style={{ padding: 12 }}
        onPress={() => {
          void op.run(
            () => {
              setAttempted(true);
              return editTaskComment(item.taskId, item.id, {
                ...draft,
                mentions: draft.mentions.filter((m) => draft.body.includes(`@${m.label}`)),
              });
            },
            () => {
              setDraft(undefined);
              setError(undefined);
              onSaved();
            },
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>
          {t(op.busy ? "taskActivity.savingComment" : "taskActivity.saveComment")}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={locked || draft.mentions.length >= 20}
        style={{ padding: 12 }}
        onPress={() => setPicking(true)}
      >
        <ThemedText>{t("thread.mention")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        style={{ padding: 12 }}
        onPress={() => {
          setDraft(undefined);
          setPicking(false);
          if (attempted) onRefresh();
        }}
      >
        <ThemedText>{t("common.cancel")}</ThemedText>
      </Pressable>
      {error && (
        <Pressable
          accessibilityRole="button"
          disabled={op.busy}
          style={{ padding: 12 }}
          onPress={onRefresh}
        >
          <ThemedText>{t("taskActivity.refreshComments")}</ThemedText>
        </Pressable>
      )}
      {picking && (
        <Modal visible animationType="slide" onRequestClose={() => setPicking(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <TaskMentionPicker
              crewId={crewId}
              userId={userId}
              generation={generation}
              excludedIds={draft.mentions.map((m) => m.userId)}
              onClose={() => setPicking(false)}
              onSelect={(mention) => {
                if (locked || generation !== getAuthGeneration()) return;
                const body = `${draft.body}${draft.body && !/\s$/.test(draft.body) ? " " : ""}@${mention.label} `;
                if (body.length > 10000) {
                  setError(t("taskActivity.mentionTooLong"));
                  setPicking(false);
                  return;
                }
                setDraft({
                  ...draft,
                  body,
                  mentions: [...draft.mentions.filter((m) => m.userId !== mention.userId), mention],
                });
                setPicking(false);
              }}
            />
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
