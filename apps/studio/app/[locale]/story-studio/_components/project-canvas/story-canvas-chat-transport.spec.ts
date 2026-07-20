import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_DIRECTING_SKILL_KEY } from "@repo/shared/story-directing-skills";
import {
  createStoryCanvasChatTransport,
  type StoryCanvasChatRequestContext,
} from "./story-canvas-chat-transport";

function emptyStreamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    {
      status: 200,
    }
  );
}

describe("Story Canvas chat transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the latest skill and workspace at request time", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);

    let context: StoryCanvasChatRequestContext = {
      conversationId: "story-canvas:project-a",
      projectId: "project-a",
      workspaceId: "workspace-a",
      selectedSkillKey: null,
    };
    const controller = createStoryCanvasChatTransport(context);

    context = {
      ...context,
      workspaceId: "workspace-b",
      selectedSkillKey: STORY_DIRECTING_SKILL_KEY.HALFTONE_COLLAGE,
    };
    controller.updateContext(context);
    await controller.transport.sendMessages({
      trigger: "submit-message",
      chatId: context.conversationId,
      messageId: undefined,
      messages: [{ id: "creator-turn-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
      abortSignal: undefined,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      conversationId: "story-canvas:project-a",
      projectId: "project-a",
      mode: "story-canvas",
      trigger: "submit-message",
      message: {
        id: "creator-turn-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      selectedSkillKeys: [STORY_DIRECTING_SKILL_KEY.HALFTONE_COLLAGE],
    });
    expect(body).not.toHaveProperty("storyContext");
    expect(body).not.toHaveProperty("messages");
    expect(new Headers(request.headers).get("x-fizz-workspace-id")).toBe("workspace-b");
    expect(new Headers(request.headers).has("x-idempotency-key")).toBe(false);
  });

  it("forwards a document reference part on the outgoing message untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const context: StoryCanvasChatRequestContext = {
      conversationId: "story-canvas:project-a",
      projectId: "project-a",
      workspaceId: "workspace-a",
      selectedSkillKey: null,
    };
    const controller = createStoryCanvasChatTransport(context);
    const documentPart = {
      type: "data-document" as const,
      data: {
        documentId: "019f7243-20c1-7054-a6fa-0a33da6efe10",
        name: "script.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 2048,
        charCount: 46,
      },
    };

    await controller.transport.sendMessages({
      trigger: "submit-message",
      chatId: context.conversationId,
      messageId: undefined,
      messages: [
        {
          id: "creator-turn-1",
          role: "user",
          parts: [{ type: "text", text: "Adapt my script" }, documentPart],
        },
      ],
      abortSignal: undefined,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      message: { parts: unknown[] };
    };
    expect(body.message.parts).toEqual([{ type: "text", text: "Adapt my script" }, documentPart]);
  });

  it("never opens client-tool continuation for Story Canvas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const context: StoryCanvasChatRequestContext = {
      conversationId: "story-canvas:project-a",
      projectId: "project-a",
      workspaceId: "workspace-a",
      selectedSkillKey: null,
    };
    const controller = createStoryCanvasChatTransport(context);

    await expect(
      controller.transport.sendMessages({
        trigger: "submit-message",
        chatId: context.conversationId,
        messageId: "assistant-turn-1",
        messages: [
          {
            id: "creator-turn-1",
            role: "user",
            parts: [{ type: "text", text: "Draft the story" }],
          },
          {
            id: "assistant-turn-1",
            role: "assistant",
            parts: [
              {
                type: "dynamic-tool",
                toolName: "propose_story_patch",
                toolCallId: "tool-call-1",
                state: "output-available",
                input: {},
                output: { ok: true },
              },
            ],
          },
        ],
        abortSignal: undefined,
      })
    ).rejects.toThrow("COPILOT_USER_MESSAGE_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
