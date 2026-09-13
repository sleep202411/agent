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
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  CreateCrewPayoutSchema,
  type CreateCrewPayoutInput,
  ListCrewPayoutsQuerySchema,
  ListMyCrewPayoutsQuerySchema,
  type ListMyCrewPayoutsQuery,
  type ListCrewPayoutsQuery,
  PayCrewPayoutSchema,
  type PayCrewPayoutInput,
  VoidCrewPayoutSchema,
  type VoidCrewPayoutInput,
} from './payouts.dto';
import { CrewPayoutsService } from './payouts.service';

@Controller()
export class CrewPayoutsController {
  constructor(private readonly payouts: CrewPayoutsService) {}

  @Get('me/crew-payouts')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListMyCrewPayoutsQuerySchema))
    query: ListMyCrewPayoutsQuery,
  ) {
    return this.payouts.listMine(user.userId, query);
  }

  @Get('crews/:crewId/payouts')
  list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewPayoutsQuerySchema))
    query: ListCrewPayoutsQuery,
  ) {
    return this.payouts.list(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query,
    );
  }

  @Post('crews/:crewId/payouts')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewPayoutSchema))
    body: CreateCrewPayoutInput,
  ) {
    return this.payouts.create(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Get('crew-payouts/:payoutId')
  detail(@Param('payoutId') payoutId: string, @CurrentUser() user: AuthUser) {
    return this.payouts.detail(parseIdParam(payoutId, 'payoutId'), user.userId);
  }

  @Post('crew-payouts/:payoutId/pay')
  pay(
    @Param('payoutId') payoutId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PayCrewPayoutSchema)) body: PayCrewPayoutInput,
  ) {
    return this.payouts.pay(
      parseIdParam(payoutId, 'payoutId'),
      user.userId,
      body,
    );
  }

  @Post('crew-payouts/:payoutId/void')
  void(
    @Param('payoutId') payoutId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(VoidCrewPayoutSchema))
    body: VoidCrewPayoutInput,
  ) {
    return this.payouts.void(
      parseIdParam(payoutId, 'payoutId'),
      user.userId,
      body,
    );
  }
}
