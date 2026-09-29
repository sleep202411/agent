import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CrewAssetPicker } from "@/features/crew-assets/asset-picker";
import type { CrewAsset } from "@/features/crew-assets/api";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { inquiryKey } from "./inquiry-api";
import {
  fetchTaskCommentPermission,
  postTaskComment,
  type TaskCommentInput,
} from "./task-comment-api";
type Props = {
  crewId: string;
  taskId: string;
  userId: string;
  generation: number;
  onSent: () => void;
  reply?: { id: string; body: string | null };
  onClearReply?: () => void;
  onReplyAvailability?: (state: { allowed: boolean; locked: boolean }) => void;
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
function Composer({
  crewId,
  taskId,
  userId,
  generation,
  onSent,
  reply,
  onClearReply,
  onReplyAvailability,
}: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const input = useRef<TextInput>(null);
  const op = useAuthFormOperation(taskId, true);
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<{ revision: number; allowed?: boolean; error?: string }>();
  const [body, setBody] = useState(""),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const intent = useRef<TaskCommentInput | undefined>(undefined);
  const [assets, setAssets] = useState<CrewAsset[]>([]);
  const [picking, setPicking] = useState(false);
  const [submittedReply, setSubmittedReply] = useState<Props["reply"]>();
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
  const allowed = current?.allowed === true;
  useEffect(() => {
    onReplyAvailability?.({ allowed, locked: attempted || op.busy || picking });
  }, [allowed, attempted, op.busy, picking, onReplyAvailability]);
  useEffect(() => {
    if (allowed && reply && !attempted) input.current?.focus();
  }, [allowed, reply, attempted]);
  const visibleReply = attempted ? submittedReply : reply;
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
        disabled={op.busy || picking || (!body.trim() && !assets.length)}
        style={{ padding: 12 }}
        onPress={() => {
          void op.run(
            async () => {
              intent.current ??= {
                body: body.trim(),
                clientKey: inquiryKey(),
                ...(reply ? { replyToId: reply.id } : {}),
                ...(assets.length
                  ? {
                      attachments: assets.map((asset) => ({
                        source: "asset" as const,
                        assetNodeId: asset.id,
                      })),
                    }
                  : {}),
              };
              if (!attempted) setSubmittedReply(reply);
              setAttempted(true);
              return postTaskComment(taskId, userId, intent.current);
            },
            () => {
              intent.current = undefined;
              setAttempted(false);
              setBody("");
              setAssets([]);
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
        disabled={op.busy || attempted || assets.length >= 10}
        onPress={() => setPicking(true)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("crewAssets.choose")}</ThemedText>
      </Pressable>
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
      {picking && (
        <Modal visible animationType="slide" onRequestClose={() => setPicking(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <CrewAssetPicker
              crewId={crewId}
              excludedIds={assets.map((asset) => asset.id)}
              remaining={10 - assets.length}
              onClose={() => setPicking(false)}
              onSelect={(selected) => {
                if (generation !== getAuthGeneration() || attempted || op.busy) return;
                setAssets((value) =>
                  Array.from(
                    new Map([...value, ...selected].map((asset) => [asset.id, asset])).values()
                  ).slice(0, 10)
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
