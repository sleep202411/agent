import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateIpDraftSchema,
  CreateCreatorIpContributorSchema,
  CreateCreatorIpEpisodeSchema,
  CreateIpContentReportSchema,
  CreateIpPurchaseSchema,
  CreatorRevenueQuerySchema,
  UpdateCreatorIpContributorSchema,
  UpdateCreatorIpProfileSchema,
  UpdateCreatorIpAssetsSchema,
  UpdateCreatorIpEpisodeSchema,
  SubmitCreatorIpReviewSchema,
  UploadCreatorIpMediaQuerySchema,
  IpAccessQuerySchema,
  IpAssetParamsSchema,
  IpContributorParamsSchema,
  IpEpisodeParamsSchema,
  IpLocaleQuerySchema,
  CreatorIpsParamsSchema,
  type CreatorIpsParams,
  IpParamsSchema,
  ListCreatorIpAssetsQuerySchema,
  ListCreatorIpsQuerySchema,
  ListIpTaxonomyTermsQuerySchema,
  ListPublicIpDiscoveryQuerySchema,
  ListIpsQuerySchema,
  UpsertCreatorIpPriceRuleSchema,
  UpsertIpCollectionItemSchema,
  UpsertIpUserBlockSchema,
  type CreateIpDraftInput,
  type CreateCreatorIpContributorInput,
  type CreateCreatorIpEpisodeInput,
  type CreateIpContentReportInput,
  type CreateIpPurchaseInput,
  type CreatorRevenueQuery,
  type IpAssetParams,
  type IpContributorParams,
  type SubmitCreatorIpReviewInput,
  type UploadCreatorIpMediaQuery,
  type UpdateCreatorIpAssetsInput,
  type UpdateCreatorIpContributorInput,
  type UpdateCreatorIpEpisodeInput,
  type UpdateCreatorIpProfileInput,
  type IpAccessQuery,
  type IpEpisodeParams,
  type IpLocaleQuery,
  type IpParams,
  type ListCreatorIpAssetsQuery,
  type ListCreatorIpsQuery,
  type ListIpTaxonomyTermsQuery,
  type ListPublicIpDiscoveryQuery,
  type ListIpsQuery,
  type UpsertCreatorIpPriceRuleInput,
  type UpsertIpCollectionItemInput,
  type UpsertIpUserBlockInput,
} from './dto';
import { IpCommerceService } from './ip-commerce.service';

const IP_MEDIA_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

type UploadedIpMediaFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Controller('ip-commerce')
export class IpCommerceController {
  constructor(private readonly ipCommerce: IpCommerceService) {}

  @Public()
  @Get('taxonomy')
  async listTaxonomyTerms(
    @Query(new ZodValidationPipe(ListIpTaxonomyTermsQuerySchema))
    query: ListIpTaxonomyTermsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listTaxonomyTerms(query),
    };
  }

  @Public()
  @Get('discovery')
  async listDiscovery(
    @Query(new ZodValidationPipe(ListPublicIpDiscoveryQuerySchema))
    query: ListPublicIpDiscoveryQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listPublicDiscovery(query),
    };
  }

  @Get('me/ips')
  async listMyIps(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCreatorIpsQuerySchema))
    query: ListCreatorIpsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listCreatorIps(user, query),
    };
  }

  @Get('me/ips/:ipId')
  async getMyIp(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(IpLocaleQuerySchema))
    query: IpLocaleQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getCreatorIp(user, params.ipId, query),
    };
  }

  @Get('me/ips/:ipId/commerce')
  async getMyIpCommerce(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(IpLocaleQuerySchema))
    query: IpLocaleQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getCreatorIpCommerce(
        user,
        params.ipId,
        query,
      ),
    };
  }

  @Get('me/revenue')
  async getMyRevenue(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(CreatorRevenueQuerySchema))
    query: CreatorRevenueQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getCreatorRevenueSummary(user, query),
    };
  }

  @Post('ips')
  async createIp(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateIpDraftSchema))
    body: CreateIpDraftInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.createCreatorIp(user, body),
    };
  }

  @Put('me/ips/:ipId')
  async updateMyIp(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(UpdateCreatorIpProfileSchema))
    body: UpdateCreatorIpProfileInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.updateCreatorIpProfile(
        user,
        params.ipId,
        body,
      ),
    };
  }

  @Get('me/ips/:ipId/assets')
  async listMyIpAssets(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(ListCreatorIpAssetsQuerySchema))
    query: ListCreatorIpAssetsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listCreatorIpAssets(user, params.ipId, query),
    };
  }

  @Put('me/ips/:ipId/assets')
  async updateMyIpAssets(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(UpdateCreatorIpAssetsSchema))
    body: UpdateCreatorIpAssetsInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.updateCreatorIpAssets(
        user,
        params.ipId,
        body,
      ),
    };
  }

  @Post('me/ips/:ipId/media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IP_MEDIA_UPLOAD_MAX_BYTES },
    }),
  )
  async uploadMyIpMedia(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(UploadCreatorIpMediaQuerySchema))
    query: UploadCreatorIpMediaQuery,
    @UploadedFile() file: UploadedIpMediaFile | undefined,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.uploadCreatorIpMedia(
        user,
        params.ipId,
        query,
        file,
      ),
    };
  }

  @Delete('me/ips/:ipId/assets/:assetId')
  async deleteMyIpAsset(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpAssetParamsSchema))
    params: IpAssetParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.removeCreatorIpAsset(
        user,
        params.ipId,
        params.assetId,
      ),
    };
  }

  @Post('me/ips/:ipId/episodes')
  async createMyIpEpisode(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(CreateCreatorIpEpisodeSchema))
    body: CreateCreatorIpEpisodeInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.createCreatorIpEpisode(
        user,
        params.ipId,
        body,
      ),
    };
  }

  @Put('me/ips/:ipId/episodes/:episodeId')
  async updateMyIpEpisode(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpEpisodeParamsSchema))
    params: IpEpisodeParams,
    @Body(new ZodValidationPipe(UpdateCreatorIpEpisodeSchema))
    body: UpdateCreatorIpEpisodeInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.updateCreatorIpEpisode(
        user,
        params.ipId,
        params.episodeId,
        body,
      ),
    };
  }

  @Delete('me/ips/:ipId/episodes/:episodeId')
  async deleteMyIpEpisode(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpEpisodeParamsSchema))
    params: IpEpisodeParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.deleteCreatorIpEpisode(
        user,
        params.ipId,
        params.episodeId,
      ),
    };
  }

  @Put('me/ips/:ipId/price-rules')
  async upsertMyIpPriceRule(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(UpsertCreatorIpPriceRuleSchema))
    body: UpsertCreatorIpPriceRuleInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.upsertCreatorIpPriceRule(
        user,
        params.ipId,
        body,
      ),
    };
  }

  @Get('me/ips/:ipId/contributors')
  async listMyIpContributors(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listCreatorIpContributors(user, params.ipId),
    };
  }

  @Post('me/ips/:ipId/contributors')
  async createMyIpContributor(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(CreateCreatorIpContributorSchema))
    body: CreateCreatorIpContributorInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.createCreatorIpContributor(
        user,
        params.ipId,
        body,
      ),
    };
  }

  @Patch('me/ips/:ipId/contributors/:contributorId')
  async updateMyIpContributor(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpContributorParamsSchema))
    params: IpContributorParams,
    @Body(new ZodValidationPipe(UpdateCreatorIpContributorSchema))
    body: UpdateCreatorIpContributorInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.updateCreatorIpContributor(
        user,
        params.ipId,
        params.contributorId,
        body,
      ),
    };
  }

  @Delete('me/ips/:ipId/contributors/:contributorId')
  async deleteMyIpContributor(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpContributorParamsSchema))
    params: IpContributorParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.removeCreatorIpContributor(
        user,
        params.ipId,
        params.contributorId,
      ),
    };
  }

  @Post('me/ips/:ipId/review-submissions')
  async submitMyIpForReview(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(SubmitCreatorIpReviewSchema))
    body: SubmitCreatorIpReviewInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.submitCreatorIpForReview(
        user,
        params.ipId,
        body,
      ),
    };
  }

  @Public()
  @Get('ips')
  async listIps(
    @CurrentUser() user: AuthUser | undefined,
    @Query(new ZodValidationPipe(ListIpsQuerySchema))
    query: ListIpsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listPublicIps(query, user),
    };
  }

  @Public()
  @Get('creators/:creatorId/ips')
  async listCreatorPublicIps(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(CreatorIpsParamsSchema))
    params: CreatorIpsParams,
    @Query(new ZodValidationPipe(ListCreatorIpsQuerySchema))
    query: ListCreatorIpsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listPublicCreatorIps(
        params.creatorId,
        query,
        user,
      ),
    };
  }

  @Public()
  @Get('ips/:ipId/access')
  async getIpAccess(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(IpAccessQuerySchema))
    query: IpAccessQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getIpAccess(user, params.ipId, query),
    };
  }

  @Public()
  @Get('ips/:ipId')
  async getIp(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(IpLocaleQuerySchema))
    query: IpLocaleQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getPublicIp(params.ipId, user, query),
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
  async listMyCollection(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(IpLocaleQuerySchema))
    query: IpLocaleQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listUserCollection(user, query),
    };
  }

  @Post('me/collection')
  async saveCollectionItem(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpsertIpCollectionItemSchema))
    body: UpsertIpCollectionItemInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.saveCollectionItem(user, body),
    };
  }

  @Post('me/collection/remove')
  async removeCollectionItem(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpsertIpCollectionItemSchema))
    body: UpsertIpCollectionItemInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.removeCollectionItem(user, body),
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
