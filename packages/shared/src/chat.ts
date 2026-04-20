/**
 * Chat message schema — LangChain-compatible so we can interop with external
 * message histories without migration headaches (tool_calls, additional_kwargs
 * shape, message types all mirror LangChain's JSON wire format).
 *
 * `workflow_card` is our extension for embedding a live-updating task-card
 * reference inside the conversation. The card's contents come from the
 * workflow status API, not from the chat stream.
 */
import { z } from "zod";
import { PERSONAS } from "./personas.js";

export const MessageType = z.enum(["human", "ai", "tool", "workflow_card"]);
export type MessageType = z.infer<typeof MessageType>;

export const MessageKind = z.enum([
  "user_original",
  "user_option_choice",
  "mock_user_question",
  "workflow_progress",
]);
export type MessageKind = z.infer<typeof MessageKind>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
});

export const OptionArgsSchema = z.object({
  /** Id of the AI message this option belongs to; used when posting the choice. */
  messageId: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      /**
       * Opaque sentinel passed back to the agent when user clicks. Usually a
       * short tag like "CONTINUE" or "REVISE" — enables deterministic routing
       * without relying on the model to parse Chinese confirmation phrases.
       */
      value: z.string(),
    })
  ),
  /** Populated after user clicks. */
  selected: z.string().optional(),
  selectedIndex: z.number().int().min(0).optional(),
});

export const AdditionalKwargsSchema = z.object({
  agentPersona: z.enum(PERSONAS).optional(),
  /** Present on workflow_card messages and on ai messages emitted inside a workflow step. */
  workflowRunId: z.string().optional(),
  messageType: MessageKind.optional(),
  optionArgs: OptionArgsSchema.optional(),
  /** Populated on workflow_progress — references the draft batch awaiting confirmation. */
  draftRunId: z.string().optional(),
});

export const ChatMessageDataSchema = z.object({
  content: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(),
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  type: MessageType,
  createdAt: z.number(),
  data: ChatMessageDataSchema,
  additional_kwargs: AdditionalKwargsSchema.default({}),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatMessageData = z.infer<typeof ChatMessageDataSchema>;
export type AdditionalKwargs = z.infer<typeof AdditionalKwargsSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type OptionArgs = z.infer<typeof OptionArgsSchema>;
