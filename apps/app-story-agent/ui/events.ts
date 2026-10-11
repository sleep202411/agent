import type { AttachmentId, ImageMediaType } from "@deepseek-ai/dsh-attachment/types";
import type { MessageId } from "@deepseek-ai/dsh-llm";
import type { SessionEvent, SessionSeq } from "@deepseek-ai/dsh-session/types";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller";
import type { StoryHistory, StoryRun, StoryOutputs } from "@repo/app-story-protocol";
import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import { isActive } from "./transport";

declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    "fizz/story-run": { turn: number; run: StoryRun };
  }
}

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "story-media": StoryRun;
  }
}

/** Official live Chat node; completed-turn tails cannot render active generation. */
export const storyMediaDefinition: ConversationNodeDefinition<StoryRun> = {
  kind: "story-media",
  target: "chat",
  match(event) {
    return event.type === "fizz/story-run" &&
      ["asset_media", "storyboard", "clip_media", "verify"].includes(event.data.run.phase)
      ? { id: event.data.run.id, role: "start" }
      : null;
  },
  start(_context, match) {
    if (match.event.type !== "fizz/story-run") throw new Error("Story media requires a run event.");
    return match.event.data.run;
  },
  update(context, match) {
    return match.event.type === "fizz/story-run" ? match.event.data.run : context.state;
  },
  buildViewNode(context): ChatNode<"story-media"> | null {
    if (!context.start || !context.state) return null;
    return {
      key: context.key,
      id: context.id,
      kind: "story-media",
      target: "chat",
      anchorSeq: context.start.event.seq,
      // Media is a persistent session artifact, outside the collapsible model
      // process group. Its run event still anchors it in the right transcript turn.
      location: { kind: "session" },
      visibility: "visible",
      data: context.state,
    };
  },
};

/** Completed timeline seconds, never provider elapsed time or a guessed render percentage. */
export function videoProgress(outputs: StoryOutputs) {
  const videos = outputs.filter((media) => media.kind === "video");
  const completed = videos.filter((media) => media.status === "ready");
  const timed = videos.every((media) => media.durationMs !== null);
  return {
    videos,
    completedCount: completed.length,
    totalMs: timed ? videos.reduce((sum, media) => sum + media.durationMs!, 0) : null,
    completedMs: timed ? completed.reduce((sum, media) => sum + media.durationMs!, 0) : null,
    current:
      videos.find((media) => media.status === "generating") ??
      videos.find((media) => media.status === "failed") ??
      videos.find((media) => media.status === "queued"),
  };
}

/** Read-only UI projection. Query owns server truth; Harness owns input/chat state. */
export function projectHistory(history: StoryHistory): SessionEvent[] {
  const events: SessionEvent[] = [];
  const previous: Array<{
    id: string;
    text: string;
    role: "user" | "assistant";
    createdAt: string;
    assistantText?: string;
    assistantId?: string;
  }> = [];
  for (const message of history.legacyMessages) {
    if (message.role === "assistant" && /^[a-z]+(?:_[a-z]+)+$/.test(message.text.trim())) continue;
    const last = previous.at(-1);
    if (message.role === "assistant" && last?.role === "user" && last.assistantText === undefined) {
      last.assistantText = message.text;
      last.assistantId = message.id;
    } else previous.push({ ...message });
  }
  // Inherited messages are an ordered prefix, even when a historical run was
  // updated later. Keep each user/reply pair in one official conversation turn.
  const rows = [...previous, ...history.runs];
  rows.forEach((row, index) => {
    const turn = index + 1,
      base =
        ("status" in row && row.historyIndex !== undefined
          ? history.legacyMessages.length + row.historyIndex
          : index) * 1000,
      time = Date.parse(row.createdAt);
    const event = <K extends SessionEvent["type"]>(
      type: K,
      offset: number,
      data: Extract<SessionEvent, { type: K }>["data"],
      surface = false
    ) => {
      events.push({
        type,
        seq: (base + offset) as SessionSeq,
        time,
        data,
        ...(surface ? { surfaceOp: "append" } : {}),
      } as SessionEvent);
    };
    event("turn/start", 1, { turn });
    if (!("status" in row) || !row.harnessEvents?.length) event("step/start", 2, { turn, step: 1 });
    const run = "status" in row ? row : undefined;
    const legacy = "role" in row ? row : undefined;
    const user = Boolean(run || legacy?.role === "user");
    if (user)
      event(
        "user/message",
        3,
        {
          id: (legacy ? row.id : `${row.id}:user`) as MessageId,
          role: "user",
          source: run
            ? { kind: "user", rpcId: run.submissionId as SessionRequestId }
            : { kind: "user" },
          content: [
            ...(run?.attachments ?? []).map((attachment) =>
              attachment.width && attachment.height
                ? {
                    type: "image" as const,
                    attachment: {
                      attachmentId: attachment.hash as AttachmentId,
                      mediaType: attachment.mediaType as ImageMediaType,
                      bytes: attachment.bytes,
                      width: attachment.width,
                      height: attachment.height,
                      name: attachment.name,
                    },
                  }
                : {
                    type: "file" as const,
                    attachment: {
                      attachmentId: attachment.hash as AttachmentId,
                      name: attachment.name,
                      bytes: attachment.bytes,
                    },
                  }
            ),
            { type: "text", text: run ? run.message : legacy!.text },
          ],
        },
        true
      );
    const text = run ? run.assistantText : user ? legacy?.assistantText : legacy!.text;
    const journal =
      run?.harnessEvents?.filter(
        (entry) =>
          entry.type !== "turn/start" &&
          entry.type !== "turn/end" &&
          entry.type !== "fizz/projections"
      ) ?? [];
    // Present the validated decision after its tool result, retaining the same
    // model message and usage. A trailing tool result would disable the official
    // completed-message fork action even though the product reply has finished.
    if (text) {
      const replyIndex = journal.findLastIndex(
        (entry) => entry.type === "assistant/message" && JSON.stringify(entry.data).includes(text)
      );
      if (replyIndex >= 0) {
        const reply = journal[replyIndex];
        const step = (reply.data as { step?: number }).step;
        const resultIndex = journal.findLastIndex(
          (entry) => entry.type === "tool/result" && (entry.data as { step?: number }).step === step
        );
        if (resultIndex > replyIndex) {
          journal.splice(replyIndex, 1);
          journal.splice(resultIndex, 0, reply);
        }
      }
    }
    journal.forEach((entry, index) => {
      const projected = structuredClone(entry) as unknown as SessionEvent;
      projected.seq = (base + 10 + index) as SessionSeq;
      if (projected.data && typeof projected.data === "object" && "turn" in projected.data)
        projected.data.turn = turn;
      events.push(projected);
    });
    const nativeReply = run?.harnessEvents?.some(
      (entry) =>
        entry.type === "assistant/message" && JSON.stringify(entry.data).includes(text ?? "\0")
    );
    if (text && !nativeReply)
      event(
        "assistant/message",
        800,
        {
          turn,
          step: 1,
          stream: [],
          message: {
            id: (legacy?.assistantId ??
              (legacy?.role === "assistant" ? legacy.id : `${row.id}:assistant`)) as MessageId,
            role: "assistant",
            source: { kind: "model", provider: "app-story-agent", model: "configured" },
            content: [{ type: "text", text }],
          },
        },
        true
      );
    if (run) event("fizz/story-run", 900, { turn, run });
    if (!run || !isActive(run)) {
      if (!journal.length) event("step/end", 901, { turn, step: 1 });
      // Business failures/recovery are rendered by the production extension;
      // the projection closes the turn without duplicating error UI or tools.
      event("turn/end", 902, { turn, reason: { kind: "completed" } });
    }
  });
  return events.sort((a, b) => a.seq - b.seq);
}

/** Translate the official fork action's sequence to a canonical message boundary. */
export function forkBoundary(history: StoryHistory, seq: number): string | undefined {
  const events = projectHistory(history);
  const message = events
    .filter(
      (event) =>
        event.seq <= seq && (event.type === "user/message" || event.type === "assistant/message")
    )
    .at(-1);
  if (!message) return undefined;
  const group = Math.floor(message.seq / 1000);
  const business = events.find(
    (event) => event.type === "fizz/story-run" && Math.floor(event.seq / 1000) === group
  );
  if (business?.type === "fizz/story-run")
    return `${business.data.run.id}:${message.type === "user/message" ? "user" : "assistant"}`;
  const id =
    message.type === "user/message"
      ? message.data.id
      : message.type === "assistant/message"
        ? message.data.message.id
        : undefined;
  return id;
}
