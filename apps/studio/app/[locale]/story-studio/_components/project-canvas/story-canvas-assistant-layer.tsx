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
  StudioAgentTurnFailure,
  formatStudioAgentFileSize,
  useStudioAgentComposerAttachments,
  type StudioAgentTurnFailureLabels,
} from "@/components/studio-agent";
import {
  STUDIO_AGENT_INVOCATION_PATH,
  toStudioAgentMessageParts,
  toStudioAgentToolApprovalInvocation,
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
   * Lets a node named in the assistant's reply become the way to go and look at
   * it. Omit and every code span stays plain text — the honest answer for a
   * surface with no canvas behind it.
   */
  nodeLinks?: StudioAgentNodeLinks;
  children?: ReactNode;
}) {
  const t = useTranslations("storyStudio.canvas.studioAgent");
  // The panel being open and on top is what "in use" means here. `suspended` is
  // a deeper canvas covering this one, which is exactly as unattended as closed.
  const active = open && !suspended;
  const bootstrap = useStoryStudioAgentBootstrap({
    projectId,
    chapterId,
    workspaceId,
    active,
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
  }, [chapterId, clearAttachments, projectId, workspaceId]);

  const composer: StoryCanvasAssistantComposerState = {
    draft,
    onDraftChange: setDraft,
    deliveryMode,
    onDeliveryModeChange: setDeliveryMode,
    inputRef: composerInputRef,
    queue,
  };

  const turnFailureLabels: StudioAgentTurnFailureLabels = {
    region: t("turnFailure.region"),
    code: t("turnFailure.code"),
    issues: t("turnFailure.issues"),
    title: {
      inputRejected: t("turnFailure.title.inputRejected"),
      notRecorded: t("turnFailure.title.notRecorded"),
      failed: t("turnFailure.title.failed"),
    },
    explanation: {
      inputRejected: t("turnFailure.explanation.inputRejected"),
      notRecorded: t("turnFailure.explanation.notRecorded"),
      failed: t("turnFailure.explanation.failed"),
    },
  };

  // Mirrors the composer's `disabled` gate in the panel, so the hero never
  // advertises an action the composer would refuse the instant it opens.
  const firstOpenAvailability: StoryCanvasFirstOpenAvailability =
    bootstrap.status === "error"
      ? { kind: "unavailable", detail: bootstrap.error?.message ?? null }
      : bootstrap.realtime.status === "closed" && bootstrap.realtime.error
        ? { kind: "unavailable", detail: bootstrap.realtime.error.message }
        : bootstrap.status === "loading" || !bootstrap.thread
          ? { kind: "connecting" }
          : { kind: "ready" };
  // Hidden while StoryOS is open: the hero's whole job is to get the creator
  // into the panel, and leaving it live behind the overlay is just clutter.
  const showFirstOpen =
    firstOpen !== undefined &&
    !suspended &&
    !open &&
    firstOpen.canEdit &&
    firstOpen.canvasNodeCount === 0 &&
    chapterId !== null &&
    isStoryCanvasProjectBootstrap(firstOpen.chapters, chapterId);

  const connected = bootstrap.realtime.client !== null && bootstrap.realtime.channelName !== null;

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
      {showFirstOpen ? (
        <StoryCanvasFirstOpen
          availability={firstOpenAvailability}
          draft={draft}
          onRetry={bootstrap.retry}
          onStart={(nextDraft) => {
            // The real entry point: pre-fill the durable thread's composer and
            // open it. Never auto-send — the premise is someone else's, and
            // firing it would spend credits on a story nobody chose yet.
            setDraft(nextDraft);
            onOpenChange(true);
          }}
        />
      ) : null}
      {/*
        The bootstrap stays mounted while the panel is closed, so a turn can die
        with nothing on screen. The closed-panel notice is the same alert with
        the only next action that exists from out here: open StoryOS and read it.
        It sits directly under the canvas header's StoryOS toggle — where the
        panel itself opens — because the bottom-right corner already belongs to
        the history controls and the graph-error toast.
      */}
      {offline.turnFailure && !open && !suspended ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-end px-3 pt-1">
          <StudioAgentTurnFailure
            failure={offline.turnFailure}
            labels={turnFailureLabels}
            action={{
              label: t("turnFailure.openSurface"),
              onClick: () => onOpenChange(true),
            }}
            className="nodrag nopan nowheel pointer-events-auto w-[min(420px,100%)]"
          />
        </div>
      ) : null}
      {connected ? (
        <ConnectedStudioAgentPanel
          bootstrap={bootstrap}
          open={active}
          onOpenChange={onOpenChange}
          composer={composer}
        />
      ) : (
        <StoryCanvasAssistantPanel
          session={offline}
          open={active}
          onOpenChange={onOpenChange}
          composer={composer}
        />
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
}: {
  bootstrap: StoryStudioAgentBootstrap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composer: StoryCanvasAssistantComposerState;
}) {
  const { realtime, workspaceId, buildInvocation } = bootstrap;
  // Read through a ref so the transport is not rebuilt every render: the
  // provider recreates the ChatTransport whenever `chatOptions` changes
  // identity, and rebuilding it mid-turn would drop the stream. The ref is
  // written after commit, not during render; `prepareSendMessagesRequest` only
  // ever runs from a send, which is long after that.
  const buildInvocationRef = useRef(buildInvocation);
  useEffect(() => {
    buildInvocationRef.current = buildInvocation;
  }, [buildInvocation]);
  // Same reason as `buildInvocationRef`: read the thread through a ref so a
  // resolved thread does not re-create `chatOptions` and rebuild the transport
  // mid-turn.
  const threadIdRef = useRef(bootstrap.thread?.threadId ?? null);
  useEffect(() => {
    threadIdRef.current = bootstrap.thread?.threadId ?? null;
  }, [bootstrap.thread?.threadId]);
  // Stable across renders (a `useRef` object from the bootstrap hook), so
  // capturing it in the memo below does not stale.
  const { overlayRef } = bootstrap;

  const chatOptions = useMemo<ChatTransportOptions>(
    () => ({
      /**
       * The control-plane half of every wake-up the library issues.
       *
       * The library publishes `ai-input` and only then issues this POST, so
       * everything below authorizes something that is ALREADY on the channel.
       * A refusal comes back through the session's error emitter; the panel
       * surfaces it inline rather than leaving the prompt looking committed.
       *
       * TWO SHAPES, ONE ENDPOINT, TOLD APART BY WHETHER THE CREATOR IS SENDING
       * A PROMPT. A fresh prompt arrives with a USER message to send. A
       * CONTINUATION — which is how `useChat` answers a suspended tool call —
       * carries no new prompt; `history` holds the assistant whose approval the
       * creator just answered, and the library derived the
       * `tool-approval-response` inputs from that overlay and published them
       * before calling this. There is no second endpoint beside it.
       *
       * THE DISCRIMINATOR IS THE ROLE, NOT EMPTINESS. This used to read "is
       * `messages` empty", on the assumption that a continuation sends nothing.
       * It does not always: the continuation can arrive with the ASSISTANT
       * message in `messages`, whose `id` is truthy — so the approval was posted
       * as if it were a fresh prompt, and the server refused it with 409 because
       * the run it belonged to was parked on that very approval. The creator saw
       * "Approved · Resuming the turn" and then nothing, forever. Only a `user`
       * message is a prompt; anything else on a send is a continuation.
       */
      prepareSendMessagesRequest: ({ messages }) => {
        const last = messages.at(-1) as StudioAgentUIMessage | undefined;
        const outgoing = last?.role === "user" ? last : undefined;
        const threadId = threadIdRef.current;
        const clientMessageId = outgoing?.metadata?.clientMessageId ?? outgoing?.id;
        const body =
          outgoing && clientMessageId
            ? buildInvocationRef.current({
                clientMessageId,
                parts: toStudioAgentMessageParts(outgoing.parts),
                // A fresh send starts a root turn; steer / enqueue never take
                // this path (see `useStoryStudioAgentSession.submit`).
                targetRunId: null,
                delivery: null,
              })
            : threadId
              ? // THE OVERLAY, NOT THE LIBRARY'S `history`. `history` is derived
                // from the channel tree, and on an approval continuation the
                // tree does not yet carry the creator's answer — publishing it
                // is what this request is for. Reading it there found
                // `approval-requested` every time, so the body came out empty
                // and the POST went out with only the library's two pointer
                // fields: a 400, and a turn parked forever behind
                // "Approved · Resuming the turn".
                toStudioAgentToolApprovalInvocation(threadId, overlayRef.current)
              : null;
        return {
          ...(body ? { body: body as unknown as Record<string, unknown> } : {}),
          headers: { "x-fizz-workspace-id": workspaceId },
        };
      },
    }),
    [workspaceId]
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
}: {
  bootstrap: StoryStudioAgentBootstrap;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composer: StoryCanvasAssistantComposerState;
}) {
  const session = useStoryStudioAgentSession(bootstrap);
  return (
    <StoryCanvasAssistantPanel
      session={session}
      open={open}
      onOpenChange={onOpenChange}
      composer={composer}
    />
  );
}
