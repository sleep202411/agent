import { AcademyFxInput } from './academy-fx';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentUser, SkipEndUserAuth, type AuthUser } from '../auth';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { RequestWithdrawal } from './withdrawal-contract';
import {
  WithdrawalAdminService,
  WithdrawalDecision,
  WithdrawalQueueQuery,
  WITHDRAWAL_MANAGE_PERMISSION,
} from './withdrawal-admin.service';

const HistoryQuery = z.strictObject({ cursor: z.uuid().optional() });
@Controller('me/withdrawals')
export class CreatorWithdrawalsController {
  constructor(private readonly withdrawals: CreatorWithdrawalsService) {}
  @Get('balances')
  @Header('Cache-Control', 'no-store')
  balances(@CurrentUser() user: AuthUser) {
    return this.withdrawals.balances(user.userId);
  }
  @Get('recipient')
  @Header('Cache-Control', 'no-store')
  async recipient(@CurrentUser() user: AuthUser, @Res() response: Response) {
    // Serialize null explicitly: Nest otherwise sends an empty body. Preserve
    // the nullable response contract shared by Web and Mobile.
    response.json(await this.withdrawals.savedRecipient(user.userId));
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  history(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(HistoryQuery))
    query: z.infer<typeof HistoryQuery>,
  ) {
    return this.withdrawals.history(user.userId, query.cursor);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RequestWithdrawal))
    body: z.infer<typeof RequestWithdrawal>,
  ) {
    return this.withdrawals.request(user.userId, body);
  }
}

@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(WITHDRAWAL_MANAGE_PERMISSION)
@Controller('admin/creator-withdrawals')
export class CreatorWithdrawalsAdminController {
  constructor(private readonly withdrawals: WithdrawalAdminService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  async queue(
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(WithdrawalQueueQuery))
    query: z.infer<typeof WithdrawalQueueQuery>,
  ) {
    return { code: 200, data: await this.withdrawals.queue(admin, query) };
  }
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async exportCsv(
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(WithdrawalQueueQuery))
    query: z.infer<typeof WithdrawalQueueQuery>,
  ) {
    return { code: 200, data: await this.withdrawals.exportCsv(admin, query) };
  }

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  async overview(@CurrentAdmin() admin: AdminActor) {
    return { code: 200, data: await this.withdrawals.overview(admin) };
  }
  @Get('academy-fx')
  @Header('Cache-Control', 'no-store')
  async academyFx(@CurrentAdmin() admin: AdminActor) {
    return { code: 200, data: await this.withdrawals.academyFx(admin) };
  }
  @Post('academy-fx')
  @HttpCode(200)
  async setAcademyFx(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(AcademyFxInput))
    body: z.infer<typeof AcademyFxInput>,
  ) {
    return {
      code: 200,
      data: await this.withdrawals.setAcademyFx(admin, body),
    };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async detail(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return { code: 200, data: await this.withdrawals.detail(admin, id) };
  }
  @Post(':id/recipient')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async recipient(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return { code: 200, data: await this.withdrawals.recipient(admin, id) };
  }
  @Post(':id/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async decide(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(WithdrawalDecision))
    body: z.infer<typeof WithdrawalDecision>,
  ) {
    return { code: 200, data: await this.withdrawals.decide(admin, id, body) };
  }
}
