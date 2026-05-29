import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateIpContentReportSchema,
  CreateIpPurchaseSchema,
  IpTitleAccessQuerySchema,
  IpTitleParamsSchema,
  ListIpTitlesQuerySchema,
  UpsertIpUserBlockSchema,
  type CreateIpContentReportInput,
  type CreateIpPurchaseInput,
  type IpTitleAccessQuery,
  type IpTitleParams,
  type ListIpTitlesQuery,
  type UpsertIpUserBlockInput,
} from './dto';
import { IpCommerceService } from './ip-commerce.service';

@Controller('ip-commerce')
export class IpCommerceController {
  constructor(private readonly ipCommerce: IpCommerceService) {}

  @Public()
  @Get('titles')
  async listTitles(
    @CurrentUser() user: AuthUser | undefined,
    @Query(new ZodValidationPipe(ListIpTitlesQuerySchema))
    query: ListIpTitlesQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listPublicTitles(query, user),
    };
  }

  @Public()
  @Get('titles/:titleId/access')
  async getTitleAccess(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(IpTitleParamsSchema))
    params: IpTitleParams,
    @Query(new ZodValidationPipe(IpTitleAccessQuerySchema))
    query: IpTitleAccessQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getTitleAccess(user, params.titleId, query),
    };
  }

  @Public()
  @Get('titles/:titleId')
  async getTitle(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(IpTitleParamsSchema))
    params: IpTitleParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getPublicTitle(params.titleId, user),
    };
  }

  @Get('wallet')
  async getWallet(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: await this.ipCommerce.getUserWallet(user),
    };
  }

  @Get('me/collection')
  async listMyCollection(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: await this.ipCommerce.listUserCollection(user),
    };
  }

  @Post('purchases')
  async purchase(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateIpPurchaseSchema))
    body: CreateIpPurchaseInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.purchaseContent(user, body),
    };
  }

  @Post('reports')
  async reportContent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateIpContentReportSchema))
    body: CreateIpContentReportInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.reportContent(user, body),
    };
  }

  @Post('blocks')
  async blockContent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpsertIpUserBlockSchema))
    body: UpsertIpUserBlockInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.blockContent(user, body),
    };
  }

  @Post('blocks/remove')
  async unblockContent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpsertIpUserBlockSchema))
    body: UpsertIpUserBlockInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.unblockContent(user, body),
    };
  }
}
