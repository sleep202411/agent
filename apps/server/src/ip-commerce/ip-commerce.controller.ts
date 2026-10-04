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
} from '@nestjs/common';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateIpDraftSchema,
  CreateCreatorIpContributorSchema,
  CreateCreatorIpEpisodeSchema,
  CreateIpContentReportSchema,
  ListMyContentReportsSchema,
  ListMyContentBlocksSchema,
  ContentBlockParamsSchema,
  type ContentBlockParams,
  type ListMyContentBlocksQuery,
  type ListMyContentReportsQuery,
  CreateIpPurchaseSchema,
  RecordMemberViewSchema,
  RecordIpViewSchema,
  CreatorRevenueQuerySchema,
  UpdateCreatorIpContributorSchema,
  UpdateCreatorIpProfileSchema,
  UpdateCreatorIpAssetsSchema,
  UpdateCreatorIpEpisodeSchema,
  GrantCreatorIpAclSchema,
  TransferIpOwnerSchema,
  SubmitCreatorIpReviewSchema,
  UploadCreatorIpMediaQuerySchema,
  UploadCreatorIpMediaBodySchema,
  IpAccessQuerySchema,
  IpAssetParamsSchema,
  IpAclGrantParamsSchema,
  IpContributorParamsSchema,
  IpEpisodeParamsSchema,
  IpLocaleQuerySchema,
  CreatorIpsParamsSchema,
  type CreatorIpsParams,
  TagIpsParamsSchema,
  type TagIpsParams,
  IpParamsSchema,
  IpReferenceParamsSchema,
  type IpReferenceParams,
  ListCreatorIpAssetsQuerySchema,
  ListCreatorIpsQuerySchema,
  ListIpTaxonomyTermsQuerySchema,
  ListPublicIpDiscoveryQuerySchema,
  ListIpsQuerySchema,
  RandomIpSeedsQuerySchema,
  UpsertCreatorIpPriceRuleSchema,
  UpsertIpCollectionItemSchema,
  UpsertIpUserBlockSchema,
  type CreateIpDraftInput,
  type CreateCreatorIpContributorInput,
  type CreateCreatorIpEpisodeInput,
  type GrantCreatorIpAclInput,
  type TransferIpOwnerInput,
  type CreateIpContentReportInput,
  type CreateIpPurchaseInput,
  type RecordMemberViewInput,
  type RecordIpViewInput,
  type CreatorRevenueQuery,
  type IpAssetParams,
  type IpAclGrantParams,
  type IpContributorParams,
  type SubmitCreatorIpReviewInput,
  type UploadCreatorIpMediaQuery,
  type UploadCreatorIpMediaInput,
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
  type RandomIpSeedsQuery,
  type UpsertCreatorIpPriceRuleInput,
  type UpsertIpCollectionItemInput,
  type UpsertIpUserBlockInput,
} from './dto';
import { IpCommerceService } from './ip-commerce.service';

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
    @CurrentUser() user: AuthUser | undefined,
    @Query(new ZodValidationPipe(ListPublicIpDiscoveryQuerySchema))
    query: ListPublicIpDiscoveryQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listPublicDiscovery(query, user),
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
    @Param(new ZodValidationPipe(IpReferenceParamsSchema))
    params: IpReferenceParams,
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

  @Get('users/search')
  async searchUsers(@CurrentUser() _user: AuthUser, @Query('q') q?: string) {
    return {
      code: 200,
      data: await this.ipCommerce.searchPlatformUsers(
        typeof q === 'string' ? q.slice(0, 64) : '',
      ),
    };
  }

  @Get('me/ips/:ipId/acl')
  async listMyIpAcl(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listCreatorIpAcl(user, params.ipId),
    };
  }

  @Post('me/ips/:ipId/acl')
  async grantMyIpAcl(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(GrantCreatorIpAclSchema))
    body: GrantCreatorIpAclInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.grantCreatorIpAcl(user, params.ipId, body),
    };
  }

  @Delete('me/ips/:ipId/acl/:grantId')
  async revokeMyIpAcl(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpAclGrantParamsSchema))
    params: IpAclGrantParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.revokeCreatorIpAcl(
        user,
        params.ipId,
        params.grantId,
      ),
    };
  }

  @Post('me/ips/:ipId/transfer-owner')
  async transferMyIpOwner(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(TransferIpOwnerSchema))
    body: TransferIpOwnerInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.transferCreatorIpOwnership(
        user,
        params.ipId,
        body,
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

  // Associates an already-confirmed MediaAsset (uploaded direct-to-storage
  // via /aurora/media/upload-url → PUT → /aurora/media/confirm) with the IP.
  // No file streams through the server, so large episode video/cover uploads
  // no longer hit the nginx body limit.
  @Post('me/ips/:ipId/media')
  async uploadMyIpMedia(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(UploadCreatorIpMediaQuerySchema))
    query: UploadCreatorIpMediaQuery,
    @Body(new ZodValidationPipe(UploadCreatorIpMediaBodySchema))
    body: UploadCreatorIpMediaInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.uploadCreatorIpMedia(
        user,
        params.ipId,
        query,
        body,
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

  /** Random public IPs, lean projection — story-studio inspiration seeds.
   *  Declared before `ips/:ipId` so `random` is not captured as an id. */
  @Public()
  @Get('ips/random')
  async randomIps(
    @Query(new ZodValidationPipe(RandomIpSeedsQuerySchema))
    query: RandomIpSeedsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.randomPublicIpSeeds(query),
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
  @Get('tags/:code/ips')
  async listTagIps(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(TagIpsParamsSchema))
    params: TagIpsParams,
    @Query(new ZodValidationPipe(ListCreatorIpsQuerySchema))
    query: ListCreatorIpsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listPublicTagIps(params.code, query, user),
    };
  }

  @Public()
  @Post('ips/:ipId/view')
  async recordIpView(
    @CurrentUser() user: AuthUser | undefined,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(RecordIpViewSchema))
    body: RecordIpViewInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.recordIpView(user, params.ipId, body),
    };
  }

  @Put('ips/:ipId/like')
  async likeIp(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.likeIp(user, params.ipId),
    };
  }

  @Delete('ips/:ipId/like')
  async unlikeIp(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.unlikeIp(user, params.ipId),
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
    @Param(new ZodValidationPipe(IpReferenceParamsSchema))
    params: IpReferenceParams,
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

  @Post('member-views')
  async recordMemberView(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RecordMemberViewSchema))
    body: RecordMemberViewInput,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.recordMemberView(user, body),
    };
  }

  @Get('me/reports')
  async myContentReports(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListMyContentReportsSchema))
    query: ListMyContentReportsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listMyContentReports(user, query),
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

  @Get('me/blocks')
  async myContentBlocks(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListMyContentBlocksSchema))
    query: ListMyContentBlocksQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listMyContentBlocks(user, query),
    };
  }

  @Delete('me/blocks/:blockId')
  async removeMyContentBlock(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ContentBlockParamsSchema))
    params: ContentBlockParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.removeMyContentBlock(user, params.blockId),
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
