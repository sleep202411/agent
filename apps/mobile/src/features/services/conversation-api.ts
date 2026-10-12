import { z } from "zod";
import {
  CONVERSATION_CONTEXT_TYPES,
  CONVERSATION_MESSAGE_TYPES,
  CONVERSATION_PARTICIPANT_ROLES,
  PROPOSAL_STATUSES,
} from "@repo/shared/conversation";
import { SERVICE_TIERS } from "@repo/shared/creator-service";
import { ALL_CURRENCIES } from "@repo/shared/crew";
import { api } from "@/lib/api-client";

const id = z.string().min(1).max(64);
const mention = z.object({ userId: id, label: z.string() });
const task = z.object({ taskId: id, crewId: id, number: z.number().int(), label: z.string() });
const references = { mentions: z.array(mention).optional(), tasks: z.array(task).optional() };
const payload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), ...references }),
  z.object({
    kind: z.literal("attachments"),
    ...references,
    attachments: z.array(
      z.object({
        assetNodeId: id,
        mediaAssetId: id,
        name: z.string(),
        mediaKind: z.enum(["image", "video", "audio", "document", "other"]),
        contentType: z.string(),
        sizeBytes: z.number().nonnegative().nullable(),
      })
    ),
  }),
  z.object({
    kind: z.literal("proposal"),
    proposal: z.object({
      status: z.enum(PROPOSAL_STATUSES),
      packageTier: z.enum(SERVICE_TIERS),
      price: z.number().nonnegative(),
      currency: z.enum(ALL_CURRENCIES),
      deliveryDays: z.number().int().positive(),
      revisions: z.number().int().min(-1),
      scope: z.array(z.string()),
      note: z.string(),
      acceptedAt: z.string().nullish(),
      declinedAt: z.string().nullish(),
      orderId: id.nullish(),
    }),
  }),
  // New system events remain readable as generic activity; never treat kind
  // text as a navigation target or executable markup.
  z.object({
    kind: z.literal("system"),
    system: z.object({
      kind: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])),
    }),
  }),
]);
export const messageSchema = z
  .object({
    id,
    conversationId: id,
    authorId: id.nullable(),
    clientKey: id.nullish(),
    type: z.enum(CONVERSATION_MESSAGE_TYPES),
    body: z.string(),
    payload: payload.nullable(),
    createdAt: z.string().min(1),
  })
  .refine((m) => {
    if (m.type === "text") return m.payload === null || m.payload.kind === "text";
    if (m.type === "image" || m.type === "file") return m.payload?.kind === "attachments";
    return m.payload?.kind === m.type;
  }, "Message type and payload disagree");
export type NativeMessage = z.infer<typeof messageSchema>;
const conversationSchema = z.object({
  id,
  contextType: z.enum(CONVERSATION_CONTEXT_TYPES),
  contextId: id,
  crewChannel: z.enum(["team", "community"]).nullish(),
  participants: z.array(
    z.object({
      userId: id,
      role: z.enum(CONVERSATION_PARTICIPANT_ROLES),
      lastReadMessageId: id.nullable(),
    })
  ),
  lastMessage: messageSchema.nullable(),
  lastMessageAt: z.string(),
  unreadCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type NativeConversation = z.infer<typeof conversationSchema>;
const page = z.object({ items: z.array(messageSchema), nextCursor: id.nullable() });
const path = (conversationId: string) =>
  `/conversations/${encodeURIComponent(id.parse(conversationId))}`;
function assertMessageScope(message: NativeMessage, conversationId: string) {
  if (message.conversationId !== conversationId)
    throw new Error("Conversation message scope mismatch");
  return message;
}
/** Resolve the official Crew channel; never infer a conversation ID from a Crew ID. */
export async function fetchCrewConversation(
  crewId: string,
  channel: "team" | "community",
  viewerId: string,
  signal: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  z.enum(["team", "community"]).parse(channel);
  id.parse(viewerId);
  if (signal.aborted) throw new Error("Crew conversation request aborted");
  const result = conversationSchema.parse(
    await api.get(
      `/crews/${crewId}/${channel === "team" ? "conversation" : "community-conversation"}`,
      { service: "aurora", signal, retry: false }
    )
  );
  if (signal.aborted) throw new Error("Crew conversation request aborted");
  if (
    result.contextType !== "crew" ||
    result.contextId !== crewId ||
    result.crewChannel !== channel ||
    !result.participants.some((p) => p.userId === viewerId)
  )
    throw new Error("Crew conversation is not available to this account");
  if (result.lastMessage) assertMessageScope(result.lastMessage, result.id);
  return result;
}
export async function fetchConversation(
  conversationId: string,
  viewerId: string,
  signal: AbortSignal
) {
  const result = conversationSchema.parse(
    await api.get(path(conversationId), { service: "aurora", signal })
  );
  if (result.id !== conversationId || !result.participants.some((p) => p.userId === viewerId))
    throw new Error("Conversation is not available to this account");
  if (result.lastMessage) assertMessageScope(result.lastMessage, conversationId);
  return result;
}
export async function fetchConversationMessages(
  conversationId: string,
  cursor: string | null,
  signal: AbortSignal
) {
  const result = page.parse(
    await api.get(`${path(conversationId)}/messages`, {
      service: "aurora",
      signal,
      params: { limit: 50, ...(cursor ? { cursor: id.parse(cursor) } : {}) },
    })
  );
  result.items.forEach((message) => assertMessageScope(message, conversationId));
  return result;
}
export const textMessageInputSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientKey: z.string().trim().min(1).max(64),
  mentions: z
    .array(
      z.object({
        userId: id,
        label: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((v) => !/[@\r\n]/.test(v)),
      })
    )
    .max(20)
    .default([]),
  tasks: z
    .array(
      z.object({
        taskId: z.string().uuid(),
        label: z
          .string()
          .trim()
          .min(1)
          .max(260)
          .refine((v) => !/[#\r\n]/.test(v)),
      })
    )
    .max(20)
    .default([]),
});
export async function sendConversationText(
  conversationId: string,
  input: z.input<typeof textMessageInputSchema>
) {
  const data = textMessageInputSchema.parse(input);
  const result = messageSchema.parse(
    await api.post(`${path(conversationId)}/messages`, { service: "aurora", data })
  );
  assertMessageScope(result, conversationId);
  if (result.type !== "text" || result.clientKey !== data.clientKey)
    throw new Error("Message acknowledgement mismatch");
  return result;
}
export async function markConversationRead(
  conversationId: string,
  lastReadMessageId: string,
  signal: AbortSignal
) {
  // Call only for rendered messages in an active screen. Do not substitute
  // the inbox's lastMessage cursor for what the user actually viewed.
  return z.object({ lastReadMessageId: id }).parse(
    await api.post(`${path(conversationId)}/read`, {
      service: "aurora",
      signal,
      data: { lastReadMessageId: id.parse(lastReadMessageId) },
    })
  );
}
/** Pages arrive newest-first. Preserve server timestamp/id ordering, including
 * sub-millisecond precision that JS Date sorting would lose. */
export function chronologicalMessages(
  pages: readonly { items: NativeMessage[] }[]
): NativeMessage[] {
  const seen = new Set<string>();
  const result: NativeMessage[] = [];
  for (const page of pages)
    for (const message of page.items) {
      if (!seen.has(message.id)) {
        seen.add(message.id);
        result.push(message);
      }
    }
  return result.reverse();
}
