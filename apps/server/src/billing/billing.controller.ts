import {
  Body,
  Controller,
  Get,
  Headers,
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
  CreateBillingCheckoutSchema,
  CreateComputePointTopupSchema,
  CreateCustomRechargeSchema,
  ListMembershipPlansQuerySchema,
  ListBillingPricesQuerySchema,
  ListWalletLedgerQuerySchema,
  type BillingOrderParams,
  type CreateBillingCheckoutInput,
  type CreateComputePointTopupInput,
  type CreateCustomRechargeInput,
  type ListMembershipPlansQuery,
  type ListBillingPricesQuery,
  type ListWalletLedgerQuery,
  RedeemVoucherSchema,
  type RedeemVoucherInput,
  CreditCampaignParamsSchema,
  type CreditCampaignParams,
} from './dto';
import { VoucherService } from './voucher.service';
import { CampaignService } from './campaign.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly vouchers: VoucherService,
    private readonly campaigns: CampaignService,
  ) {}

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

  @Post('checkout')
  async createCheckout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateBillingCheckoutSchema))
    body: CreateBillingCheckoutInput,
  ) {
    return {
      code: 200,
      data: await this.billing.createCheckout(user, body),
    };
  }

  @Post('recharge-custom')
  async createCustomRecharge(
    @CurrentUser() user: AuthUser,
    @Country() country: CountryCode,
    @Body(new ZodValidationPipe(CreateCustomRechargeSchema))
    body: CreateCustomRechargeInput,
  ) {
    return {
      code: 200,
      data: await this.billing.createCustomRecharge(user, body, country),
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
}
