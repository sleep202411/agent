/**
 * DB row → wire DTO conversions for conversations + messages.
 *
 * Unread-count math lives here so all surfaces (REST, WS push) use
 * the same definition: messages whose createdAt is strictly after
 * the participant's lastReadAt cursor.
 */
import type {
  Conversation,
  ConversationParticipant,
  Message,
} from '@prisma/client';
import type {
  ConversationCardDTO,
  ConversationDTO,
  ConversationParticipantDTO,
  ConversationParticipantRole,
  ConversationMessageType,
  MessageDTO,
  MessagePayload,
} from '@repo/shared/conversation';

export function toMessageDTO(row: Message): MessageDTO {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    type: row.type as ConversationMessageType,
    body: row.body,
    payload: (row.payload ?? null) as MessagePayload | null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toParticipantDTO(
  p: ConversationParticipant,
): ConversationParticipantDTO {
  return {
    userId: p.userId,
    role: p.role as ConversationParticipantRole,
    lastReadMessageId: p.lastReadMessageId,
  };
}

/**
 * Detail view of a conversation for a specific viewer. Unread count
 * is computed against the viewer's read cursor; for non-participant
 * callers (admin / arbitration, later) pass viewerId=null and we
 * return 0.
 */
export function toConversationDTO(
  conv: Conversation & {
    participants: ConversationParticipant[];
    _unreadCount?: number;
    _lastMessage?: Message | null;
  },
  viewerId: string | null,
): ConversationDTO {
  const participants = conv.participants.map(toParticipantDTO);
  const viewer = viewerId
    ? conv.participants.find((p) => p.userId === viewerId)
    : undefined;
  return {
    id: conv.id,
    contextType: conv.contextType,
    contextId: conv.contextId,
    participants,
    lastMessage: conv._lastMessage ? toMessageDTO(conv._lastMessage) : null,
    lastMessageAt: conv.lastMessageAt.toISOString(),
    unreadCount: viewer ? (conv._unreadCount ?? 0) : 0,
    createdAt: conv.createdAt.toISOString(),
  };
}

/**
 * Inbox row projection. Computes the counterparty + short preview
 * string + unread count for the viewer.
 *
 * The preview string is what shows under the conversation row in
 * the inbox list. For system messages we pass the kind through —
 * the client renders via its localized template — and for proposals
 * we pass a marker string the client can render specially.
 */
export function toConversationCardDTO(
  conv: Conversation & {
    participants: ConversationParticipant[];
    _unreadCount: number;
    _lastMessage: Message | null;
  },
  viewerId: string,
): ConversationCardDTO {
  const me = conv.participants.find((p) => p.userId === viewerId);
  const other = conv.participants.find((p) => p.userId !== viewerId);
  // If me is missing the controller should have 403'd already, but
  // we degrade safely to the first non-me participant rather than
  // throwing here.
  const counterparty = other ?? conv.participants[0];

  const lm = conv._lastMessage;
  const preview = lm ? renderInboxPreview(lm) : '';
  return {
    id: conv.id,
    contextType: conv.contextType,
    contextId: conv.contextId,
    counterpartyId: counterparty.userId,
    counterpartyRole: counterparty.role as ConversationParticipantRole,
    lastMessagePreview: preview,
    lastMessageType: (lm?.type ?? 'text') as ConversationMessageType,
    lastMessageAt: conv.lastMessageAt.toISOString(),
    unreadCount: me ? conv._unreadCount : 0,
  };
}

/**
 * Inbox preview is short and deterministic. We do NOT localize on
 * the server — the client picks the locale string for system
 * messages from the payload kind; for plain text we just send the
 * first line truncated.
 */
function renderInboxPreview(m: Message): string {
  if (m.type === 'text') {
    // First line, ≤ 140 chars. Strips inline newlines so inbox rows
    // stay single-line.
    const firstLine = m.body.split(/\r?\n/, 1)[0] ?? '';
    return firstLine.length > 140 ? firstLine.slice(0, 137) + '...' : firstLine;
  }
  if (m.type === 'proposal') {
    return '[proposal]';
  }
  if (m.type === 'system') {
    const payload = m.payload;
    if (payload && typeof payload === 'object' && 'system' in payload) {
      const sys = (payload as { system?: { kind?: string } }).system;
      return sys?.kind ? `[system:${sys.kind}]` : '[system]';
    }
    return '[system]';
  }
  if (m.type === 'image') return '[image]';
  if (m.type === 'file') return '[file]';
  return '';
}
