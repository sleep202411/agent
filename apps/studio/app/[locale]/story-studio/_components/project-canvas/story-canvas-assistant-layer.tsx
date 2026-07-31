"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AblyProvider } from "ably/react";
import { ChatTransportProvider } from "@ably/ai-transport/vercel/react";
import type { ChatTransportOptions } from "@ably/ai-transport/vercel";
import { useTranslations } from "next-intl";

import {
  StudioAgentNodeLinkProvider,
  type StudioAgentNodeLinks,
  STUDIO_AGENT_ATTACHMENT_MEDIA_TYPES,
  STUDIO_AGENT_DOCUMENT_MAX_SIZE_BYTES,
  STUDIO_AGENT_DOCUMENT_MEDIA_TYPES,
  STUDIO_AGENT_IMAGE_MAX_SIZE_BYTES,
  StudioAgentTurnFailureNotice,
  formatStudioAgentFileSize,
  useStudioAgentComposerAttachments,
  type StudioAgentTurnFailureNoticeLabels,
} from "@/components/studio-agent";
import {
  STUDIO_AGENT_INVOCATION_PATH,
  type StudioAgentCanvasPreviewPart,
  type StudioAgentDeliveryMode,
  type StudioAgentUIMessage,
} from "@/lib/studio-agent";
import type { StoryChapter } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";

import { isStoryCanvasProjectBootstrap } from "./story-canvas-empty-state";
import {
  StoryCanvasFirstOpen,
  type StoryCanvasFirstOpenAvailability,
} from "./story-canvas-first-open";
import {
  StoryCanvasAssistantPanel,
  type StoryCanvasAssistantComposerState,
} from "./story-canvas-assistant-panel";
import {
  useDisconnectedStoryStudioAgentSession,
  useStoryStudioAgentBootstrap,
  useStoryStudioAgentSession,
  type StoryStudioAgentBootstrap,
} from "./use-story-studio-agent";

export interface StoryCanvasFirstOpenInputs {
  chapters: StoryChapter[];
  /**
   * Live canvas node count. The projection's per-chapter `nodeCount` lags a
   * local mutation by a refetch, so the hero would otherwise linger over the
   * first node the creator (or the agent) drops onto the canvas.
   */
  canvasNodeCount: number;
  canEdit: boolean;
}

/**
 * Story Studio adapter for the product-neutral Studio Agent surface.
 *
 * The runtime session stays mounted while the panel is closed — but the
 * delivery subscription does not. The bootstrap is HTTP: it resolves the
 * thread, seeds the transcript, and keeps the closed-panel failure notice
 * honest. The channel and the Ably connection are held only while the panel is
 * open and on top, because the account is capped on both.
 *
 * The surface is an absolute overlay, so opening StoryOS never changes React
 * Flow's viewport dimensions or canvas transform.
 */
export function StoryCanvasAssistantLayer({
  projectId,
  chapterId,
  workspaceId,
  open,
  onOpenChange,
  suspended = false,
  firstOpen,
  onAgentWrote,
  onCanvasPreviewChange,
  nodeLinks,
  children,
}: {
  projectId: string;
  chapterId: string | null;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keeps this canvas mounted while a deeper authoring canvas is active. */
  suspended?: boolean;
  /** Inputs for the first-open hero; omit to never show it. */
  firstOpen?: StoryCanvasFirstOpenInputs;
  /**
   * The agent finished writing, and these are the nodes it wrote.
   *
   * The canvas reads its projections through react-query, so without this it
   * re-renders a graph that moved under the creator with nothing to say where.
   * Fired once per applied write, never on mount — a conversation opened three
   * days later must not yank the viewport to an edit nobody is looking for.
   */
  onAgentWrote?: (nodeIds: readonly string[]) => void;
  /**
   * A transient Story change proposal for a ghost overlay.
   *
   * It is presentation-only: the parent must not persist it or place it in the
   * creator's undo/redo stack. `null` clears it when its tool settles.
   */
  onCanvasPreviewChange?: (preview: StudioAgentCanvasPreviewPart | null) => void;
  /**
   * Lets a node named in the assistant's reply become the way to go and look at
   * it. Omit and every code span stays plain text — the honest answer for a
   * surface with no canvas behind it.
   */
  nodeLinks?: StudioAgentNodeLinks;
  children?: ReactNode;
}) {
  const t = useTranslations("storyStudio.canvas.studioAgent");
  const firstOpenEligible =
    firstOpen !== undefined &&
    firstOpen.canEdit &&
    firstOpen.canvasNodeCount === 0 &&
    chapterId !== null &&
    isStoryCanvasProjectBootstrap(firstOpen.chapters, chapterId);
  // A visible first-open composer is an active delivery surface even though the
  // transcript is still closed. It must own a realtime session before its send
  // button becomes interactive. Once the canvas has content, a closed panel
  // goes back to being unattended and releases that capped connection.
  const panelOpen = open && !suspended;
  const realtimeActive = (open || firstOpenEligible) && !suspended;
  const bootstrap = useStoryStudioAgentBootstrap({
    projectId,
    chapterId,
    workspaceId,
    active: realtimeActive,
  });
  // Always computed, never conditional: it is the panel's session before the
  // grant resolves AND the source of the closed-panel failure notice, which has
  // to be honest about a turn that died while nobody was looking.
  const offline = useDisconnectedStoryStudioAgentSession(bootstrap);

  // Edge-triggered on the write itself. `writtenNodeIds` is derived from the
  // same completed actions as the reconcile token, so this fires in step with
  // the canvas re-reading the draft rather than before it.
  const writtenNodeIds = bootstrap.history.writtenNodeIds;
  const announcedWriteRef = useRef<string | null>(null);
  useEffect(() => {
    const signature = writtenNodeIds.join(",");
    const first = announcedWriteRef.current === null;
    if (announcedWriteRef.current === signature) return;
    announcedWriteRef.current = signature;
    if (first || writtenNodeIds.length === 0) return;
    onAgentWrote?.(writtenNodeIds);
  }, [onAgentWrote, writtenNodeIds]);

  const [draft, setDraft] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<StudioAgentDeliveryMode>("send");
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const queue = useStudioAgentComposerAttachments({
    upload: (file, context) => bootstrap.uploadAttachment(file, context),
    uploadFailedMessage: t("composer.attachments.failed"),
    validateFile(file) {
      if (file.size === 0) return t("composer.attachments.emptyFile");
      if (!STUDIO_AGENT_ATTACHMENT_MEDIA_TYPES.some((mediaType) => mediaType === file.type)) {
        return t("composer.attachments.unsupportedType");
      }
      const maximum = STUDIO_AGENT_DOCUMENT_MEDIA_TYPES.some((mediaType) => mediaType === file.type)
        ? STUDIO_AGENT_DOCUMENT_MAX_SIZE_BYTES
        : STUDIO_AGENT_IMAGE_MAX_SIZE_BYTES;
      if (file.size > maximum) {
        return t("composer.attachments.tooLarge", {
          maxSize: formatStudioAgentFileSize(maximum),
        });
      }
      if (!file.name.trim() || file.name.length > 255) {
        return t("composer.attachments.fileNameTooLong");
      }
      return null;
    },
  });
  const clearAttachments = queue.clear;
  useEffect(() => {
    clearAttachments();
  }, [bootstrap.conversationKey, chapterId, clearAttachments, projectId, workspaceId]);

  const composer: StoryCanvasAssistantComposerState = {
    draft,
    onDraftChange: setDraft,
    deliveryMode,
    onDeliveryModeChange: setDeliveryMode,
    inputRef: composerInputRef,
    queue,
  };

  const turnFailureNoticeLabels: StudioAgentTurnFailureNoticeLabels = {
    region: t("turnFailure.region"),
    open: t("turnFailure.openSurface"),
    dismiss: t("turnFailure.dismiss"),
    title: {
      inputRejected: t("turnFailure.title.inputRejected"),
      notRecorded: t("turnFailure.title.notRecorded"),
      failed: t("turnFailure.title.failed"),
    },
  };

  // The closed-panel failure notice fires once per failure and never again
  // after the creator has seen or dismissed it. "Seen" means StoryOS was open
  // while this failure was current — the timeline row inside the panel is the
  // single failure surface, so closing the panel afterwards must not resurrect
  // an echo of a row the creator already read.
  const closedPanelFailure = offline.turnFailure;
  const closedPanelFailureKey = closedPanelFailure
    ? `${bootstrap.conversationKey}:${closedPanelFailure.id}`
    : null;
  const [acknowledgedFailureKey, setAcknowledgedFailureKey] = useState<string | null>(null);
  useEffect(() => {
    if (panelOpen && closedPanelFailureKey) setAcknowledgedFailureKey(closedPanelFailureKey);
  }, [closedPanelFailureKey, panelOpen]);
  const showClosedPanelFailure =
    closedPanelFailure !== null &&
    !open &&
    !suspended &&
    acknowledgedFailureKey !== closedPanelFailureKey;

  const connected = bootstrap.realtime.client !== null && bootstrap.realtime.channelName !== null;
  // Mirrors the composer's `disabled` gate in the panel, so the hero never
  // advertises an action the composer would refuse the instant it opens.
  const firstOpenAvailability: StoryCanvasFirstOpenAvailability =
    bootstrap.status === "error"
      ? { kind: "unavailable", detail: bootstrap.error?.message ?? null }
      : bootstrap.realtime.status === "closed" && bootstrap.realtime.error
        ? { kind: "unavailable", detail: bootstrap.realtime.error.message }
        : bootstrap.status === "loading" || !bootstrap.thread || !connected
          ? { kind: "connecting" }
          : { kind: "ready" };
  // Hidden while StoryOS is open: the hero's whole job is to get the creator
  // into the panel, and leaving it live behind the overlay is just clutter.
  const showFirstOpen = firstOpenEligible && !suspended && !open;

  const surface = (
    <div
      aria-hidden={suspended ? true : undefined}
      inert={suspended ? true : undefined}
      className={cn(
        "relative h-full w-full origin-center transition-[opacity,transform] duration-300 ease-out",
        suspended && "pointer-events-none scale-[0.985] opacity-0"
      )}
    >
      {children}
      {/*
        The bootstrap stays mounted while the panel is closed, so a turn can die
        with nothing on screen. This compact notice is an usher, not a second
        error surface: it deep-links to the timeline row that owns the failure,
        and it disappears for good once seen or dismissed. It sits directly
        under the canvas header's StoryOS toggle — where the panel itself opens
        — because the bottom-right corner already belongs to the history
        controls and the graph-error toast.
      */}
      {showClosedPanelFailure ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-end px-3 pt-1">
          <StudioAgentTurnFailureNotice
            failure={closedPanelFailure}
            labels={turnFailureNoticeLabels}
            onOpen={() => onOpenChange(true)}
            onDismiss={() => setAcknowledgedFailureKey(closedPanelFailureKey)}
            className="nodrag nopan nowheel pointer-events-auto w-[min(420px,100%)]"
          />
        </div>
      ) : null}
      {connected ? (
        <ConnectedStudioAgentPanel
          bootstrap={bootstrap}
          open={panelOpen}
          onOpenChange={onOpenChange}
          composer={composer}
          showFirstOpen={showFirstOpen}
          firstOpenAvailability={firstOpenAvailability}
          onRetryFirstOpen={bootstrap.retry}
          onCanvasPreviewChange={onCanvasPreviewChange}
        />
      ) : (
        <>
          {showFirstOpen ? (
            <StoryCanvasFirstOpen
              availability={firstOpenAvailability}
              draft={draft}
              attachmentQueue={queue}
              documentAnalysis={bootstrap.documentAnalysis}
              onDraftChange={setDraft}
              onSubmit={() => undefined}
              onRetry={bootstrap.retry}
            />
          ) : null}
          <StoryCanvasAssistantPanel
            session={offline}
            open={panelOpen}
            onOpenChange={onOpenChange}
            composer={composer}
          />
        </>
      )}
    </div>
  );

  // Absent when this surface has no canvas behind it, and the markdown then
  // leaves every code span as plain text — the correct answer, not a degraded
  // one. See `StudioAgentNodeLinkProvider`.
  return nodeLinks ? (
    <StudioAgentNodeLinkProvider has={nodeLinks.has} focus={nodeLinks.focus}>
      {surface}
    </StudioAgentNodeLinkProvider>
  ) : (
    surface
  );
}

/**
 * The panel with a live channel behind it.
 *
 * `<AblyProvider>` supplies the connection; `<ChatTransportProvider>` opens the
 * `ClientSession` on this thread's channel, wraps it in the AI SDK
 * `ChatTransport`, and publishes both to the subtree — which is the entire
 * delivery layer. `channelName` is the server's, taken from the same grant that
 * signed the capability, never rebuilt here: a client that constructed the name
 * itself could drift from the token silently.
 */
function ConnectedStudioAgentPanel({
  bootstrap,
  open,
  onOpenChange,
  composer,
  showFirstOpen,
  firstOpenAvailability,
  onRetryFirstOpen,
  onCanvasPreviewChange,
}: {
  bootstrap: StoryStudioAgentBootstrap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composer: StoryCanvasAssistantComposerState;
  showFirstOpen: boolean;
  firstOpenAvailability: StoryCanvasFirstOpenAvailability;
  onRetryFirstOpen: () => void;
  onCanvasPreviewChange?: (preview: StudioAgentCanvasPreviewPart | null) => void;
}) {
  const { realtime, workspaceId, locale } = bootstrap;
  const conversationId = bootstrap.thread!.threadId;

  // `useChat` builds its `Chat` once per conversation id and `AbstractChat`
  // assigns `readonly transport` in its constructor — there is no setter, so
  // the transport this panel session sends through is the FIRST one built here.
  // Every invocation an approval can belong to is created after that moment,
  // which is why the continuation lookup reads the live ref instead of the
  // invocations that happened to exist when the transport was captured.
  const invocationsRef = useRef(bootstrap.invocations);
  useEffect(() => {
    invocationsRef.current = bootstrap.invocations;
  }, [bootstrap.invocations]);

  const chatOptions = useMemo<ChatTransportOptions>(
    () => ({
      prepareSendMessagesRequest: (context) => {
        const isContinuation =
          context.trigger === "submit-message" &&
          context.messages.length === 0 &&
          context.history.at(-1)?.role === "assistant";
        const lastAssistant = isContinuation
          ? (context.history.at(-1) as StudioAgentUIMessage)
          : null;
        const continuationRunId = lastAssistant?.metadata?.runId;
        const continuationInvocation = continuationRunId
          ? invocationsRef.current.find((invocation) => invocation.runId === continuationRunId)
          : undefined;
        if (isContinuation && !continuationInvocation) {
          throw new Error("The approval continuation is not linked to a durable Agent invocation.");
        }
        // A continuation does not create a new UIMessage: the SDK updates the
        // suspended assistant message in place. Give the transport event its
        // own causal identity instead of reusing that assistant id, otherwise
        // two sequential approvals collide at the product idempotency boundary.
        const clientMessageId = isContinuation
          ? crypto.randomUUID()
          : (context.messages.at(-1)?.id ?? context.messageId ?? context.history.at(-1)?.id);
        if (!clientMessageId) {
          throw new Error("Agent invocation has no causal message identity.");
        }
        return {
          body: {
            schemaVersion: "agent-invocation-gateway/v1",
            conversationId,
            clientMessageId,
            ...(continuationInvocation
              ? { continuationOfInvocationId: continuationInvocation.invocationId }
              : {}),
            locale,
          },
          headers: {
            "x-fizz-workspace-id": workspaceId,
            "accept-language": locale,
          },
        };
      },
    }),
    [conversationId, locale, workspaceId]
  );

  return (
    <AblyProvider client={realtime.client!}>
      <ChatTransportProvider
        channelName={realtime.channelName!}
        api={STUDIO_AGENT_INVOCATION_PATH}
        credentials="include"
        chatOptions={chatOptions}
      >
        <LiveStudioAgentPanel
          bootstrap={bootstrap}
          open={open}
          onOpenChange={onOpenChange}
          composer={composer}
          showFirstOpen={showFirstOpen}
          firstOpenAvailability={firstOpenAvailability}
          onRetryFirstOpen={onRetryFirstOpen}
          onCanvasPreviewChange={onCanvasPreviewChange}
        />
      </ChatTransportProvider>
    </AblyProvider>
  );
}

/** Inside the providers, where `useChatTransport` resolves. */
function LiveStudioAgentPanel({
  bootstrap,
  open,
  onOpenChange,
  composer,
  showFirstOpen,
  firstOpenAvailability,
  onRetryFirstOpen,
  onCanvasPreviewChange,
}: {
  bootstrap: StoryStudioAgentBootstrap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composer: StoryCanvasAssistantComposerState;
  showFirstOpen: boolean;
  firstOpenAvailability: StoryCanvasFirstOpenAvailability;
  onRetryFirstOpen: () => void;
  onCanvasPreviewChange?: (preview: StudioAgentCanvasPreviewPart | null) => void;
}) {
  const session = useStoryStudioAgentSession(bootstrap);
  useEffect(() => {
    onCanvasPreviewChange?.(session.activeCanvasPreview);
    return () => onCanvasPreviewChange?.(null);
  }, [onCanvasPreviewChange, session.activeCanvasPreview]);
  return (
    <>
      {showFirstOpen ? (
        <StoryCanvasFirstOpen
          availability={firstOpenAvailability}
          draft={composer.draft}
          attachmentQueue={composer.queue}
          documentAnalysis={bootstrap.documentAnalysis}
          onDraftChange={composer.onDraftChange}
          submitting={session.submitting}
          onRetry={onRetryFirstOpen}
          onSubmit={async (text, attachments) => {
            // The opening composer is a real delivery surface, not a staging
            // button. Clear it before awaiting the streamed reply, open the
            // transcript immediately, and restore the exact text only when the
            // transport refuses the message.
            composer.onDraftChange("");
            onOpenChange(true);
            try {
              await composer.queue.deliver(attachments, () =>
                session.submit(text, "send", attachments).then((submitted) => {
                  if (!submitted) {
                    throw new Error("The Studio Agent submission was not accepted.");
                  }
                })
              );
            } catch {
              composer.onDraftChange(text);
            }
          }}
        />
      ) : null}
      <StoryCanvasAssistantPanel
        session={session}
        open={open}
        onOpenChange={onOpenChange}
        composer={composer}
      />
    </>
  );
}
