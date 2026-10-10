import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { BillingLedgerService } from './billing-ledger.service';
import { BillingService } from './billing.service';
import {
  ListAdminBillingLedgerJournalsQuerySchema,
  ListAdminMembershipPlansQuerySchema,
  ListAdminBillingOrdersQuerySchema,
  ListAdminBillingProviderEventsQuerySchema,
  ListAdminBillingPricesQuerySchema,
  ListAdminBillingPromotionsQuerySchema,
  ListAdminBillingRefundsQuerySchema,
  ListAdminBillingReconciliationRunsQuerySchema,
  ListAdminBillingSettlementsQuerySchema,
  BillingPriceParamsSchema,
  BillingMembershipPlanParamsSchema,
  BillingProviderEventParamsSchema,
  BillingProviderBindingParamsSchema,
  BillingPromotionParamsSchema,
  CreateAdminMembershipPlanSchema,
  CreateAdminBillingPriceSchema,
  CreateAdminBillingPromotionSchema,
  CreateAdminBillingRefundSchema,
  CreateAdminWorkspaceWalletCreditSchema,
  GetAdminWorkspaceWalletCreditQuerySchema,
  ListAdminWorkspacesQuerySchema,
  ListAdminComputeMemberUsageQuerySchema,
  ListAdminComputeProjectUsageQuerySchema,
  IgnoreAdminBillingProviderEventSchema,
  QuoteAdminBillingRefundSchema,
  UpdateAdminMembershipPlanSchema,
  UpdateAdminBillingPriceSchema,
  UpdateAdminBillingPromotionSchema,
  UpdateAdminMembershipPlanBenefitsSchema,
  UpsertAdminBillingProviderBindingSchema,
  UpsertAdminBillingPromotionProviderBindingSchema,
  GenerateVouchersSchema,
  ListVouchersQuerySchema,
  CreateCreditCampaignSchema,
  ListCreditCampaignsQuerySchema,
  UpdateCreditCampaignStatusSchema,
  CreditCampaignParamsSchema,
  UpdateCheckInConfigSchema,
  type BillingPriceParams,
  type BillingMembershipPlanParams,
  type BillingProviderEventParams,
  type BillingProviderBindingParams,
  type BillingPromotionParams,
  type CreateAdminMembershipPlanInput,
  type CreateAdminBillingPriceInput,
  type CreateAdminBillingPromotionInput,
  type CreateAdminBillingRefundInput,
  type CreateAdminWorkspaceWalletCreditInput,
  type GetAdminWorkspaceWalletCreditQueryInput,
  type ListAdminWorkspacesQueryInput,
  type ListAdminComputeMemberUsageQuery,
  type ListAdminComputeProjectUsageQuery,
  type IgnoreAdminBillingProviderEventInput,
  type ListAdminMembershipPlansQuery,
  type ListAdminBillingLedgerJournalsQuery,
  type ListAdminBillingOrdersQuery,
  type ListAdminBillingProviderEventsQuery,
  type ListAdminBillingPricesQuery,
  type ListAdminBillingPromotionsQuery,
  type ListAdminBillingRefundsQuery,
  type ListAdminBillingReconciliationRunsQuery,
  type ListAdminBillingSettlementsQuery,
  type QuoteAdminBillingRefundInput,
  type UpdateAdminMembershipPlanBenefitsInput,
  type UpdateAdminMembershipPlanInput,
  type UpdateAdminBillingPriceInput,
  type UpdateAdminBillingPromotionInput,
  type UpsertAdminBillingProviderBindingInput,
  type UpsertAdminBillingPromotionProviderBindingInput,
  type GenerateVouchersInput,
  GrantMembershipSchema,
  type GrantMembershipInput,
  ListMembershipGrantsQuerySchema,
  type ListMembershipGrantsQuery,
  MembershipGrantParamsSchema,
  type MembershipGrantParams,
  type ListVouchersQuery,
  type CreateCreditCampaignInput,
  type ListCreditCampaignsQuery,
  type UpdateCreditCampaignStatusInput,
  type CreditCampaignParams,
  type UpdateCheckInConfigInput,
} from './dto';
import { VoucherService } from './voucher.service';
import { MembershipGrantAdminService } from './membership-grant-admin.service';
import { CampaignService } from './campaign.service';
import { CheckInService } from './check-in.service';

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/billing')
export class BillingAdminController {
  constructor(
    private readonly billing: BillingService,
    private readonly ledger: BillingLedgerService,
    private readonly adminAuth: AdminAuthService,
    private readonly vouchers: VoucherService,
    private readonly campaigns: CampaignService,
    private readonly checkIn: CheckInService,
    private readonly membershipGrants: MembershipGrantAdminService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('overview')
  async overview() {
    return {
      code: 200,
      data: await this.billing.getAdminOverview(),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('wallets/workspace-credits')
  async createWorkspaceWalletCredit(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminWorkspaceWalletCreditSchema))
    body: CreateAdminWorkspaceWalletCreditInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.createAdminWorkspaceWalletCredit(
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.wallet.workspace_credit',
      'wallet_account',
      data.account.id,
      {
        workspaceId: body.workspaceId,
        amount: body.amount.toString(),
        grantType: body.grantType,
        expiresAt: body.expiresAt?.toISOString() ?? null,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('wallets/workspace-credits')
  async getWorkspaceWalletCredit(
    @Query(new ZodValidationPipe(GetAdminWorkspaceWalletCreditQuerySchema))
    query: GetAdminWorkspaceWalletCreditQueryInput,
  ) {
    return {
      code: 200,
      data: await this.billing.getAdminWorkspaceWalletBalance(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('workspaces')
  async listWorkspaces(
    @Query(new ZodValidationPipe(ListAdminWorkspacesQuerySchema))
    query: ListAdminWorkspacesQueryInput,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminWorkspaces(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('usage/member-compute')
  async listComputeMemberUsage(
    @Query(new ZodValidationPipe(ListAdminComputeMemberUsageQuerySchema))
    query: ListAdminComputeMemberUsageQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminComputeMemberUsage(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('usage/project-compute')
  async listComputeProjectUsage(
    @Query(new ZodValidationPipe(ListAdminComputeProjectUsageQuerySchema))
    query: ListAdminComputeProjectUsageQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminComputeProjectUsage(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('prices')
  async listPrices(
    @Query(new ZodValidationPipe(ListAdminBillingPricesQuerySchema))
    query: ListAdminBillingPricesQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminPrices(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('membership-plans')
  async listMembershipPlans(
    @Query(new ZodValidationPipe(ListAdminMembershipPlansQuerySchema))
    query: ListAdminMembershipPlansQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminMembershipPlans(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('membership-plans')
  async createMembershipPlan(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminMembershipPlanSchema))
    body: CreateAdminMembershipPlanInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.createAdminMembershipPlan(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.membership_plan.create',
      'billing_membership_plan',
      data.id,
      {
        planKey: body.planKey,
        productType: body.productType,
        subjectType: body.subjectType,
        rank: body.rank,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Patch('membership-plans/:planId')
  async updateMembershipPlan(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingMembershipPlanParamsSchema))
    params: BillingMembershipPlanParams,
    @Body(new ZodValidationPipe(UpdateAdminMembershipPlanSchema))
    body: UpdateAdminMembershipPlanInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.updateAdminMembershipPlan(
      params.planId,
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.membership_plan.update',
      'billing_membership_plan',
      params.planId,
      body,
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('membership-plans/:planId/benefits')
  async getMembershipPlanBenefits(
    @Param(new ZodValidationPipe(BillingMembershipPlanParamsSchema))
    params: BillingMembershipPlanParams,
  ) {
    return {
      code: 200,
      data: await this.billing.getAdminMembershipPlanBenefits(params.planId),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Put('membership-plans/:planId/benefits')
  async updateMembershipPlanBenefits(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingMembershipPlanParamsSchema))
    params: BillingMembershipPlanParams,
    @Body(new ZodValidationPipe(UpdateAdminMembershipPlanBenefitsSchema))
    body: UpdateAdminMembershipPlanBenefitsInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.updateAdminMembershipPlanBenefits(
      params.planId,
      admin.id,
      body.benefits,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.membership_plan.benefits.update',
      'billing_membership_plan',
      params.planId,
      { planKey: data.planKey, benefits: body.benefits },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('prices')
  async createPrice(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminBillingPriceSchema))
    body: CreateAdminBillingPriceInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.createAdminPrice(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.price.create',
      'billing_price',
      data.id,
      {
        code: data.code,
        productType: body.productType,
        currency: body.currency,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Patch('prices/:priceId')
  async updatePrice(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingPriceParamsSchema))
    params: BillingPriceParams,
    @Body(new ZodValidationPipe(UpdateAdminBillingPriceSchema))
    body: UpdateAdminBillingPriceInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.updateAdminPrice(params.priceId, body);
    await this.audit(
      admin,
      request,
      'admin.billing.price.update',
      'billing_price',
      params.priceId,
      body,
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('prices/:priceId/provider-bindings')
  async upsertPriceProviderBinding(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingPriceParamsSchema))
    params: BillingPriceParams,
    @Body(new ZodValidationPipe(UpsertAdminBillingProviderBindingSchema))
    body: UpsertAdminBillingProviderBindingInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.upsertAdminProviderBinding(
      params.priceId,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.price.provider_binding.upsert',
      'billing_provider_price_binding',
      data.id,
      { priceId: params.priceId, provider: body.provider },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('provider-bindings/:bindingId/sync')
  async syncPriceProviderBinding(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingProviderBindingParamsSchema))
    params: BillingProviderBindingParams,
    @Req() request: Request,
  ) {
    const data = await this.billing.syncAdminProviderBinding(params.bindingId);
    await this.audit(
      admin,
      request,
      'admin.billing.price.provider_binding.sync',
      'billing_provider_price_binding',
      params.bindingId,
      { provider: data.provider, providerPriceId: data.providerPriceId },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('provider-bindings/sync-pending')
  async syncPendingProviderBindings(
    @CurrentAdmin() admin: AdminActor,
    @Req() request: Request,
  ) {
    const data = await this.billing.syncPendingProviderBindings();
    await this.audit(
      admin,
      request,
      'admin.billing.provider_binding.sync_pending',
      'billing_provider_price_binding',
      'bulk',
      { total: data.total, synced: data.synced, failed: data.failed },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('promotions')
  async listPromotions(
    @Query(new ZodValidationPipe(ListAdminBillingPromotionsQuerySchema))
    query: ListAdminBillingPromotionsQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminPromotions(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('vouchers')
  async listVouchers(
    @Query(new ZodValidationPipe(ListVouchersQuerySchema))
    query: ListVouchersQuery,
  ) {
    return { code: 200, data: await this.vouchers.listVouchers(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('vouchers')
  async generateVouchers(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(GenerateVouchersSchema))
    body: GenerateVouchersInput,
    @Req() request: Request,
  ) {
    const data = await this.vouchers.generateVouchers(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.voucher.generate',
      'voucher_batch',
      data.batchId,
      {
        count: data.count,
        grantType: body.grantType,
        computeCreditAmount: body.computeCreditAmount,
      },
    );
    return { code: 200, data };
  }

  // --- Membership grants (admin 手动开会员) --------------------------------

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('membership-grants')
  async listMembershipGrants(
    @Query(new ZodValidationPipe(ListMembershipGrantsQuerySchema))
    query: ListMembershipGrantsQuery,
  ) {
    return {
      code: 200,
      data: await this.membershipGrants.listForSubject(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('membership-grants')
  async grantMembership(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(GrantMembershipSchema))
    body: GrantMembershipInput,
    @Req() request: Request,
  ) {
    const data = await this.membershipGrants.grant(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.membership_grant.create',
      'entitlement_grant',
      data.id,
      {
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        planKey: body.planKey,
        durationDays: body.durationDays,
        note: body.note,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('membership-grants/:grantId/revoke')
  async revokeMembershipGrant(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(MembershipGrantParamsSchema))
    params: MembershipGrantParams,
    @Req() request: Request,
  ) {
    const data = await this.membershipGrants.revoke(params.grantId);
    await this.audit(
      admin,
      request,
      'admin.billing.membership_grant.revoke',
      'entitlement_grant',
      params.grantId,
      {
        subjectType: data.subjectType,
        subjectId: data.subjectId,
        planKey: data.planKey,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('credit-campaigns')
  async listCreditCampaigns(
    @Query(new ZodValidationPipe(ListCreditCampaignsQuerySchema))
    query: ListCreditCampaignsQuery,
  ) {
    return { code: 200, data: await this.campaigns.listCampaigns(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('credit-campaigns')
  async createCreditCampaign(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateCreditCampaignSchema))
    body: CreateCreditCampaignInput,
    @Req() request: Request,
  ) {
    const data = await this.campaigns.createCampaign(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.credit_campaign.create',
      'credit_campaign',
      data.id,
      {
        name: body.name,
        computeCreditAmount: body.computeCreditAmount,
        maxClaims: body.maxClaims,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Patch('credit-campaigns/:campaignId')
  async updateCreditCampaignStatus(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(CreditCampaignParamsSchema))
    params: CreditCampaignParams,
    @Body(new ZodValidationPipe(UpdateCreditCampaignStatusSchema))
    body: UpdateCreditCampaignStatusInput,
    @Req() request: Request,
  ) {
    const data = await this.campaigns.updateCampaignStatus(
      params.campaignId,
      body.status,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.credit_campaign.update',
      'credit_campaign',
      params.campaignId,
      body,
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('check-in/config')
  async getCheckInConfig() {
    return { code: 200, data: await this.checkIn.getConfig() };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Patch('check-in/config')
  async updateCheckInConfig(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(UpdateCheckInConfigSchema))
    body: UpdateCheckInConfigInput,
    @Req() request: Request,
  ) {
    const data = await this.checkIn.updateConfig(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.check_in.config',
      'check_in_config',
      'default',
      { enabled: body.enabled, rewards: body.rewards },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('promotions')
  async createPromotion(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminBillingPromotionSchema))
    body: CreateAdminBillingPromotionInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.createAdminPromotion(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.promotion.create',
      'billing_promotion',
      data.id,
      {
        code: body.code,
        percentOffBps: body.percentOffBps,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Patch('promotions/:promotionId')
  async updatePromotion(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingPromotionParamsSchema))
    params: BillingPromotionParams,
    @Body(new ZodValidationPipe(UpdateAdminBillingPromotionSchema))
    body: UpdateAdminBillingPromotionInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.updateAdminPromotion(
      params.promotionId,
      admin.id,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.promotion.update',
      'billing_promotion',
      params.promotionId,
      body,
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('promotions/:promotionId/provider-bindings')
  async upsertPromotionProviderBinding(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingPromotionParamsSchema))
    params: BillingPromotionParams,
    @Body(
      new ZodValidationPipe(UpsertAdminBillingPromotionProviderBindingSchema),
    )
    body: UpsertAdminBillingPromotionProviderBindingInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.upsertAdminPromotionProviderBinding(
      params.promotionId,
      body,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.promotion.provider_binding.upsert',
      'billing_promotion_provider_binding',
      data.id,
      { promotionId: params.promotionId, provider: body.provider },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('promotion-provider-bindings/:bindingId/sync')
  async syncPromotionProviderBinding(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingProviderBindingParamsSchema))
    params: BillingProviderBindingParams,
    @Req() request: Request,
  ) {
    const data = await this.billing.syncAdminPromotionProviderBinding(
      params.bindingId,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.promotion.provider_binding.sync',
      'billing_promotion_provider_binding',
      params.bindingId,
      { provider: data.provider, providerCouponId: data.providerCouponId },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('orders')
  async listOrders(
    @Query(new ZodValidationPipe(ListAdminBillingOrdersQuerySchema))
    query: ListAdminBillingOrdersQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminOrders(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('refunds')
  async listRefunds(
    @Query(new ZodValidationPipe(ListAdminBillingRefundsQuerySchema))
    query: ListAdminBillingRefundsQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminRefunds(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Post('refunds/quote')
  async quoteRefund(
    @Body(new ZodValidationPipe(QuoteAdminBillingRefundSchema))
    body: QuoteAdminBillingRefundInput,
  ) {
    return {
      code: 200,
      data: await this.billing.quoteAdminRefund(body),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('refunds')
  async createRefund(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminBillingRefundSchema))
    body: CreateAdminBillingRefundInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.createAdminRefund(admin.id, body);
    await this.audit(
      admin,
      request,
      'admin.billing.refund.create',
      'billing_refund',
      data.id,
      {
        refundNo: data.refundNo,
        orderId: body.orderId,
        amountMinor: data.amountMinor,
        percentBps: body.percentBps ?? null,
        reasonCode: body.reasonCode,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('provider-events')
  async listProviderEvents(
    @Query(new ZodValidationPipe(ListAdminBillingProviderEventsQuerySchema))
    query: ListAdminBillingProviderEventsQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listAdminProviderEvents(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('provider-events/:eventId/reprocess')
  async reprocessProviderEvent(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingProviderEventParamsSchema))
    params: BillingProviderEventParams,
    @Req() request: Request,
  ) {
    const data = await this.billing.reprocessAdminProviderEvent(params.eventId);
    await this.audit(
      admin,
      request,
      'admin.billing.provider_event.reprocess',
      'billing_payment_provider_event',
      params.eventId,
      {
        provider: data.provider,
        providerEventId: data.providerEventId,
        eventType: data.eventType,
        status: data.status,
        orderId: data.orderId,
        paymentIntentId: data.paymentIntentId,
        refundId: data.refundId,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingWrite)
  @Post('provider-events/:eventId/ignore')
  async ignoreProviderEvent(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(BillingProviderEventParamsSchema))
    params: BillingProviderEventParams,
    @Body(new ZodValidationPipe(IgnoreAdminBillingProviderEventSchema))
    body: IgnoreAdminBillingProviderEventInput,
    @Req() request: Request,
  ) {
    const data = await this.billing.ignoreAdminProviderEvent(
      params.eventId,
      body.reason,
    );
    await this.audit(
      admin,
      request,
      'admin.billing.provider_event.ignore',
      'billing_payment_provider_event',
      params.eventId,
      {
        provider: data.provider,
        providerEventId: data.providerEventId,
        eventType: data.eventType,
        reason: body.reason,
      },
    );
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('ledger/overview')
  async ledgerOverview() {
    return {
      code: 200,
      data: await this.ledger.getAdminLedgerOverview(),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('ledger/journals')
  async listLedgerJournals(
    @Query(new ZodValidationPipe(ListAdminBillingLedgerJournalsQuerySchema))
    query: ListAdminBillingLedgerJournalsQuery,
  ) {
    return {
      code: 200,
      data: await this.ledger.listAdminLedgerJournals(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('ledger/settlements')
  async listSettlements(
    @Query(new ZodValidationPipe(ListAdminBillingSettlementsQuerySchema))
    query: ListAdminBillingSettlementsQuery,
  ) {
    return {
      code: 200,
      data: await this.ledger.listAdminSettlements(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.BillingRead)
  @Get('ledger/reconciliation-runs')
  async listReconciliationRuns(
    @Query(new ZodValidationPipe(ListAdminBillingReconciliationRunsQuerySchema))
    query: ListAdminBillingReconciliationRunsQuery,
  ) {
    return {
      code: 200,
      data: await this.ledger.listAdminReconciliationRuns(query),
    };
  }

  private async audit(
    admin: AdminActor,
    request: Request,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.adminAuth.writeAudit({
      actor: admin,
      action,
      resourceType,
      resourceId,
      metadata: toAuditJsonObject(metadata),
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function toAuditJsonObject(
  value: Record<string, unknown>,
): Prisma.InputJsonObject {
  const output: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    output[key] = toAuditJsonValue(entry);
  }
  return output as Prisma.InputJsonObject;
}

function toAuditJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toAuditJsonValue(entry));
  }
  if (typeof value === 'object') {
    const output: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (entry === undefined) {
        continue;
      }
      output[key] = toAuditJsonValue(entry);
    }
    return output as Prisma.InputJsonObject;
  }
  if (typeof value === 'symbol') {
    return value.description ?? 'symbol';
  }
  if (typeof value === 'function') {
    return value.name ? `function:${value.name}` : 'function';
  }
  return 'unknown';
}
