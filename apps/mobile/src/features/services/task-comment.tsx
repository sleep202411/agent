import { taskCommentOutbox } from "./task-comment-outbox";
import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  pickAndUploadCrewFile,
  discardCrewUpload,
  type CrewUpload,
} from "@/features/crew-assets/upload";
import { CrewAssetPicker } from "@/features/crew-assets/asset-picker";
import type { CrewAsset } from "@/features/crew-assets/api";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { TaskMentionPicker } from "./task-mention-picker";
import type { TaskMention } from "./task-mentions";
import { clientRequestKey } from "@/lib/client-request-key";
import { fetchTaskCommentAccess, postTaskComment, type TaskCommentInput } from "./task-comment-api";
type Props = {
  suspended?: boolean;
  crewId: string;
  taskId: string;
  userId: string;
  generation: number;
  onSent: () => void;
  reply?: { id: string; body: string | null };
  onClearReply?: () => void;
  onReplyAvailability?: (state: { allowed: boolean; locked: boolean; canManage?: boolean }) => void;
};
export function TaskComment(props: Props) {
  const focused = useIsFocused();
  return focused && props.generation === getAuthGeneration() ? (
    <Composer
      key={`${props.crewId}:${props.taskId}:${props.userId}:${props.generation}`}
      {...props}
    />
  ) : null;
}
function Composer({
  suspended = false,
  crewId,
  taskId,
  userId,
  generation,
  onSent,
  reply,
  onClearReply,
  onReplyAvailability,
}: Props) {
  const active = useScreenActive() && !suspended;
  const t = useTranslations(),
    theme = useTheme();
  const input = useRef<TextInput>(null);
  const op = useAuthFormOperation(taskId, true);
  const [revision, setRevision] = useState(0);
  const accessScope = useMemo(() => ({ active, revision }), [active, revision]);
  const [access, setAccess] = useState<{
    scope: typeof accessScope;
    allowed?: boolean;
    canManage?: boolean;
    error?: string;
  }>();
  const [outbox] = useState(() => taskCommentOutbox(crewId, taskId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: undefined };
    } catch (cause) {
      return { pending: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [body, setBody] = useState(initial.pending?.comment.body ?? ""),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(!!initial.pending);
  const intent = useRef<TaskCommentInput | undefined>(initial.pending?.comment);
  const [pendingAttachmentCount, setPendingAttachmentCount] = useState(
    initial.pending?.comment.attachments?.length ?? 0
  );
  const [mentions, setMentions] = useState<TaskMention[]>(initial.pending?.comment.mentions ?? []);
  const [mentionPicker, setMentionPicker] = useState(false);
  const [assets, setAssets] = useState<CrewAsset[]>([]);
  const [uploads, setUploads] = useState<CrewUpload[]>(
    initial.pending?.comment.attachments?.filter(
      (file): file is CrewUpload => file.source === "upload"
    ) ?? []
  );
  const [uploading, setUploading] = useState(false);
  const uploadRequest = useRef<AbortController | undefined>(undefined);
  const pendingUploads = useRef<{ items: CrewUpload[]; attempted: boolean }>({
    items: [],
    attempted: !!initial.pending,
  });
  useEffect(
    () => () => {
      uploadRequest.current?.abort();
      if (generation !== getAuthGeneration() || pendingUploads.current.attempted) return;
      for (const file of pendingUploads.current.items)
        void discardCrewUpload(crewId, file.mediaAssetId).catch(() => undefined);
    },
    [crewId, generation]
  );
  const [picking, setPicking] = useState(false);
  const [submittedReply, setSubmittedReply] = useState<Props["reply"]>(initial.pending?.reply);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void fetchTaskCommentAccess(crewId, userId, controller.signal).then(
      (access) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAccess({ scope: accessScope, ...access });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAccess({
            scope: accessScope,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    );
    return () => controller.abort();
  }, [crewId, userId, generation, active, accessScope]);
  const current = access?.scope === accessScope ? access : undefined;
  const allowed = current?.allowed === true;
  const canManage = allowed && current?.canManage === true;
  useEffect(() => {
    onReplyAvailability?.({
      allowed,
      canManage,
      locked: !!initial.error || attempted || op.busy || picking || uploading,
    });
  }, [
    allowed,
    canManage,
    attempted,
    op.busy,
    picking,
    uploading,
    onReplyAvailability,
    initial.error,
  ]);
  useEffect(() => {
    if (allowed && reply && !attempted) input.current?.focus();
  }, [allowed, reply, attempted]);
  const visibleReply = attempted ? submittedReply : reply;
  if (!active) return null;
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
  if (initial.error) return <ThemedText accessibilityRole="alert">{initial.error}</ThemedText>;
  return (
    <View style={{ gap: 8 }}>
      {visibleReply && (
        <View>
          <ThemedText numberOfLines={3}>
            {t("taskActivity.reply")}: {visibleReply.body || t("taskActivity.attachmentComment")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={attempted || op.busy}
            onPress={onClearReply}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("taskActivity.cancelReply")}</ThemedText>
          </Pressable>
        </View>
      )}
      <TextInput
        ref={input}
        multiline
        accessibilityLabel={t("taskActivity.writeComment")}
        placeholder={t("taskActivity.writeComment")}
        placeholderTextColor={theme.textSecondary}
        value={body}
        onChangeText={(value) => {
          setBody(value);
          setMentions((items) => items.filter((item) => value.includes(`@${item.label}`)));
        }}
        editable={!op.busy && !attempted}
        maxLength={10000}
        style={{ color: theme.text, minHeight: 80, padding: 12 }}
      />
      {attempted && pendingAttachmentCount > 0 && (
        <ThemedText>
          {t("thread.pendingAttachments")}: {pendingAttachmentCount}
        </ThemedText>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && (
        <ThemedText type="small">{t("taskActivity.retryCommentHint")}</ThemedText>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={
          op.busy ||
          picking ||
          uploading ||
          (!attempted && !body.trim() && !assets.length && !uploads.length)
        }
        style={{ padding: 12 }}
        onPress={() => {
          void op.run(
            async () => {
              const pending = intent.current ?? {
                body: body.trim(),
                clientKey: clientRequestKey(),
                ...(reply ? { replyToId: reply.id } : {}),
                ...(mentions.length
                  ? { mentions: mentions.filter((item) => body.includes(`@${item.label}`)) }
                  : {}),
                ...(assets.length || uploads.length
                  ? {
                      attachments: [
                        ...assets.map((asset) => ({
                          source: "asset" as const,
                          assetNodeId: asset.id,
                        })),
                        ...uploads,
                      ],
                    }
                  : {}),
              };
              const target = attempted ? submittedReply : reply;
              outbox.save({
                clientKey: pending.clientKey,
                comment: pending,
                ...(target ? { reply: target } : {}),
              });
              intent.current = pending;
              if (!attempted) setSubmittedReply(reply);
              setPendingAttachmentCount(pending.attachments?.length ?? 0);
              pendingUploads.current.attempted = true;
              setAttempted(true);
              const result = await postTaskComment(taskId, userId, pending);
              outbox.clear(pending.clientKey);
              return result;
            },
            () => {
              intent.current = undefined;
              setAttempted(false);
              setPendingAttachmentCount(0);
              setBody("");
              setMentions([]);
              setMentionPicker(false);
              setAssets([]);
              pendingUploads.current = { items: [], attempted: false };
              setUploads([]);
              setSubmittedReply(undefined);
              onClearReply?.();
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
      <Pressable
        accessibilityRole="button"
        disabled={op.busy || attempted || uploading || assets.length + uploads.length >= 10}
        onPress={() => setPicking(true)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("crewAssets.choose")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={
          op.busy || attempted || uploading || picking || assets.length + uploads.length >= 10
        }
        onPress={() => {
          if (uploadRequest.current) return;
          const controller = new AbortController();
          uploadRequest.current = controller;
          setUploading(true);
          setError(undefined);
          void (async () => {
            try {
              const file = await pickAndUploadCrewFile(crewId, controller.signal);
              if (!file) return;
              if (controller.signal.aborted || generation !== getAuthGeneration()) {
                if (generation === getAuthGeneration())
                  void discardCrewUpload(crewId, file.mediaAssetId).catch(() => undefined);
                return;
              }
              pendingUploads.current.items = [...pendingUploads.current.items, file];
              setUploads(pendingUploads.current.items);
            } catch (cause) {
              if (!controller.signal.aborted && generation === getAuthGeneration())
                setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              if (uploadRequest.current === controller) {
                uploadRequest.current = undefined;
                if (!controller.signal.aborted) setUploading(false);
              }
            }
          })();
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("thread.uploadFile")}</ThemedText>
      </Pressable>
      {uploading && <ActivityIndicator accessibilityLabel={t("courses.loading")} />}
      {uploads.map((file) => (
        <Pressable
          key={file.mediaAssetId}
          accessibilityRole="button"
          disabled={op.busy || attempted || uploading}
          onPress={() => {
            pendingUploads.current.items = pendingUploads.current.items.filter(
              (item) => item.mediaAssetId !== file.mediaAssetId
            );
            setUploads(pendingUploads.current.items);
            void discardCrewUpload(crewId, file.mediaAssetId).catch(() => undefined);
          }}
          style={{ padding: 12 }}
        >
          <ThemedText>
            {file.name} · {t("crewAssets.remove")}
          </ThemedText>
        </Pressable>
      ))}
      {assets.map((asset) => (
        <Pressable
          key={asset.id}
          accessibilityRole="button"
          disabled={op.busy || attempted}
          onPress={() => setAssets((value) => value.filter((item) => item.id !== asset.id))}
          style={{ padding: 12 }}
        >
          <ThemedText>
            {asset.name} · {t("crewAssets.remove")}
          </ThemedText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy || attempted || uploading || picking || mentions.length >= 20}
        onPress={() => setMentionPicker(true)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("thread.mention")}</ThemedText>
      </Pressable>
      {mentionPicker && (
        <Modal visible animationType="slide" onRequestClose={() => setMentionPicker(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <TaskMentionPicker
              crewId={crewId}
              userId={userId}
              generation={generation}
              excludedIds={mentions.map((item) => item.userId)}
              onClose={() => setMentionPicker(false)}
              onSelect={(mention) => {
                if (generation !== getAuthGeneration() || attempted || op.busy) return;
                const next = `${body}${body && !/\s$/.test(body) ? " " : ""}@${mention.label} `;
                if (next.length > 10000) {
                  setError(t("taskActivity.mentionTooLong"));
                  setMentionPicker(false);
                  return;
                }
                setBody(next);
                setMentions((items) =>
                  [...items.filter((item) => item.userId !== mention.userId), mention].slice(0, 20)
                );
                setMentionPicker(false);
                input.current?.focus();
              }}
            />
          </SafeAreaView>
        </Modal>
      )}
      {picking && (
        <Modal visible animationType="slide" onRequestClose={() => setPicking(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <CrewAssetPicker
              crewId={crewId}
              excludedIds={assets.map((asset) => asset.id)}
              remaining={10 - assets.length - uploads.length}
              onClose={() => setPicking(false)}
              onSelect={(selected) => {
                if (generation !== getAuthGeneration() || attempted || op.busy) return;
                setAssets((value) =>
                  Array.from(
                    new Map([...value, ...selected].map((asset) => [asset.id, asset])).values()
                  ).slice(0, 10 - uploads.length)
                );
                setPicking(false);
              }}
            />
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
