import { CONVERSATION_CONTEXT_TYPES, CONVERSATION_MESSAGE_TYPES } from "@repo/shared/conversation";
import { z } from "zod";
import { api } from "@/lib/api-client";
export type InboxFilter = "" | (typeof CONVERSATION_CONTEXT_TYPES)[number];
const card = z.object({
  id: z.string().min(1),
  contextType: z.enum(CONVERSATION_CONTEXT_TYPES),
  contextId: z.string().min(1),
  counterpartyId: z.string().min(1),
  counterpartyRole: z.enum(["buyer", "creator", "member"]),
  crewChannel: z.enum(["team", "community"]).nullish(),
  crewName: z.string().optional(),
  crewLogo: z.string().optional(),
  memberCount: z.number().int().nonnegative().optional(),
  lastMessagePreview: z.string(),
  lastMessageType: z.enum(CONVERSATION_MESSAGE_TYPES),
  lastMessageAt: z.string(),
  unreadCount: z.number().int().nonnegative(),
});
const page = z.object({ items: z.array(card), nextCursor: z.string().min(1).nullable() });
export type InboxItem = z.infer<typeof card>;
export async function fetchInbox(
  contextType: InboxFilter,
  cursor: string | null,
  signal: AbortSignal
) {
  return page.parse(
    await api.get("/conversations", {
      service: "aurora",
      signal,
      params: { limit: 24, ...(contextType ? { contextType } : {}), ...(cursor ? { cursor } : {}) },
    })
  );
}
