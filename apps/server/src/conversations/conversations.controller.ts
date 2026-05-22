/**
 *   POST   /aurora/conversations                          open inquiry (get-or-create)
 *   GET    /aurora/conversations                          inbox feed
 *   GET    /aurora/conversations/:id                      detail
 *   GET    /aurora/conversations/:id/messages             paginated messages
 *   POST   /aurora/conversations/:id/messages             send text
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
  HttpCode,
  HttpStatus,
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
  SendMessageSchema,
  SendProposalSchema,
  type ListInboxQuery,
  type ListMessagesQuery,
  type MarkReadInput,
  type OpenConversationInput,
  type SendMessageInput,
  type SendProposalInput,
} from './dto';
import {
  toConversationCardDTO,
  toConversationDTO,
  toMessageDTO,
} from './mappers';
import { PrismaService } from '../infra/db/db.module';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly svc: ConversationsService,
    private readonly prisma: PrismaService,
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
    return {
      items: items.map((c) => toConversationCardDTO(c as never, user.userId)),
      nextCursor,
    };
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
}
