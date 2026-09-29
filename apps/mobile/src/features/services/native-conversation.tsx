import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type ViewToken,
} from "react-native";
import { useRouter } from "expo-router";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  pickAndUploadCrewFile,
  discardCrewUpload,
  type CrewUpload,
} from "@/features/crew-assets/upload";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { toHref } from "@/lib/navigation";
import { markConversationRead, sendConversationText, type NativeMessage } from "./conversation-api";
import { useConversationHistory } from "./use-conversation-history";
import { useInboxRealtime } from "./use-inbox-realtime";
import { useUserDisplays } from "./user-displays";
import { inquiryKey } from "./inquiry-api";
import { conversationActivity, conversationDisplayIds } from "./conversation-activity";
import { ConversationProposal, ConversationProposalEditor } from "./conversation-proposal-ui";
import { CrewAssetPicker } from "@/features/crew-assets/asset-picker";
import type { CrewAsset } from "@/features/crew-assets/api";
import { canAttachCrewFiles, sendConversationAttachments } from "./conversation-attachments";
import { TaskDetail } from "./task-detail";
import { TaskPicker } from "./task-picker";
import { taskLabel } from "./task-options";
import { ConversationFile } from "./conversation-file";
import { AuthedWebView } from "@/components/authed-web-view";

export function NativeConversation({
  id,
  userId,
  generation,
}: {
  id: string;
  userId: string;
  generation: number;
}) {
  const active = useScreenActive(),
    t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  const history = useConversationHistory(id, userId, generation, active);
  const unavailable = useInboxRealtime(userId, generation, active, history.refresh);
  const displays = useUserDisplays(
    active ? String(generation) : undefined,
    conversationDisplayIds(
      history.detail?.participants.map((p) => p.userId) ?? [],
      history.messages
    )
  );
  const op = useAuthFormOperation(id, active);
  const [body, setBody] = useState(""),
    [sendError, setSendError] = useState<string>();
  const [assets, setAssets] = useState<CrewAsset[]>([]),
    [picking, setPicking] = useState(false),
    [web, setWeb] = useState(false);
  const [uploads, setUploads] = useState<CrewUpload[]>([]),
    [uploading, setUploading] = useState(false);
  const uploadRequest = useRef<AbortController | undefined>(undefined);
  const pendingUploads = useRef<{ crewId: string; items: CrewUpload[]; attempted: boolean }>({
    crewId: "",
    items: [],
    attempted: false,
  });
  useEffect(
    () => () => {
      uploadRequest.current?.abort();
    },
    [active]
  );
  useEffect(
    () => () => {
      const pending = pendingUploads.current;
      if (generation !== getAuthGeneration() || pending.attempted) return;
      for (const file of pending.items)
        void discardCrewUpload(pending.crewId, file.mediaAssetId).catch(() => undefined);
    },
    [generation]
  );
  const [mentions, setMentions] = useState<{ userId: string; label: string }[]>([]),
    [mentionPicker, setMentionPicker] = useState(false),
    [mentionQuery, setMentionQuery] = useState("");
  const [taskPicker, setTaskPicker] = useState(false),
    [taskReferences, setTaskReferences] = useState<{ taskId: string; label: string }[]>([]);
  const [selectedTask, setSelectedTask] = useState<{ crewId: string; taskId: string }>();
  const [taskTarget, setTaskTarget] = useState<string>();
  const intent = useRef<
    | {
        body: string;
        clientKey: string;
        attachments: ({ source: "asset"; assetNodeId: string } | CrewUpload)[];
        mentions?: { userId: string; label: string }[];
        tasks?: { taskId: string; label: string }[];
      }
    | undefined
  >(undefined);
  const [visibleId, setVisibleId] = useState<string>(),
    [readError, setReadError] = useState<string>(),
    [readRetry, setReadRetry] = useState(0);
  const [viewConfig] = useState({ itemVisiblePercentThreshold: 80, minimumViewTime: 500 });
  const [attempted, setAttempted] = useState(false);
  const detailId = history.detail?.id;
  const contextType = history.detail?.contextType;
  const crewChannel = history.detail?.crewChannel;
  const requiresWeb =
    contextType === "crew" && crewChannel !== "team" && crewChannel !== "community";
  useEffect(() => {
    if (!active || !visibleId || !detailId || web || requiresWeb || selectedTask) return;
    const controller = new AbortController();
    void markConversationRead(id, visibleId, controller.signal).then(
      () => {
        if (!controller.signal.aborted) setReadError(undefined);
      },
      (cause) => {
        if (!controller.signal.aborted)
          setReadError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [id, visibleId, active, detailId, requiresWeb, web, readRetry, selectedTask]);
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 10 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  if (web || requiresWeb)
    return (
      <View style={{ flex: 1 }}>
        {web && button(t("thread.backToChat"), () => setWeb(false))}
        <AuthedWebView
          path={taskTarget ?? `/messages/${encodeURIComponent(id)}`}
          title={t("serviceContact.open")}
        />
      </View>
    );
  if (!history.detail)
    return (
      <View style={{ padding: 16 }}>
        {history.loading && <ActivityIndicator />}
        {history.error && <ThemedText accessibilityRole="alert">{history.error}</ThemedText>}
        {button(t("inbox.retry"), history.retry, history.loading)}
      </View>
    );
  if (selectedTask)
    return (
      <TaskDetail
        {...selectedTask}
        userId={userId}
        generation={generation}
        onClose={() => setSelectedTask(undefined)}
        onOpenWeb={(taskId) => {
          setTaskTarget(
            `/crews/${encodeURIComponent(selectedTask.crewId)}/workspace?tab=tasks&task=${encodeURIComponent(taskId)}`
          );
          setSelectedTask(undefined);
          setWeb(true);
        }}
      />
    );
  const conversation = history.detail;
  const canAttach = canAttachCrewFiles(conversation, userId);
  if (taskPicker && canAttach)
    return (
      <TaskPicker
        crewId={conversation.contextId}
        generation={generation}
        onClose={() => setTaskPicker(false)}
        onSelect={(task) => {
          const label = taskLabel(task);
          if (body.length + label.length + 3 > 4000) {
            setSendError(t("thread.taskTooLong"));
            setTaskPicker(false);
            return;
          }
          setBody((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}#${label} `);
          setTaskReferences((value) => [
            ...value.filter((item) => item.taskId !== task.id),
            { taskId: task.id, label },
          ]);
          setTaskPicker(false);
        }}
      />
    );
  if (picking && canAttach)
    return (
      <CrewAssetPicker
        crewId={conversation.contextId}
        excludedIds={assets.map((a) => a.id)}
        remaining={10 - assets.length - uploads.length}
        onClose={() => setPicking(false)}
        onSelect={(selected) => {
          setAssets((previous) =>
            Array.from(new Map([...previous, ...selected].map((a) => [a.id, a])).values()).slice(
              0,
              10
            )
          );
          setPicking(false);
        }}
      />
    );
  const openOrder = (orderId: string) =>
    router.push(toHref(`/order/${encodeURIComponent(orderId)}`));
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {conversation.contextType === "crew" && (
        <ThemedText type="smallBold" style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          {t(conversation.crewChannel === "community" ? "thread.communityChat" : "thread.teamChat")}
        </ThemedText>
      )}
      <View style={{ flexDirection: "row", paddingHorizontal: 12 }}>
        {conversation.contextType === "crew"
          ? button(
              t("thread.openWebChat"),
              () => {
                setTaskTarget(undefined);
                setWeb(true);
              },
              uploading || op.busy
            )
          : button(
              t(conversation.contextType === "order" ? "thread.openOrder" : "thread.openService"),
              () =>
                conversation.contextType === "order"
                  ? openOrder(conversation.contextId)
                  : router.push(toHref(`/service/${encodeURIComponent(conversation.contextId)}`))
            )}
        {button(t("thread.refresh"), history.refresh, history.loading)}
      </View>
      {unavailable && <ThemedText>{t("inbox.liveUnavailable")}</ThemedText>}
      <FlatList
        data={[...history.messages].reverse()}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12 }}
        keyboardShouldPersistTaps="handled"
        viewabilityConfig={viewConfig}
        onViewableItemsChanged={({
          viewableItems,
        }: {
          viewableItems: ViewToken<NativeMessage>[];
        }) => {
          const newest = [...viewableItems]
            .filter((v) => v.isViewable && v.index !== null)
            .sort((a, b) => a.index! - b.index!)[0];
          if (newest) setVisibleId(newest.item.id);
        }}
        onEndReached={history.loadOlder}
        ListEmptyComponent={!history.loading ? <ThemedText>{t("thread.empty")}</ThemedText> : null}
        ListFooterComponent={
          <View>
            {history.loading && <ActivityIndicator />}
            {history.error && (
              <>
                <ThemedText accessibilityRole="alert">{history.error}</ThemedText>
                {button(t("inbox.retry"), history.retry)}
              </>
            )}
            {history.hasMore && button(t("thread.older"), history.loadOlder, history.loading)}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: 12, gap: 4 }}>
            {item.authorId && (
              <ThemedText type="smallBold">
                {item.authorId === userId
                  ? t("thread.you")
                  : displays?.get(item.authorId)?.nickname ||
                    `${t("inbox.person")} ${item.authorId}`}
              </ThemedText>
            )}
            {item.type === "proposal" ? (
              <ConversationProposal
                key={`${item.id}:${item.payload?.kind === "proposal" ? item.payload.proposal.status : ""}:${conversation.contextType}`}
                conversation={conversation}
                message={item}
                userId={userId}
                refresh={history.refresh}
                openOrder={openOrder}
              />
            ) : (
              <ThemedText selectable>
                {item.type === "system" ? conversationActivity(item, displays, t) : item.body}
              </ThemedText>
            )}
            {item.payload?.kind === "attachments" &&
              item.payload.attachments.map((file) => (
                <ConversationFile
                  key={file.assetNodeId}
                  mediaAssetId={file.mediaAssetId}
                  mediaKind={file.mediaKind}
                  contentType={file.contentType}
                  name={file.name}
                />
              ))}
            {conversation.contextType === "crew" &&
              (item.payload?.kind === "text" || item.payload?.kind === "attachments") &&
              item.payload.tasks
                ?.filter((task) => task.crewId === conversation.contextId)
                .map((task) => (
                  <Pressable
                    key={task.taskId}
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedTask({ crewId: task.crewId, taskId: task.taskId });
                    }}
                    style={{ padding: 10 }}
                  >
                    <ThemedText>#{task.label}</ThemedText>
                  </Pressable>
                ))}
            <ThemedText type="small">
              {Number.isNaN(Date.parse(item.createdAt))
                ? ""
                : new Date(item.createdAt).toLocaleString()}
            </ThemedText>
          </View>
        )}
      />
      {readError && (
        <View>
          <ThemedText accessibilityRole="alert">{readError}</ThemedText>
          {button(t("inbox.retry"), () => setReadRetry((value) => value + 1))}
        </View>
      )}
      <View style={{ padding: 12, gap: 8, maxHeight: "50%" }}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <ConversationProposalEditor
            conversation={conversation}
            userId={userId}
            refresh={history.refresh}
          />
        </ScrollView>
        {canAttach && (
          <View>
            {button(
              t("crewAssets.choose"),
              () => setPicking(true),
              op.busy || attempted || uploading || assets.length + uploads.length >= 10
            )}
            <Pressable
              accessibilityRole="button"
              disabled={op.busy || attempted || uploading || assets.length + uploads.length >= 10}
              onPress={() => {
                if (!active || uploadRequest.current || pendingUploads.current.attempted) return;
                const controller = new AbortController();
                uploadRequest.current = controller;
                setUploading(true);
                setSendError(undefined);
                void (async () => {
                  try {
                    const file = await pickAndUploadCrewFile(
                      conversation.contextId,
                      controller.signal
                    );
                    if (!file) return;
                    if (controller.signal.aborted || generation !== getAuthGeneration()) {
                      if (generation === getAuthGeneration())
                        void discardCrewUpload(conversation.contextId, file.mediaAssetId).catch(
                          () => undefined
                        );
                      return;
                    }
                    pendingUploads.current = {
                      crewId: conversation.contextId,
                      items: [...pendingUploads.current.items, file],
                      attempted: false,
                    };
                    setUploads(pendingUploads.current.items);
                  } catch (cause) {
                    if (!controller.signal.aborted && generation === getAuthGeneration())
                      setSendError(cause instanceof Error ? cause.message : String(cause));
                  } finally {
                    if (uploadRequest.current === controller) {
                      uploadRequest.current = undefined;
                      setUploading(false);
                    }
                  }
                })();
              }}
              style={{ padding: 10 }}
            >
              <ThemedText>{t("thread.uploadFile")}</ThemedText>
            </Pressable>
            {uploading && <ActivityIndicator />}
            <ScrollView horizontal>
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
                    void discardCrewUpload(conversation.contextId, file.mediaAssetId).catch(
                      () => undefined
                    );
                  }}
                  style={{ padding: 10 }}
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
                  onPress={() => setAssets((previous) => previous.filter((a) => a.id !== asset.id))}
                  style={{ padding: 10 }}
                >
                  <ThemedText>
                    {asset.name} · {t("crewAssets.remove")}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        {canAttach && (
          <View>
            {button(
              t("thread.tagTask"),
              () => setTaskPicker(true),
              op.busy || attempted || uploading || taskReferences.length >= 20
            )}
            {button(
              t("thread.mention"),
              () => {
                setMentionPicker((v) => !v);
                setMentionQuery("");
              },
              op.busy || attempted || mentions.length >= 20
            )}
            {mentionPicker && (
              <View>
                <TextInput
                  accessibilityLabel={t("thread.findMember")}
                  value={mentionQuery}
                  onChangeText={setMentionQuery}
                  editable={!op.busy && !attempted}
                  style={{ color: theme.text, padding: 10 }}
                />
                <ScrollView style={{ maxHeight: 140 }} keyboardShouldPersistTaps="handled">
                  {conversation.participants
                    .filter((p) => p.userId !== userId)
                    .map((p) => ({
                      userId: p.userId,
                      label:
                        (displays?.get(p.userId)?.nickname || p.userId)
                          .replace(/[@\r\n]/g, " ")
                          .trim()
                          .slice(0, 80) || p.userId,
                    }))
                    .filter((p) =>
                      p.label.toLocaleLowerCase().includes(mentionQuery.toLocaleLowerCase())
                    )
                    .map((p) => (
                      <Pressable
                        key={p.userId}
                        accessibilityRole="button"
                        disabled={op.busy || attempted || body.length + p.label.length + 3 > 4000}
                        onPress={() => {
                          setBody(
                            (value) =>
                              `${value}${value && !/\s$/.test(value) ? " " : ""}@${p.label} `
                          );
                          setMentions((value) => [
                            ...value.filter((m) => m.userId !== p.userId),
                            p,
                          ]);
                          setMentionPicker(false);
                        }}
                        style={{ padding: 10 }}
                      >
                        <ThemedText>@{p.label}</ThemedText>
                      </Pressable>
                    ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}
        <TextInput
          accessibilityLabel={t("thread.message")}
          placeholder={t("thread.message")}
          placeholderTextColor={theme.text}
          multiline
          maxLength={4000}
          value={body}
          editable={!op.busy && !attempted}
          onChangeText={(value) => {
            setBody(value);
            setTaskReferences((previous) =>
              previous.filter((task) => value.includes(`#${task.label}`))
            );
            setMentions((previous) => previous.filter((m) => value.includes(`@${m.label}`)));
          }}
          style={{
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderRadius: 8,
            padding: 12,
            maxHeight: 100,
          }}
        />
        {attempted && <ThemedText>{t("thread.retryHint")}</ThemedText>}
        {sendError && <ThemedText accessibilityRole="alert">{sendError}</ThemedText>}
        <Pressable
          accessibilityRole="button"
          disabled={op.busy || uploading || (!body.trim() && !assets.length && !uploads.length)}
          onPress={() => {
            if (uploadRequest.current || (!body.trim() && !assets.length && !uploads.length))
              return;
            if (!intent.current)
              intent.current = {
                body: body.trim(),
                clientKey: inquiryKey(),
                ...(canAttach && taskReferences.length
                  ? { tasks: taskReferences.filter((task) => body.includes(`#${task.label}`)) }
                  : {}),
                ...(canAttach && mentions.length
                  ? { mentions: mentions.filter((m) => body.includes(`@${m.label}`)) }
                  : {}),
                attachments: [
                  ...assets.map((a) => ({ source: "asset" as const, assetNodeId: a.id })),
                  ...uploads,
                ],
              };
            const submitted = intent.current;
            pendingUploads.current.attempted = true;
            setAttempted(true);
            void op.run(
              () =>
                submitted.attachments.length
                  ? sendConversationAttachments(conversation, userId, submitted)
                  : sendConversationText(id, {
                      body: submitted.body,
                      clientKey: submitted.clientKey,
                      ...(submitted.tasks ? { tasks: submitted.tasks } : {}),
                      ...(submitted.mentions ? { mentions: submitted.mentions } : {}),
                    }),
              () => {
                intent.current = undefined;
                setAttempted(false);
                setBody("");
                setMentions([]);
                setTaskReferences([]);
                setTaskPicker(false);
                setMentionPicker(false);
                setAssets([]);
                pendingUploads.current.items = [];
                pendingUploads.current.attempted = false;
                setUploads([]);
                setSendError(undefined);
                history.refresh();
              },
              (cause) => setSendError(cause instanceof Error ? cause.message : String(cause))
            );
          }}
          style={{ padding: 10 }}
        >
          <ThemedText>{t(attempted ? "inbox.retry" : "thread.send")}</ThemedText>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
