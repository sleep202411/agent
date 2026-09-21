import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public } from '../auth';
import type { AuthUser } from '../auth';
import { Country } from '../common/region/country.decorator';
import type { CountryCode } from '../common/region/region.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { BillingService } from './billing.service';
import {
  BillingOrderParamsSchema,
  BillingSubscriptionParamsSchema,
  CreateBillingCheckoutSchema,
  CreateComputePointTopupSchema,
  CreateCustomRechargeSchema,
  ListMembershipPlansQuerySchema,
  ListBillingPricesQuerySchema,
  ListWalletLedgerQuerySchema,
  WalletDailyUsageQuerySchema,
  WalletMemberUsageQuerySchema,
  type BillingOrderParams,
  type BillingSubscriptionParams,
  type CreateBillingCheckoutInput,
  type CreateComputePointTopupInput,
  type CreateCustomRechargeInput,
  type ListMembershipPlansQuery,
  type ListBillingPricesQuery,
  type ListWalletLedgerQuery,
  type WalletDailyUsageQuery,
  type WalletMemberUsageQuery,
  RedeemVoucherSchema,
  type RedeemVoucherInput,
  CreditCampaignParamsSchema,
  type CreditCampaignParams,
  type BillingAttributionInput,
} from './dto';
import { VoucherService } from './voucher.service';
import { CampaignService } from './campaign.service';
import { CheckInService } from './check-in.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly vouchers: VoucherService,
    private readonly campaigns: CampaignService,
    private readonly checkIn: CheckInService,
  ) {}

  @Get('check-in/status')
  async checkInStatus(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.checkIn.getStatus(user) };
  }

  @Post('check-in')
  async dailyCheckIn(@CurrentUser() user: AuthUser) {
    return { code: 200, data: await this.checkIn.checkIn(user) };
  }

  @Post('vouchers/redeem')
  async redeemVoucher(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RedeemVoucherSchema))
    body: RedeemVoucherInput,
  ) {
    return { code: 200, data: await this.vouchers.redeemVoucher(user, body) };
  }

  @Get('campaigns/active')
  async listActiveCampaigns(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: await this.campaigns.listActiveCampaignsForUser(user),
    };
  }

  @Post('campaigns/:campaignId/claim')
  async claimCampaign(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CreditCampaignParamsSchema))
    params: CreditCampaignParams,
  ) {
    return {
      code: 200,
      data: await this.campaigns.claimCampaign(user, params.campaignId),
    };
  }

  @Get('prices')
  async listPrices(
    @Query(new ZodValidationPipe(ListBillingPricesQuerySchema))
    query: ListBillingPricesQuery,
  ) {
    return { code: 200, data: await this.billing.listPrices(query) };
  }

  @Get('compute-topup-packages')
  async listComputePointTopupPackages() {
    return {
      code: 200,
      data: await this.billing.listComputePointTopupPackages(),
    };
  }

  @Public()
  @Get('membership-plans')
  async listMembershipPlans(
    @Query(new ZodValidationPipe(ListMembershipPlansQuerySchema))
    query: ListMembershipPlansQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listMembershipPlans(query),
    };
  }

  @Get('compute-balance')
  async getComputeBalance(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceId: string | undefined,
  ) {
    return {
      code: 200,
      data: await this.billing.getComputeBalance(user, workspaceId),
    };
  }

  @Get('wallet-ledger')
  async listWalletLedger(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceId: string | undefined,
    @Query(new ZodValidationPipe(ListWalletLedgerQuerySchema))
    query: ListWalletLedgerQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.listWalletLedger(user, query, workspaceId),
    };
  }

  @Get('wallet-ledger/daily-usage')
  async walletDailyUsage(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceId: string | undefined,
    @Query(new ZodValidationPipe(WalletDailyUsageQuerySchema))
    query: WalletDailyUsageQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.walletDailyUsage(user, query, workspaceId),
    };
  }

  // Per-member compute usage for a team workspace (admin-only), broken down by
  // project. Powers the team admin's "who used how much" view.
  @Get('wallet-ledger/member-usage')
  async walletMemberUsage(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceId: string | undefined,
    @Query(new ZodValidationPipe(WalletMemberUsageQuerySchema))
    query: WalletMemberUsageQuery,
  ) {
    return {
      code: 200,
      data: await this.billing.walletMemberUsage(user, query, workspaceId),
    };
  }

  @Post('checkout')
  async createCheckout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Country() country: CountryCode,
    @Body(new ZodValidationPipe(CreateBillingCheckoutSchema))
    body: CreateBillingCheckoutInput,
  ) {
    return {
      code: 200,
      data: await this.billing.createCheckout(user, {
        ...body,
        attribution: resolveBillingAttribution(body.attribution, req, country),
      }),
    };
  }

  @Post('recharge-custom')
  async createCustomRecharge(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Country() country: CountryCode,
    @Body(new ZodValidationPipe(CreateCustomRechargeSchema))
    body: CreateCustomRechargeInput,
  ) {
    return {
      code: 200,
      data: await this.billing.createCustomRecharge(
        user,
        {
          ...body,
          attribution: resolveBillingAttribution(
            body.attribution,
            req,
            country,
          ),
        },
        country,
      ),
    };
  }

  @Post('compute-topup')
  async createComputePointTopup(
    @CurrentUser() user: AuthUser,
    @Country() country: CountryCode,
    @Body(new ZodValidationPipe(CreateComputePointTopupSchema))
    body: CreateComputePointTopupInput,
  ) {
    return {
      code: 200,
      data: await this.billing.createComputePointTopup(user, body, country),
    };
  }

  @Get('orders/:orderId')
  async getOrder(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(BillingOrderParamsSchema))
    params: BillingOrderParams,
  ) {
    return {
      code: 200,
      data: await this.billing.getOrder(user, params.orderId),
    };
  }

  @Post('subscriptions/:id/cancel')
  async cancelSubscription(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(BillingSubscriptionParamsSchema))
    params: BillingSubscriptionParams,
  ) {
    return {
      code: 200,
      data: await this.billing.cancelSubscription(user, params.id),
    };
  }

  @Get('entitlement/me')
  async getMyEntitlement(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspaceId: string | undefined,
  ) {
    return {
      code: 200,
      data: await this.billing.getMyEntitlement(user, workspaceId ?? null),
    };
  }

  @Public()
  @Post('webhooks/airwallex')
  async handleAirwallexWebhook(
    @Req() req: RawBodyRequest,
    @Headers('x-timestamp') timestamp?: string | string[],
    @Headers('x-signature') signature?: string | string[],
    @Headers('client-secret-key') testSecret?: string | string[],
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return {
      code: 200,
      data: await this.billing.handleAirwallexWebhook({
        rawBody,
        timestamp,
        signature,
        testSecret,
      }),
    };
  }

  /**
   * WeChat Pay APP支付 payment notification. Unlike the other routes this returns
   * WeChat's REQUIRED top-level body `{"code":"SUCCESS","message":"OK"}` verbatim
   * (there is no global envelope interceptor) — any other body / non-200 makes
   * WeChat retry for ~24h. A failed verify/decrypt throws (4xx) → WeChat retries,
   * which is the correct behaviour for a bad signature.
   */
  @Public()
  @Post('webhooks/wechat')
  @HttpCode(200)
  async handleWechatWebhook(
    @Req() req: RawBodyRequest,
    @Headers('wechatpay-serial') serial?: string | string[],
    @Headers('wechatpay-signature') signature?: string | string[],
    @Headers('wechatpay-timestamp') timestamp?: string | string[],
    @Headers('wechatpay-nonce') nonce?: string | string[],
    @Headers('wechatpay-signature-type') signatureType?: string | string[],
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    await this.billing.handleWechatWebhook({
      rawBody,
      serial: firstHeader(serial),
      signature: firstHeader(signature),
      timestamp: firstHeader(timestamp),
      nonce: firstHeader(nonce),
      signatureType: firstHeader(signatureType),
    });
    return { code: 'SUCCESS', message: 'OK' };
  }
}

function firstHeader(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the optional AppLovin (Axon) attribution for a checkout/recharge,
 * enriching the client-supplied `aleid` with the request's real client IP +
 * user-agent and the resolved country (the browser can't see its own public IP,
 * and a client-asserted one can't be trusted). Returns undefined when the client
 * signalled no AppLovin context, so non-attributed flows store nothing. Pure +
 * best-effort: only reads request headers, never throws.
 */
function resolveBillingAttribution(
  attribution: BillingAttributionInput | undefined,
  req: Request,
  country: CountryCode,
): BillingAttributionInput | undefined {
  if (!attribution) return undefined;
  const forwardedFor = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const aleid = attribution.aleid?.trim() || undefined;
  const clientIp =
    attribution.clientIp?.trim() ||
    forwardedFor ||
    req.ip ||
    req.socket.remoteAddress ||
    undefined;
  const clientUserAgent =
    attribution.clientUserAgent?.trim() ||
    req.header('user-agent') ||
    undefined;
  const countryCode = attribution.countryCode?.trim() || country || undefined;
  if (!aleid && !clientIp && !clientUserAgent && !countryCode) return undefined;
  return { aleid, clientUserAgent, clientIp, countryCode };
}
