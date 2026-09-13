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
  CreateCrewEarningSchema,
  type CreateCrewEarningInput,
  DecideCrewEarningSchema,
  type DecideCrewEarningInput,
  ListCrewEarningsQuerySchema,
  ListMyCrewEarningsQuerySchema,
  type ListMyCrewEarningsQuery,
  type ListCrewEarningsQuery,
  RejectCrewEarningSchema,
  type RejectCrewEarningInput,
  ReverseCrewEarningSchema,
  type ReverseCrewEarningInput,
} from './earnings.dto';
import { CrewEarningsService } from './earnings.service';

@Controller()
export class CrewEarningsController {
  constructor(private readonly earnings: CrewEarningsService) {}

  @Get('me/crew-earnings')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListMyCrewEarningsQuerySchema))
    query: ListMyCrewEarningsQuery,
  ) {
    return this.earnings.listMine(user.userId, query);
  }

  @Get('crews/:crewId/earnings')
  list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewEarningsQuerySchema))
    query: ListCrewEarningsQuery,
  ) {
    return this.earnings.list(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query,
    );
  }

  @Post('crews/:crewId/earnings')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewEarningSchema))
    body: CreateCrewEarningInput,
  ) {
    return this.earnings.create(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Get('crew-earnings/:earningId')
  detail(@Param('earningId') earningId: string, @CurrentUser() user: AuthUser) {
    return this.earnings.detail(
      parseIdParam(earningId, 'earningId'),
      user.userId,
    );
  }

  @Post('crew-earnings/:earningId/approve')
  approve(
    @Param('earningId') earningId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DecideCrewEarningSchema))
    body: DecideCrewEarningInput,
  ) {
    return this.earnings.approve(
      parseIdParam(earningId, 'earningId'),
      user.userId,
      body,
    );
  }

  @Post('crew-earnings/:earningId/reject')
  reject(
    @Param('earningId') earningId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RejectCrewEarningSchema))
    body: RejectCrewEarningInput,
  ) {
    return this.earnings.reject(
      parseIdParam(earningId, 'earningId'),
      user.userId,
      body,
    );
  }

  @Post('crew-earnings/:earningId/reverse')
  reverse(
    @Param('earningId') earningId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReverseCrewEarningSchema))
    body: ReverseCrewEarningInput,
  ) {
    return this.earnings.reverse(
      parseIdParam(earningId, 'earningId'),
      user.userId,
      body,
    );
  }
}
