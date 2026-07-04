import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateReferralMilestoneSchema,
  UpdateReferralMilestoneSchema,
  UpdateReferralProgramSchema,
  UpsertReferralCommissionRateSchema,
  type CreateReferralMilestoneInput,
  type UpdateReferralMilestoneInput,
  type UpdateReferralProgramInput,
  type UpsertReferralCommissionRateInput,
} from './dto';
import { ReferralsService } from './referrals.service';

/**
 * /admin/referrals — referral program + milestone config. Reuses the billing
 * permission scopes (referral rewards are billing-adjacent: they grant
 * membership / points / cash).
 */
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/referrals')
export class ReferralsAdminController {
  constructor(private readonly service: ReferralsService) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('program')
  async getProgram() {
    return { code: 200, data: await this.service.getAdminConfig() };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Patch('program')
  async updateProgram(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(UpdateReferralProgramSchema))
    body: UpdateReferralProgramInput,
  ) {
    return {
      code: 200,
      data: await this.service.updateProgram(admin.id, body),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('milestones')
  async createMilestone(
    @Body(new ZodValidationPipe(CreateReferralMilestoneSchema))
    body: CreateReferralMilestoneInput,
  ) {
    return { code: 200, data: await this.service.createMilestone(body) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Patch('milestones/:id')
  async updateMilestone(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateReferralMilestoneSchema))
    body: UpdateReferralMilestoneInput,
  ) {
    return { code: 200, data: await this.service.updateMilestone(id, body) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('milestones/:id/archive')
  async archiveMilestone(@Param('id') id: string) {
    return { code: 200, data: await this.service.archiveMilestone(id) };
  }

  // ─── 消费返佣 per-user rates (KOL whitelist) ────────────────────────────

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('commission-rates')
  async listCommissionRates() {
    return { code: 200, data: await this.service.listCommissionRates() };
  }

  /** Create-or-update the rate for a user (unique per program+user). */
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('commission-rates')
  async upsertCommissionRate(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(UpsertReferralCommissionRateSchema))
    body: UpsertReferralCommissionRateInput,
  ) {
    return {
      code: 200,
      data: await this.service.upsertCommissionRate(admin.id, body),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Delete('commission-rates/:userId')
  async removeCommissionRate(@Param('userId') userId: string) {
    return {
      code: 200,
      data: await this.service.removeCommissionRate(userId),
    };
  }
}
