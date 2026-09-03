import IconClockPause from "@tabler/icons-react-native/icons/IconClockPause";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { AGENT_OS_STORY_WORKBENCH_MODE } from "@/features/agent/api/studio-projects-api";
import { AgentApprovalCard } from "@/features/agent/components/agent-approval-card";
import { AgentComposer } from "@/features/agent/components/agent-composer";
import { AgentOsModelSettingsSheet } from "@/features/agent/components/agent-os-model-settings-sheet";
import { AgentMessageList } from "@/features/agent/components/agent-message-list";
import { AgentUserInputCard } from "@/features/agent/components/agent-user-input-card";
import { StoryAuthoringDecision } from "@/features/agent/components/story-authoring-decision";
import { StoryAuthoringProposalCard } from "@/features/agent/components/story-authoring-proposal-card";
import { StoryChatHeaderActions } from "@/features/agent/components/story-chat-header-actions";
import { StoryGenerationBatchTranscript } from "@/features/agent/components/story-generation-batch-transcript";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { useAgentOsSession } from "@/features/agent/hooks/use-agent-os-session";
import { useAgentThreadScroll } from "@/features/agent/hooks/use-agent-thread-scroll";
import {
  useStoryAgentRunById,
  useStoryAuthoringRun,
} from "@/features/agent/hooks/use-story-authoring-run";
import { agentActivityMessageKey } from "@/features/agent/lib/agent-os-events";
import { isAgentOsId } from "@/features/agent/lib/ids";
import {
  storyAgentRunIdFromApproval,
  storyAuthoringActivityMessageKey,
  storyProposalAssetCount,
  storyProposalStageFromSchema,
} from "@/features/agent/lib/story-authoring-activity";
import { isStoryStageProposalArtifact } from "@/features/agent/types";
import {
  STORY_HEADER_CONTENT_GAP,
  STORY_TAB_BAR_CONTENT_HEIGHT,
} from "@/features/agent/lib/story-tab-bar";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

const AGENT_INPUT_NATIVE_ID = "agent-thread-input";
const COMPOSER_BASE_HEIGHT = 88;

/** Agent OS conversation — HTTP start + event polling. */
export default function AgentChatScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requireAuth, isAuthenticated } = useAuthGate();
  const params = useLocalSearchParams<{
    projectId: string;
    q?: string;
    prefill?: string;
    chapterId?: string;
    mode?: string;
  }>();
  const initialQuery = params.q?.trim() ?? "";
  const prefillDraft = params.prefill?.trim() ?? "";
  const projectId = params.projectId?.trim() ?? "";
  const chapterFromQuery = params.chapterId?.trim() ?? "";
  const { chapterId: chapterFromContext } = useStoryChapterContext();
  const chapterId = isAgentOsId(chapterFromQuery) ? chapterFromQuery : chapterFromContext;
  const workbenchMode = params.mode?.trim() || AGENT_OS_STORY_WORKBENCH_MODE;
  const projectOk = isAgentOsId(projectId);

  const [draft, setDraft] = useState(prefillDraft);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const live = useAgentOsSession({
    projectId: projectOk ? projectId : "",
    workbenchMode,
    chapterId: isAgentOsId(chapterId) ? chapterId : undefined,
  });

  const pendingInput = live.session.pendingUserInput;
  const pendingApproval = live.session.pendingApproval;

  useEffect(() => {
    if (!prefillDraft) return;
    setDraft(prefillDraft);
  }, [prefillDraft]);

  useEffect(() => {
    if (!projectOk || !isAuthenticated) return;
    if (initialQuery) {
      void live.send(initialQuery);
      return;
    }
    void live.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot bootstrap
  }, [projectOk, isAuthenticated, initialQuery, projectId]);

  const topPad = STORY_HEADER_CONTENT_GAP;
  const waitingUser =
    live.session.status === "waiting_for_approval" || live.session.status === "waiting_for_input";
  const isExecuting =
    live.sending ||
    live.session.status === "queued" ||
    live.session.status === "running" ||
    live.session.status === "waiting_for_external";
  const restoring = live.session.status === "restoring";
  const showStop = isExecuting && !waitingUser;
  const authoringRun = useStoryAuthoringRun(projectId, chapterId, isExecuting || waitingUser);
  const storyApprovalRunId = pendingApproval ? storyAgentRunIdFromApproval(pendingApproval) : null;
  const approvalRun = useStoryAgentRunById(projectId, storyApprovalRunId);
  const proposalRun =
    (storyApprovalRunId && approvalRun?.id === storyApprovalRunId ? approvalRun : null) ??
    (storyApprovalRunId && authoringRun?.id === storyApprovalRunId ? authoringRun : null);
  const proposalInTranscript = Boolean(
    storyApprovalRunId &&
    live.messages.some((message) =>
      message.artifacts?.some(
        (artifact) =>
          isStoryStageProposalArtifact(artifact) && artifact.storyAgentRunId === storyApprovalRunId
      )
    )
  );
  const authoringActivityKey = storyAuthoringActivityMessageKey({
    run: authoringRun,
    pendingExternalJobId: live.pendingExternal?.jobId ?? null,
    agentStatus: live.session.status,
  });
  const activityLabel = authoringActivityKey
    ? t(authoringActivityKey)
    : live.activity
      ? t(agentActivityMessageKey(live.activity))
      : t("agent.activity.thinking");
  const showActivityRow =
    !restoring &&
    (showStop || waitingUser) &&
    (authoringActivityKey != null || live.activity != null) &&
    (!live.assistantStreaming || live.session.status === "waiting_for_external" || waitingUser);

  const { scrollRef, handleScroll, handleContentSizeChange, scrollToLatest, handleEndVisible } =
    useAgentThreadScroll([
      live.messages,
      proposalRun?.id,
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

  const composerHeightRef = useRef(COMPOSER_BASE_HEIGHT);
  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (Math.abs(height - composerHeightRef.current) < 1) return;
      composerHeightRef.current = height;
      handleContentSizeChange();
    },
    [handleContentSizeChange]
  );

  const composerHorizontalPad = {
    paddingLeft: Math.max(insets.left, Spacing.four),
    paddingRight: Math.max(insets.right, Spacing.four),
  };
  // Sticky opened offset cancels the in-flow tab bar covered by the keyboard.
  const tabBarOffset = STORY_TAB_BAR_CONTENT_HEIGHT + insets.bottom;
  const stickyOffset = { closed: 0, opened: tabBarOffset };

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
          headerTitle: "",
          headerRight: () => (
            <StoryChatHeaderActions
              projectId={projectId}
              conversationId={live.session.conversationId}
              status={live.session.status}
              error={live.session.error}
              busy={isExecuting || restoring}
              onNewChat={live.newChat}
            />
          ),
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
            keyboardDismissMode="on-drag"
            keyboardLiftBehavior="whenAtEnd"
            keyboardShouldPersistTaps="handled"
            offset={tabBarOffset}
            onContentSizeChange={handleContentSizeChange}
            onEndVisible={handleEndVisible}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            applyWorkaroundForContentInsetHitTestBug={Platform.OS === "ios"}
            style={[styles.flex, { backgroundColor: theme.background }]}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingTop: topPad,
                paddingLeft: composerHorizontalPad.paddingLeft,
                paddingRight: composerHorizontalPad.paddingRight,
              },
            ]}
          >
            {live.session.error ? (
              <ThemedText type="small" style={{ color: theme.brand }}>
                {live.session.error}
              </ThemedText>
            ) : live.session.status === "failed" ? (
              <ThemedText type="small" style={{ color: theme.brand }}>
                {t("agent.runFailed")}
              </ThemedText>
            ) : null}

            <AgentMessageList
              messages={live.messages}
              renderStoryArtifact={(artifact) =>
                artifact.kind === "story_generation_batch" ? (
                  <StoryGenerationBatchTranscript reference={artifact} />
                ) : (
                  <StoryAuthoringProposalCard
                    projectId={projectId}
                    storyAgentRunId={artifact.storyAgentRunId}
                    status={artifact.status}
                  />
                )
              }
            />

            {storyApprovalRunId && !proposalInTranscript ? (
              <StoryAuthoringProposalCard
                projectId={projectId}
                storyAgentRunId={storyApprovalRunId}
                status="proposed"
              />
            ) : null}

            {showActivityRow ? (
              <View style={styles.activityRow}>
                {waitingUser ? (
                  <IconClockPause size={14} color="rgba(255,255,255,0.78)" strokeWidth={1.8} />
                ) : (
                  <ActivityIndicator color="rgba(255,255,255,0.88)" size="small" />
                )}
                <ThemedText type="small" style={styles.activityLabel}>
                  {activityLabel}
                </ThemedText>
              </View>
            ) : null}
          </KeyboardChatScrollView>
        )}

        <KeyboardStickyView offset={stickyOffset}>
          <View
            onLayout={onComposerLayout}
            style={[
              styles.composerBar,
              {
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
            ) : pendingApproval && storyApprovalRunId ? (
              <StoryAuthoringDecision
                stage={storyProposalStageFromSchema(
                  proposalRun?.proposal.schemaVersion ?? "story-screenplay-proposal-v1"
                )}
                assetCount={proposalRun ? storyProposalAssetCount(proposalRun.proposal) : 0}
                busy={live.sending}
                onResolve={(decision, responseText) => {
                  scrollToLatest(true);
                  void live.approve(decision, responseText);
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
            ) : null}

            <AgentComposer
              value={draft}
              onChangeText={setDraft}
              onSubmit={onSubmit}
              placeholder={t("agent.threadPlaceholder")}
              submitAccessibilityLabel={t("agent.send")}
              busy={showStop}
              onStop={() => void live.cancel()}
              stopAccessibilityLabel={t("agent.stop")}
              sendDisabled={isExecuting || restoring || waitingUser}
              modelProfileId={live.session.modelProfileId ?? live.models[0]?.id ?? undefined}
              modelOptions={live.models}
              onOpenModelSettings={() => setModelSettingsOpen(true)}
              modelMenuLabel={t("agent.modelSettings.open")}
              modelMenuDisabled={isExecuting || restoring || waitingUser}
              nativeID={AGENT_INPUT_NATIVE_ID}
            />
          </View>
        </KeyboardStickyView>
      </KeyboardGestureArea>

      <AgentOsModelSettingsSheet
        projectId={projectId}
        chatModels={live.models}
        initialPreferences={live.modelPreferences}
        visible={modelSettingsOpen}
        disabled={isExecuting || restoring || waitingUser}
        onClose={() => setModelSettingsOpen(false)}
        onSaved={(preferences) => {
          live.setModelPreferences(preferences);
          const preferred = preferences.chatModelProfileId;
          const next =
            preferred && live.models.some((model) => model.id === preferred)
              ? preferred
              : (live.models[0]?.id ?? "");
          if (next) live.setModelProfileId(next);
        }}
      />
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
    gap: Spacing.four,
    paddingBottom: Spacing.five,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
  },
  activityLabel: {
    color: "rgba(255,255,255,0.92)",
    flex: 1,
    fontSize: 13,
  },
  restoreCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  composerBar: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    gap: Spacing.two,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three,
  },
  missing: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
});
