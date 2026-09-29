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
import { inboxPreview } from "./inbox-preview";
import { ConversationProposal, ConversationProposalEditor } from "./conversation-proposal-ui";
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
    history.detail?.participants.map((p) => p.userId) ?? []
  );
  const op = useAuthFormOperation(id, active);
  const [body, setBody] = useState(""),
    [sendError, setSendError] = useState<string>();
  const intent = useRef<{ body: string; clientKey: string } | undefined>(undefined);
  const [visibleId, setVisibleId] = useState<string>(),
    [readError, setReadError] = useState<string>(),
    [readRetry, setReadRetry] = useState(0);
  const [viewConfig] = useState({ itemVisiblePercentThreshold: 80, minimumViewTime: 500 });
  const [attempted, setAttempted] = useState(false);
  const detailId = history.detail?.id;
  const contextType = history.detail?.contextType;
  useEffect(() => {
    if (!active || !visibleId || !detailId || contextType === "crew") return;
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
  }, [id, visibleId, active, detailId, contextType, readRetry]);
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
  if (history.detail?.contextType === "crew")
    return (
      <AuthedWebView
        path={`/messages/${encodeURIComponent(id)}`}
        title={t("serviceContact.open")}
      />
    );
  if (!history.detail)
    return (
      <View style={{ padding: 16 }}>
        {history.loading && <ActivityIndicator />}
        {history.error && <ThemedText accessibilityRole="alert">{history.error}</ThemedText>}
        {button(t("inbox.retry"), history.retry, history.loading)}
      </View>
    );
  const conversation = history.detail;
  const openOrder = (orderId: string) =>
    router.push(toHref(`/order/${encodeURIComponent(orderId)}`));
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flexDirection: "row", paddingHorizontal: 12 }}>
        {button(
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
                {item.type === "system"
                  ? inboxPreview(
                      {
                        lastMessageType: "system",
                        lastMessagePreview: `[system:${item.payload?.kind === "system" ? item.payload.system.kind : ""}]`,
                      },
                      t
                    )
                  : item.body}
              </ThemedText>
            )}
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
        <TextInput
          accessibilityLabel={t("thread.message")}
          placeholder={t("thread.message")}
          placeholderTextColor={theme.text}
          multiline
          maxLength={4000}
          value={body}
          editable={!op.busy && !attempted}
          onChangeText={setBody}
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
          disabled={op.busy || !body.trim()}
          onPress={() => {
            if (!body.trim()) return;
            if (!intent.current) intent.current = { body: body.trim(), clientKey: inquiryKey() };
            const submitted = intent.current;
            setAttempted(true);
            void op.run(
              () => sendConversationText(id, submitted),
              () => {
                intent.current = undefined;
                setAttempted(false);
                setBody("");
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
