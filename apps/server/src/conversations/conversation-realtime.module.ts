import { Module } from '@nestjs/common';
import {
  CONVERSATION_REALTIME,
  conversationAblyRestProvider,
  conversationRealtimeProvider,
} from './conversation-realtime.service';

/**
 * Process-wide Ably transport owner for authenticated collaboration events.
 *
 * The user channel carries conversation inbox frames, crew-task and crew-asset
 * invalidations, and in-app notification signals. Crew group-chat messages
 * additionally use Ably Chat rooms through the same REST client. Keeping these
 * providers in a transport-only module lets producers share one policy without
 * depending on each other's business modules.
 */
@Module({
  providers: [conversationAblyRestProvider, conversationRealtimeProvider],
  exports: [CONVERSATION_REALTIME],
})
export class ConversationRealtimeModule {}
