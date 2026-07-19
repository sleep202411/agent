import { DefaultChatTransport, type UIMessage } from "ai";
import type { StoryDirectingSkillKey } from "@repo/shared/story-directing-skills";

const COPILOT_API = "/aurora/copilot/stream";

export interface StoryCanvasChatRequestContext {
  conversationId: string;
  projectId: string;
  workspaceId: string | null;
  selectedSkillKey: StoryDirectingSkillKey | null;
}

/**
 * Keep one transport for the lifetime of useChat while reading request-scoped
 * values at send time. useChat does not replace its internal transport merely
 * because a component rendered a new transport object.
 */
export interface StoryCanvasChatTransportController {
  transport: DefaultChatTransport<UIMessage>;
  updateContext: (context: StoryCanvasChatRequestContext) => void;
}

export function createStoryCanvasChatTransport(
  initialContext: StoryCanvasChatRequestContext
): StoryCanvasChatTransportController {
  let context = initialContext;
  const transport = new DefaultChatTransport<UIMessage>({
    api: COPILOT_API,
    credentials: "include",
    prepareSendMessagesRequest({ messages, trigger }) {
      const message = lastUserMessage(messages);
      return {
        body: {
          message,
          trigger,
          conversationId: context.conversationId,
          projectId: context.projectId,
          mode: "story-canvas",
          selectedSkillKeys: context.selectedSkillKey ? [context.selectedSkillKey] : [],
        },
        headers: {
          ...(context.workspaceId ? { "x-fizz-workspace-id": context.workspaceId } : {}),
        },
      };
    },
  });
  return {
    transport,
    updateContext(nextContext) {
      context = nextContext;
    },
  };
}

function lastUserMessage(messages: UIMessage[]): UIMessage {
  const message = messages[messages.length - 1];
  if (message?.role !== "user") throw new Error("COPILOT_USER_MESSAGE_REQUIRED");
  return message;
}
