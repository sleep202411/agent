import { IconClockPause, IconPaperclip, IconX } from "@tabler/icons-react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
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
import { AgentPermissionMenu } from "@/features/agent/components/agent-permission-menu";
import { AgentSkillsMenu } from "@/features/agent/components/agent-skills-menu";
import { AgentMessageList } from "@/features/agent/components/agent-message-list";
import { AgentUserInputCard } from "@/features/agent/components/agent-user-input-card";
import { StoryAuthoringDecision } from "@/features/agent/components/story-authoring-decision";
import { StoryAuthoringProposalCard } from "@/features/agent/components/story-authoring-proposal-card";
import { StoryChatHeaderActions } from "@/features/agent/components/story-chat-header-actions";
import { StoryGenerationBatchTranscript } from "@/features/agent/components/story-generation-batch-transcript";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { useAgentOsSession } from "@/features/agent/hooks/use-agent-os-session";
import { useAgentChatRoute } from "@/features/agent/hooks/use-agent-chat-route";
import { useAgentTurnSubmission } from "@/features/agent/hooks/use-agent-turn-submission";
import { useAgentComposerTurn } from "@/features/agent/hooks/use-agent-composer-turn";
import {
  AgentThreadHydrateLockProvider,
  useAgentThreadScroll,
} from "@/features/agent/hooks/use-agent-thread-scroll";
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
const COMPOSER_BASE_HEIGHT = 128;

/** Agent OS conversation — HTTP start + event polling. */
export default function AgentChatScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requireAuth } = useAuthGate();
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
  const {
    chapterId: chapterFromContext,
    loading: chapterLoading,
    error: chapterError,
    refresh: refreshChapter,
  } = useStoryChapterContext();
  const chapterId = isAgentOsId(chapterFromQuery) ? chapterFromQuery : chapterFromContext;
  const workbenchMode = params.mode?.trim() || AGENT_OS_STORY_WORKBENCH_MODE;
  const projectOk = isAgentOsId(projectId);
  const chapterReady =
    projectOk &&
    !chapterLoading &&
    !chapterError &&
    isAgentOsId(chapterFromContext) &&
    (!isAgentOsId(chapterFromQuery) || chapterFromQuery === chapterFromContext);
  const readyProjectId = chapterReady ? projectId : "";

  const live = useAgentOsSession({
    projectId: readyProjectId,
    workbenchMode,
    chapterId: isAgentOsId(chapterId) ? chapterId : undefined,
  });

  const pendingInput = live.session.pendingUserInput;
  const pendingApproval = live.session.pendingApproval;

  const { draft, setDraft, scrollResetKey } = useAgentChatRoute({
    projectId,
    chapterId,
    workbenchMode,
    configured: !!chapterReady,
    query: initialQuery,
    prefill: prefillDraft,
    send: live.send,
    restore: live.restore,
  });

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
  const authoringRun = useStoryAuthoringRun(readyProjectId, chapterId, isExecuting || waitingUser);
  const storyApprovalRunId = pendingApproval ? storyAgentRunIdFromApproval(pendingApproval) : null;
  const approvalRun = useStoryAgentRunById(readyProjectId, storyApprovalRunId);
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
  const composerLocked = !chapterReady || isExecuting || restoring || waitingUser;
  const composerTurn = useAgentComposerTurn(
    readyProjectId,
    workbenchMode,
    composerLocked,
    chapterId
  );

  const {
    scrollRef,
    handleScroll,
    handleContentSizeChange,
    scrollToLatest,
    handleEndVisible,
    revealed,
    hydrateLock,
  } = useAgentThreadScroll(scrollResetKey);

  const submitTurn = useAgentTurnSubmission({
    identity: JSON.stringify([projectId, chapterId, workbenchMode]),
    draft,
    setDraft,
    getExtras: composerTurn.getSendExtras,
    commitExtras: composerTurn.commitSendExtras,
    send: live.send,
    onStarted: () => scrollToLatest(true),
  });
  const onSubmit = useCallback(() => {
    requireAuth({
      onAuthenticated: () => {
        void submitTurn();
      },
    });
  }, [requireAuth, submitTurn]);

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

  if (!chapterReady) {
    return (
      <ThemedView style={styles.screen}>
        <Stack.Screen options={{ headerTitle: "" }} />
        <View style={[styles.missing, { paddingTop: topPad }]}>
          {chapterError ? (
            <>
              <ThemedText accessibilityRole="alert">{chapterError}</ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={refreshChapter}
                style={{ padding: 12 }}
              >
                <ThemedText>{t("common.retry")}</ThemedText>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={theme.brand} />
          )}
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
        <AgentThreadHydrateLockProvider value={hydrateLock}>
          <View style={styles.flex}>
            {restoring && live.messages.length === 0 ? (
              <View style={styles.restoreCenter}>
                <ActivityIndicator color={theme.brand} />
              </View>
            ) : (
              <>
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
                  style={[
                    styles.flex,
                    { backgroundColor: theme.background, opacity: revealed ? 1 : 0 },
                  ]}
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
                        <IconClockPause
                          size={14}
                          color="rgba(255,255,255,0.78)"
                          strokeWidth={1.8}
                        />
                      ) : (
                        <ActivityIndicator color="rgba(255,255,255,0.88)" size="small" />
                      )}
                      <ThemedText type="small" style={styles.activityLabel}>
                        {activityLabel}
                      </ThemedText>
                    </View>
                  ) : null}
                </KeyboardChatScrollView>
                {!revealed && live.messages.length > 0 ? (
                  <View
                    pointerEvents="none"
                    style={[styles.restoreCover, { backgroundColor: theme.background }]}
                  >
                    <ActivityIndicator color={theme.brand} />
                  </View>
                ) : null}
              </>
            )}
          </View>
        </AgentThreadHydrateLockProvider>

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
              sendDisabled={composerLocked || composerTurn.uploading}
              canSendWithoutText={composerTurn.canSendWithoutText}
              nativeID={AGENT_INPUT_NATIVE_ID}
              attachmentBar={
                <View style={styles.composerExtras}>
                  {composerTurn.invocableSkills.length > 0 ? (
                    <View style={styles.skillChips}>
                      {composerTurn.invocableSkills.map((skill) => {
                        const active = composerTurn.turnSkillIds.includes(skill.id);
                        return (
                          <Pressable
                            key={skill.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: composerLocked }}
                            disabled={composerLocked}
                            onPress={() => composerTurn.toggleTurnSkill(skill.id)}
                          >
                            <View style={[styles.skillChip, active && styles.skillChipActive]}>
                              <Text style={styles.skillChipText}>{skill.name}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  <AgentSkillsMenu
                    entries={composerTurn.projectSkillEntries}
                    loading={composerTurn.projectSkillsLoading}
                    error={composerTurn.projectSkillsError}
                    disabled={composerLocked}
                    activeCount={composerTurn.activeProjectSkillCount}
                    isActive={composerTurn.isProjectSkillActive}
                    onToggle={composerTurn.toggleProjectSkill}
                    onRetry={composerTurn.retryProjectSkills}
                  />
                  {composerTurn.pendingFiles.length > 0 || composerTurn.uploading ? (
                    <View style={styles.fileChips}>
                      {composerTurn.uploading ? (
                        <Text style={styles.uploading}>{t("agent.composer.uploading")}</Text>
                      ) : null}
                      {composerTurn.pendingFiles.map((file) => (
                        <View key={file.id} style={styles.fileChip}>
                          <Text style={styles.fileChipText} numberOfLines={1}>
                            {file.filename}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("agent.composer.removeAttachment")}
                            hitSlop={6}
                            onPress={() => composerTurn.removePending(file.id)}
                          >
                            <View>
                              <IconX size={12} color="rgba(255,255,255,0.45)" strokeWidth={2} />
                            </View>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              }
              leadingAction={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("agent.composer.attachFile")}
                  disabled={composerLocked || composerTurn.uploading}
                  hitSlop={6}
                  onPress={() => void composerTurn.pickAndUpload()}
                  style={({ pressed }) => [pressed && styles.composerPressed]}
                >
                  <View
                    style={[
                      styles.attachHit,
                      (composerLocked || composerTurn.uploading) && styles.attachDisabled,
                    ]}
                  >
                    <IconPaperclip size={16} color="rgba(255,255,255,0.72)" strokeWidth={1.8} />
                  </View>
                </Pressable>
              }
              beforeSend={
                <AgentPermissionMenu
                  value={composerTurn.permissionMode}
                  disabled={composerLocked}
                  onChange={composerTurn.setPermissionMode}
                />
              }
            />
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
  restoreCover: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  composerBar: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    gap: Spacing.two,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three,
  },
  composerExtras: {
    gap: 8,
    paddingBottom: 4,
  },
  skillChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  skillChip: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  skillChipActive: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  skillChipText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
  },
  fileChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  fileChip: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fileChipText: {
    color: "rgba(255,255,255,0.88)",
    flexShrink: 1,
    fontSize: 10,
    maxWidth: 180,
  },
  uploading: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  attachHit: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  attachDisabled: {
    opacity: 0.45,
  },
  composerPressed: {
    opacity: 0.8,
  },
  missing: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
});
