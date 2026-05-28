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
import { ZodValidationPipe } from '../common/zod.pipe';
import { BillingService } from './billing.service';
import {
  BillingOrderParamsSchema,
  CreateBillingCheckoutSchema,
  ListBillingPricesQuerySchema,
  type BillingOrderParams,
  type CreateBillingCheckoutInput,
  type ListBillingPricesQuery,
} from './dto';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('prices')
  async listPrices(
    @Query(new ZodValidationPipe(ListBillingPricesQuerySchema))
    query: ListBillingPricesQuery,
  ) {
    return { code: 200, data: await this.billing.listPrices(query) };
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
