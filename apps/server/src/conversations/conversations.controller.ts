/**
 *   POST   /aurora/conversations                          open inquiry (get-or-create)
 *   GET    /aurora/conversations                          inbox feed
 *   GET    /aurora/conversations/:id                      detail
 *   GET    /aurora/conversations/:id/messages             paginated messages
 *   POST   /aurora/conversations/:id/messages             send text
 *   POST   /aurora/conversations/:id/attachments          send crew assets
 *   POST   /aurora/conversations/:id/task-cards           share a crew task
 *   POST   /aurora/conversations/:id/proposals            creator sends proposal
 *   POST   /aurora/conversations/:id/proposals/:mid/decline  buyer declines proposal
 *   POST   /aurora/conversations/:id/read                 advance read cursor
 *
 * Proposal **accept** is owned by OrdersController — accepting a
 * proposal materializes an Order, which is the orders module's
 * domain. This module just sources the proposal payload and lets
 * orders do the rest.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { Message as PrismaMessage } from '@prisma/client';
import type {
  ConversationCardDTO,
  ConversationDTO,
  MessageDTO,
} from '@repo/shared/conversation';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ConversationsService } from './conversations.service';
import {
  ListInboxQuerySchema,
  ListMessagesQuerySchema,
  MarkReadSchema,
  OpenConversationSchema,
  SendAttachmentsSchema,
  SendMessageSchema,
  SendProposalSchema,
  SendTaskCardSchema,
  type ListInboxQuery,
  type ListMessagesQuery,
  type MarkReadInput,
  type OpenConversationInput,
  type SendAttachmentsInput,
  type SendMessageInput,
  type SendProposalInput,
  type SendTaskCardInput,
} from './dto';
import {
  toConversationCardDTO,
  toConversationDTO,
  toMessageDTO,
  type CrewCardContext,
} from './mappers';
import { PrismaService } from '../infra/db/db.module';
import {
  CONVERSATION_REALTIME,
  type ConversationRealtimePublisher,
} from './conversation-realtime.service';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly svc: ConversationsService,
    private readonly prisma: PrismaService,
    @Inject(CONVERSATION_REALTIME)
    private readonly realtime: ConversationRealtimePublisher,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async open(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OpenConversationSchema))
    body: OpenConversationInput,
  ): Promise<{
    conversation: ConversationDTO;
    firstMessage: MessageDTO | null;
  }> {
    // Resolve the creator from the service row. This keeps the
    // client from having to know (and lie about) the counterparty.
    const service = await this.prisma.creatorService.findUnique({
      where: { id: body.contextId },
      select: { id: true, creatorId: true, status: true, deletedAt: true },
    });
    // 404 (not 403/409) when missing OR archived — matches
    // service-detail visibility for non-owners; we don't leak that
    // a draft/paused/archived service exists at this id.
    if (!service || service.deletedAt || service.status !== 'listed') {
      throw new NotFoundException('Service not found');
    }
    if (service.creatorId === user.userId) {
      throw new BadRequestException('Cannot inquire about your own service');
    }
    // Wrap conv-open + optional first-message in one tx so a
    // network drop mid-flight can't leave an empty conversation
    // behind. Broadcasts fire only after the tx commits — same
    // pending-list pattern used by the orders flow.
    const pendingMessages: PrismaMessage[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const conv = await this.svc.openServiceConversation(
        {
          serviceId: service.id,
          buyerId: user.userId,
          creatorId: service.creatorId,
        },
        tx,
      );
      let first: PrismaMessage | null = null;
      if (body.firstMessage) {
        first = await this.svc.persistText(
          conv.id,
          user.userId,
          body.firstMessage,
          tx,
        );
        pendingMessages.push(first);
      }
      return { conv, first };
    });

    for (const m of pendingMessages) await this.svc.broadcastMessage(m);

    const detail = await this.svc.detail(result.conv.id, user.userId);
    return {
      conversation: toConversationDTO(detail, user.userId),
      firstMessage: result.first ? toMessageDTO(result.first) : null,
    };
  }

  @Get()
  async listInbox(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListInboxQuerySchema)) query: ListInboxQuery,
  ): Promise<{ items: ConversationCardDTO[]; nextCursor: string | null }> {
    const { items, nextCursor } = await this.svc.listInbox(user.userId, query);
    const crews = await this.loadCrewCardContexts(
      items.filter((c) => c.contextType === 'crew').map((c) => c.contextId),
    );
    return {
      items: items.map((c) =>
        toConversationCardDTO(c as never, user.userId, crews.get(c.contextId)),
      ),
      nextCursor,
    };
  }

  /**
   * Short-lived credential for this user's private Conversations event
   * channel. The token is identity-bound and subscribe-only.
   */
  @Get('realtime-token')
  @Header('Cache-Control', 'no-store')
  async realtimeToken(@CurrentUser() user: AuthUser) {
    return this.realtime.issueUserGrant(user.userId);
  }

  /**
   * Short-lived room credential for a crew conversation. Authorization is
   * re-evaluated on every refresh, so a removed member cannot renew access.
   */
  @Get(':id/realtime-token')
  @Header('Cache-Control', 'no-store')
  async crewRealtimeToken(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    const conversationId = parseIdParam(idRaw, 'id');
    const conversation = await this.svc.detail(conversationId, user.userId);
    if (conversation.contextType !== 'crew') {
      throw new NotFoundException('Crew conversation not found');
    }
    return this.realtime.issueCrewGrant(conversationId, user.userId);
  }

  @Get(':id')
  async detail(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ConversationDTO> {
    const conv = await this.svc.detail(parseIdParam(idRaw, 'id'), user.userId);
    return toConversationDTO(conv, user.userId);
  }

  @Get(':id/messages')
  async listMessages(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListMessagesQuerySchema))
    query: ListMessagesQuery,
  ): Promise<{ items: MessageDTO[]; nextCursor: string | null }> {
    const { items, nextCursor } = await this.svc.listMessages(
      parseIdParam(idRaw, 'id'),
      user.userId,
      query,
    );
    return { items: items.map(toMessageDTO), nextCursor };
  }

  /**
   * Send a text message. When the client supplies `clientKey`, a
   * retry of the same send returns the row the first attempt created
   * rather than appending a duplicate — still 201, still the same
   * body, so the client needs no special case.
   */
  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendText(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageInput,
  ): Promise<MessageDTO> {
    const msg = await this.svc.sendText(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body.body,
      body.clientKey ?? null,
      body.mentions,
    );
    return toMessageDTO(msg);
  }

  @Post(':id/attachments')
  @HttpCode(HttpStatus.CREATED)
  async sendAttachments(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SendAttachmentsSchema))
    body: SendAttachmentsInput,
  ): Promise<MessageDTO> {
    const msg = await this.svc.sendAttachments(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body,
    );
    return toMessageDTO(msg);
  }

  @Post(':id/task-cards')
  @HttpCode(HttpStatus.CREATED)
  async sendTaskCard(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SendTaskCardSchema))
    body: SendTaskCardInput,
  ): Promise<MessageDTO> {
    const msg = await this.svc.sendTaskCard(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body,
    );
    return toMessageDTO(msg);
  }

  @Post(':id/proposals')
  @HttpCode(HttpStatus.CREATED)
  async sendProposal(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SendProposalSchema)) body: SendProposalInput,
  ): Promise<MessageDTO> {
    const msg = await this.svc.sendProposal(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body,
    );
    return toMessageDTO(msg);
  }

  /**
   * Decline a proposal — buyer-only. Updates the proposal message's
   * `payload.status` to `declined` and emits a system message in
   * the thread.
   */
  @Post(':id/proposals/:mid/decline')
  @HttpCode(HttpStatus.OK)
  async declineProposal(
    @Param('id') idRaw: string,
    @Param('mid') midRaw: string,
    @CurrentUser() user: AuthUser,
  ): Promise<MessageDTO> {
    // All validation + state mutation atomically inside
    // ConversationsService.declineProposal (FOR UPDATE on the
    // proposal row). See its docstring for the race story.
    const updated = await this.svc.declineProposal(
      parseIdParam(idRaw, 'id'),
      user.userId,
      parseIdParam(midRaw, 'mid'),
    );
    return toMessageDTO(updated);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MarkReadSchema)) body: MarkReadInput,
  ): Promise<{ lastReadMessageId: string }> {
    const updated = await this.svc.markRead(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body.lastReadMessageId,
    );
    return {
      lastReadMessageId: updated.lastReadMessageId ?? body.lastReadMessageId,
    };
  }

  /**
   * Crew name / logo / member count for the crew rows on this inbox
   * page. A crew row renders the CREW, not a counterparty, so without
   * this the row would have nothing to show.
   *
   * Two batched queries for the whole page (never per-row): the crew
   * rows, and a grouped count of their active members.
   *
   * `deletedAt: null` matches every other crew read on the platform. A
   * soft-deleted crew's thread 404s on open (the service's crew gate
   * filters the same way), so naming and previewing it in the inbox
   * would advertise a row that cannot be opened. `listInbox` already
   * drops those rows before they reach here; this keeps the display
   * lookup from being the one place that would still resurrect one.
   */
  private async loadCrewCardContexts(
    crewIdsRaw: string[],
  ): Promise<Map<string, CrewCardContext>> {
    const crewIds = [...new Set(crewIdsRaw)];
    if (crewIds.length === 0) return new Map();
    const [crews, counts] = await Promise.all([
      this.prisma.crew.findMany({
        where: { id: { in: crewIds }, deletedAt: null },
        select: { id: true, name: true, logo: true },
      }),
      this.prisma.crewMember.groupBy({
        by: ['crewId'],
        where: { crewId: { in: crewIds }, status: 'active' },
        _count: { _all: true },
      }),
    ]);
    const memberCounts = new Map(counts.map((c) => [c.crewId, c._count._all]));
    return new Map(
      crews.map((c) => [
        c.id,
        {
          name: c.name,
          logo: c.logo,
          memberCount: memberCounts.get(c.id) ?? 0,
        },
      ]),
    );
  }
}
