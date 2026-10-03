import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { useTaskTimeline } from "./use-task-timeline";
import { useUserDisplays } from "./user-displays";
import { taskActivityLabel, taskActivityNote } from "./task-timeline-api";
import { TaskCommentEdit } from "./task-comment-edit";
import { TaskCommentRemove } from "./task-comment-remove";
import { TaskComment } from "./task-comment";
import { ConversationFile } from "./conversation-file";
/** Parent task detail is scoped to account/focus and revalidates tasks.view first. */
export function TaskTimeline({
  crewId,
  taskId,
  userId,
  generation,
}: {
  crewId: string;
  taskId: string;
  userId: string;
  generation: number;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [reply, setReply] = useState<{ id: string; body: string | null }>();
  const [replyAccess, setReplyAccess] = useState<{
    allowed: boolean;
    locked: boolean;
    canManage?: boolean;
  }>({ allowed: false, locked: false });
  const history = useTaskTimeline(String(generation), taskId);
  const displays = useUserDisplays(
    String(generation),
    history.items.flatMap((item) => (item.actorUserId ? [item.actorUserId] : []))
  );
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("taskActivity.title")}</ThemedText>
      {history.items.map((item) => (
        <View key={item.id} style={{ gap: 6, paddingVertical: 8 }}>
          <ThemedText type="small">
            {item.actorUserId
              ? displays?.get(item.actorUserId)?.nickname || item.actorUserId
              : t("taskActivity.system")}{" "}
            · {new Date(item.createdAt).toLocaleString(locale)}
          </ThemedText>
          {item.deletedAt ? (
            <ThemedText>{t("taskActivity.deleted")}</ThemedText>
          ) : (
            <>
              {item.kind !== "comment" && (
                <ThemedText>{t(taskActivityLabel(item.kind))}</ThemedText>
              )}
              {item.replyTo && (
                <ThemedText type="small">
                  {t("taskActivity.reply")}:{" "}
                  {item.replyTo.deleted ? t("taskActivity.deleted") : item.replyTo.body}
                </ThemedText>
              )}
              {!!taskActivityNote(item) && <ThemedText>{taskActivityNote(item)}</ThemedText>}
              {item.kind === "comment" && replyAccess.allowed && !history.error && (
                <Pressable
                  accessibilityRole="button"
                  disabled={replyAccess.locked}
                  onPress={() => setReply({ id: item.id, body: item.body })}
                  style={{ padding: 12 }}
                >
                  <ThemedText>{t("taskActivity.replyAction")}</ThemedText>
                </Pressable>
              )}
              {item.kind === "comment" &&
                replyAccess.allowed &&
                !history.error &&
                (item.actorUserId === userId || replyAccess.canManage) && (
                  <>
                    <TaskCommentEdit
                      item={item}
                      crewId={crewId}
                      userId={userId}
                      generation={generation}
                      disabled={replyAccess.locked}
                      onSaved={history.refresh}
                      onRefresh={history.refresh}
                    />
                    <TaskCommentRemove
                      commentId={item.id}
                      generation={generation}
                      disabled={replyAccess.locked}
                      onRemoved={() => {
                        if (reply?.id === item.id) setReply(undefined);
                        history.refresh();
                      }}
                      onRefresh={history.refresh}
                    />
                  </>
                )}
              {!!item.body && <ThemedText>{item.body}</ThemedText>}
              {!!item.editedAt && <ThemedText type="small">{t("taskActivity.edited")}</ThemedText>}
              {item.attachments.map((file) =>
                file.mediaAssetId ? (
                  <ConversationFile
                    key={file.id}
                    mediaAssetId={file.mediaAssetId}
                    name={file.name}
                    mediaKind={file.mediaKind ?? undefined}
                    contentType={file.contentType ?? undefined}
                  />
                ) : (
                  <ThemedText key={file.id}>
                    {file.name} · {t("taskActivity.unavailable")}
                  </ThemedText>
                )
              )}
            </>
          )}
        </View>
      ))}
      <TaskComment
        suspended={history.loading || !!history.error}
        crewId={crewId}
        taskId={taskId}
        userId={userId}
        generation={generation}
        onSent={history.refresh}
        reply={reply}
        onClearReply={() => setReply(undefined)}
        onReplyAvailability={setReplyAccess}
      />
      {history.loading && <ActivityIndicator />}
      {!history.loading && !history.error && history.items.length === 0 && (
        <ThemedText>{t("taskActivity.empty")}</ThemedText>
      )}
      {!!history.error && (
        <>
          <ThemedText accessibilityRole="alert">{history.error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={history.retry} style={{ padding: 12 }}>
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {history.hasMore && !history.error && (
        <Pressable
          accessibilityRole="button"
          disabled={history.loading}
          onPress={history.loadMore}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskActivity.older")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
