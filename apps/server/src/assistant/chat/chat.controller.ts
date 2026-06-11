/**
 * Read endpoints for the per-conversation message store. Mounted under
 * /aurora/chat/* with hyphen-separated routes to match the rest of our
 * API (see /aurora/submit-message-to-agent etc.).
 */
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { MessageStoreService } from './message-store.service';
import { AgentStateService } from './agent-state.service';

type GetMessagesBody = {
  conversationId?: string;
  /** Legacy param kept for the migration window — same value as conversationId. */
  projectId?: string;
  /** Extra scope, ignored for now but accepted for oii parity. */
  workspaceId?: string;
  lcMessageIds?: unknown;
  messageIds?: unknown;
};

type ListBody = {
  conversationId?: string;
  projectId?: string;
  workspaceId?: string;
};

function pickConversationId(body: {
  conversationId?: unknown;
  projectId?: unknown;
}) {
  const v = body.conversationId ?? body.projectId;
  if (typeof v !== 'string' || v.length === 0) return null;
  return v;
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly store: MessageStoreService,
    private readonly agentState: AgentStateService,
  ) {}

  /**
   * Returns the full message payloads for the requested ids.
   */
  @Post('get-messages')
  async getMessages(@Body() body: GetMessagesBody) {
    const conversationId = pickConversationId(body);
    if (!conversationId) {
      throw new HttpException(
        'conversationId (or projectId) is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const rawIds = body.lcMessageIds ?? body.messageIds;
    if (!Array.isArray(rawIds)) {
      throw new HttpException(
        'lcMessageIds[] (or messageIds[]) is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const ids = (rawIds as unknown[]).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const messages = await this.store.getMessages(conversationId, ids);
    return { conversationId, messages };
  }

  /**
   * List-style companion — returns the full ordered id list + the current
   * agent state. Clients use this on (re)connect to reconcile against
   * their local cache before subscribing to the WS.
   */
  @Post('list-messages')
  async listMessages(@Body() body: ListBody) {
    const conversationId = pickConversationId(body);
    if (!conversationId) {
      throw new HttpException(
        'conversationId (or projectId) is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const [messageIds, legacyAgentState, richAgentState] = await Promise.all([
      this.store.getMessageIds(conversationId),
      this.store.getAgentState(conversationId),
      this.agentState.get(conversationId),
    ]);
    // `agentState` (legacy string) kept for any client still reading
    // it; new clients read `agentStateRich` which carries turnId /
    // lastError / enteredAt for richer composer hints. The new field
    // is the authoritative source-of-truth — see
    // packages/shared/src/agent-state.ts.
    return {
      conversationId,
      messageIds,
      agentState: legacyAgentState,
      agentStateRich: richAgentState,
    };
  }

  /**
   * Wipe the conversation. "New conversation" UX hits this; downstream
   * WS clients see a hash mismatch on the next heartbeat and resync.
   */
  @Post('clear-conversation')
  async clearConversation(@Body() body: ListBody) {
    const conversationId = pickConversationId(body);
    if (!conversationId) {
      throw new HttpException(
        'conversationId (or projectId) is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.store.clearConversation(conversationId);
    return { conversationId, cleared: true };
  }
}
