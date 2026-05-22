/**
 *   POST   /aurora/orders                                       submit (questionnaire path)
 *   POST   /aurora/orders/from-proposal/:cid/:mid               accept proposal (proposal path)
 *   GET    /aurora/orders                                       list (role filter)
 *   GET    /aurora/orders/:id                                   detail
 *   POST   /aurora/orders/:id/accept                            creator: pending_creator → in_progress
 *   POST   /aurora/orders/:id/decline                           creator: pending_creator → cancelled
 *   POST   /aurora/orders/:id/deliver                           creator: in_progress/revision → delivered
 *   POST   /aurora/orders/:id/accept-delivery                   buyer:   delivered → completed
 *   POST   /aurora/orders/:id/request-revision                  buyer:   delivered → revision_requested
 *   POST   /aurora/orders/:id/cancel                            either:  non-terminal → cancelled
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { OrderCardDTO, OrderDTO } from '@repo/shared/order';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CancelOrderSchema,
  DeclineOrderSchema,
  ListOrdersQuerySchema,
  RequestRevisionSchema,
  SubmitOrderSchema,
  type CancelOrderInput,
  type DeclineOrderInput,
  type ListOrdersQuery,
  type RequestRevisionInput,
  type SubmitOrderInput,
} from './dto';
import { toOrderCardDTO, toOrderDTO } from './mappers';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SubmitOrderSchema)) body: SubmitOrderInput,
  ): Promise<OrderDTO> {
    const row = await this.svc.submit(user.userId, body);
    return toOrderDTO(row);
  }

  @Post('from-proposal/:cid/:mid')
  @HttpCode(HttpStatus.CREATED)
  async acceptProposal(
    @Param('cid') cidRaw: string,
    @Param('mid') midRaw: string,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderDTO> {
    const row = await this.svc.acceptProposal(
      user.userId,
      parseIdParam(cidRaw, 'cid'),
      parseIdParam(midRaw, 'mid'),
    );
    return toOrderDTO(row);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListOrdersQuerySchema)) query: ListOrdersQuery,
  ): Promise<{ items: OrderCardDTO[]; nextCursor: string | null }> {
    const { items, nextCursor } = await this.svc.list(user.userId, query);
    return {
      items: items.map((row) => toOrderCardDTO(row, user.userId)),
      nextCursor,
    };
  }

  @Get(':id')
  async detail(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderDTO> {
    const row = await this.svc.detail(parseIdParam(idRaw, 'id'), user.userId);
    return toOrderDTO(row);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderDTO> {
    const row = await this.svc.accept(parseIdParam(idRaw, 'id'), user.userId);
    return toOrderDTO(row);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DeclineOrderSchema)) body: DeclineOrderInput,
  ): Promise<OrderDTO> {
    const row = await this.svc.decline(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body,
    );
    return toOrderDTO(row);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  async deliver(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderDTO> {
    const row = await this.svc.deliver(parseIdParam(idRaw, 'id'), user.userId);
    return toOrderDTO(row);
  }

  @Post(':id/accept-delivery')
  @HttpCode(HttpStatus.OK)
  async acceptDelivery(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderDTO> {
    const row = await this.svc.acceptDelivery(
      parseIdParam(idRaw, 'id'),
      user.userId,
    );
    return toOrderDTO(row);
  }

  @Post(':id/request-revision')
  @HttpCode(HttpStatus.OK)
  async requestRevision(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RequestRevisionSchema))
    body: RequestRevisionInput,
  ): Promise<OrderDTO> {
    const row = await this.svc.requestRevision(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body,
    );
    return toOrderDTO(row);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CancelOrderSchema)) body: CancelOrderInput,
  ): Promise<OrderDTO> {
    const row = await this.svc.cancel(
      parseIdParam(idRaw, 'id'),
      user.userId,
      body,
    );
    return toOrderDTO(row);
  }
}
