import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import {
  KeyboardChatScrollView,
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import {
  AGENT_OS_STORY_WORKBENCH_MODE,
  AgentApprovalCard,
  AgentComposer,
  AgentMessageList,
  AgentUserInputCard,
  agentActivityMessageKey,
  currentTurnHasAssistantReply,
  isAgentOsId,
  useAgentOsSession,
  useAgentThreadScroll,
} from "@/features/agent";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

const AGENT_INPUT_NATIVE_ID = "agent-thread-input";
const COMPOSER_BASE_HEIGHT = 88;
const COMPOSER_KEYBOARD_GAP = Spacing.two;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Agent OS conversation — HTTP start + event polling. */
export default function AgentThreadScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const extraContentPadding = useSharedValue(0);
  const { requireAuth, isAuthenticated } = useAuthGate();
  const params = useLocalSearchParams<{
    threadId?: string | string[];
    q?: string | string[];
    projectId?: string | string[];
    chapterId?: string | string[];
    mode?: string | string[];
  }>();
  const initialQuery = firstParam(params.q)?.trim() ?? "";
  const threadId = firstParam(params.threadId)?.trim() ?? "";
  const projectIdFromQuery = firstParam(params.projectId)?.trim() ?? "";
  // Prefer query; fall back to path segment when opened as `/agent/:projectId`.
  const projectId = isAgentOsId(projectIdFromQuery)
    ? projectIdFromQuery
    : isAgentOsId(threadId)
      ? threadId
      : "";
  const chapterId = firstParam(params.chapterId)?.trim() ?? "";
  const workbenchMode = firstParam(params.mode)?.trim() || AGENT_OS_STORY_WORKBENCH_MODE;
  const projectOk = isAgentOsId(projectId);

  const [draft, setDraft] = useState("");
  const live = useAgentOsSession({
    projectId: projectOk ? projectId : "",
    workbenchMode,
    chapterId: isAgentOsId(chapterId) ? chapterId : undefined,
  });

  const pendingInput = live.session.pendingUserInput;
  const pendingApproval = live.session.pendingApproval;

  useEffect(() => {
    if (!projectOk || !isAuthenticated) return;
    if (initialQuery) {
      void live.send(initialQuery);
      return;
    }
    void live.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot bootstrap
  }, [projectOk, isAuthenticated, initialQuery, projectId]);

  const topPad = insets.top + Spacing.seven;
  const waitingUser =
    live.session.status === "waiting_for_approval" || live.session.status === "waiting_for_input";
  const isExecuting =
    live.sending ||
    live.session.status === "queued" ||
    live.session.status === "running" ||
    live.session.status === "waiting_for_external";
  const restoring = live.session.status === "restoring";
  const showStop = isExecuting && !waitingUser;
  const turnHasReply = currentTurnHasAssistantReply(live.messages);
  const showActivityRow = showStop && live.activity != null && !turnHasReply;
  const activityLabel = live.activity
    ? t(agentActivityMessageKey(live.activity))
    : t("agent.activity.thinking");

  const { scrollRef, handleScroll, handleContentSizeChange, scrollToLatest, handleEndVisible } =
    useAgentThreadScroll([
      live.messages,
      showActivityRow,
      live.session.error,
      pendingInput?.requestId,
      pendingApproval?.approvalId,
    ]);

  const onSubmit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    requireAuth({
      onAuthenticated: () => {
        setDraft("");
        scrollToLatest(true);
        void live.send(text);
      },
    });
  }, [draft, live, requireAuth, scrollToLatest]);

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      extraContentPadding.value = withTiming(
        Math.max(event.nativeEvent.layout.height - COMPOSER_BASE_HEIGHT, 0),
        { duration: 250 }
      );
    },
    [extraContentPadding]
  );

  const composerHorizontalPad = {
    paddingLeft: Math.max(insets.left, Spacing.four),
    paddingRight: Math.max(insets.right, Spacing.four),
  };
  const composerClosedPad = Math.max(insets.bottom, Spacing.three);

  if (!projectOk) {
    return (
      <ThemedView style={styles.screen}>
        <Stack.Screen options={{ headerTitle: "" }} />
        <View style={[styles.missing, { paddingTop: topPad }]}>
          <ThemedText type="smallBold">{t("agent.projectRequired")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("agent.projectRequiredDetail")}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" onPress={() => router.back()}>
            {t("agent.backToHub")}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: t("agent.threadTitle"),
          headerTintColor: theme.text,
          headerBackButtonDisplayMode: "minimal",
          headerTitleStyle: { fontSize: 17, fontWeight: "600" },
        }}
      />

      <KeyboardGestureArea
        interpolator="ios"
        offset={COMPOSER_BASE_HEIGHT}
        style={styles.flex}
        textInputNativeID={AGENT_INPUT_NATIVE_ID}
      >
        {restoring && live.messages.length === 0 ? (
          <View style={styles.restoreCenter}>
            <ActivityIndicator color={theme.brand} />
          </View>
        ) : (
          <KeyboardChatScrollView
            ref={scrollRef as never}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            alwaysBounceVertical
            extraContentPadding={extraContentPadding}
            keyboardDismissMode="on-drag"
            keyboardLiftBehavior="whenAtEnd"
            keyboardShouldPersistTaps="handled"
            offset={Math.max(0, insets.bottom - COMPOSER_KEYBOARD_GAP)}
            onContentSizeChange={handleContentSizeChange}
            onEndVisible={handleEndVisible}
            onScroll={handleScroll}
            onScrollBeginDrag={() => {
              Keyboard.dismiss();
            }}
            scrollEventThrottle={16}
            applyWorkaroundForContentInsetHitTestBug={Platform.OS === "ios"}
            style={[styles.flex, { backgroundColor: theme.background }]}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingTop: topPad,
                paddingBottom: Spacing.four,
                paddingLeft: composerHorizontalPad.paddingLeft,
                paddingRight: composerHorizontalPad.paddingRight,
              },
            ]}
          >
            {live.session.error ? (
              <ThemedText type="small" style={{ color: theme.brand }}>
                {live.session.error}
              </ThemedText>
            ) : null}

            <AgentMessageList messages={live.messages} />

            {showActivityRow ? (
              <View style={styles.activityRow}>
                <ActivityIndicator color={theme.textSecondary} size="small" />
                <ThemedText type="small" themeColor="textSecondary">
                  {activityLabel}
                </ThemedText>
              </View>
            ) : null}
          </KeyboardChatScrollView>
        )}

        <KeyboardStickyView offset={{ opened: composerClosedPad - COMPOSER_KEYBOARD_GAP }}>
          <View
            onLayout={onComposerLayout}
            style={[
              styles.composerBar,
              {
                paddingBottom: composerClosedPad,
                paddingLeft: composerHorizontalPad.paddingLeft,
                paddingRight: composerHorizontalPad.paddingRight,
              },
            ]}
          >
            {pendingInput ? (
              <AgentUserInputCard
                request={pendingInput}
                busy={live.sending}
                onSubmit={(answers) => {
                  scrollToLatest(true);
                  void live.answerUserInput(answers);
                }}
              />
            ) : pendingApproval ? (
              <AgentApprovalCard
                approval={pendingApproval}
                busy={live.sending}
                onResolve={(decision) => {
                  scrollToLatest(true);
                  void live.approve(decision);
                }}
              />
            ) : (
              <AgentComposer
                value={draft}
                onChangeText={setDraft}
                onSubmit={onSubmit}
                placeholder={t("agent.threadPlaceholder")}
                variant="thread"
                submitAccessibilityLabel={t("agent.send")}
                busy={showStop}
                onStop={() => void live.cancel()}
                stopAccessibilityLabel={t("agent.stop")}
                sendDisabled={isExecuting || restoring}
                modelProfileId={live.session.modelProfileId ?? live.models[0]?.id ?? undefined}
                modelOptions={live.models}
                onModelProfileChange={live.setModelProfileId}
                modelMenuLabel={t("agent.modelProfile")}
                modelMenuDisabled={isExecuting || restoring}
                nativeID={AGENT_INPUT_NATIVE_ID}
              />
            )}
          </View>
        </KeyboardStickyView>
      </KeyboardGestureArea>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexGrow: 1,
    justifyContent: "flex-end",
    gap: Spacing.four,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  restoreCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  composerBar: {
    paddingTop: Spacing.three,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  missing: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
});
