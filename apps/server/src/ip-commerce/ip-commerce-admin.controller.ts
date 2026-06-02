import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  AdminIpTaxonomyTermParamsSchema,
  AdminIpDiscoveryParamsSchema,
  CreateAdminIpTaxonomyTermSchema,
  CreateAdminIpDiscoverySchema,
  ListAdminIpDiscoveryQuerySchema,
  ReorderAdminIpDiscoverySchema,
  UpdateAdminIpDiscoverySchema,
  UploadAdminDiscoveryMediaQuerySchema,
  GrantAdminIpEntitlementSchema,
  IpEntitlementParamsSchema,
  IpReportParamsSchema,
  IpLocaleQuerySchema,
  IpParamsSchema,
  ListAdminIpEntitlementsQuerySchema,
  ListAdminIpsQuerySchema,
  ListAdminIpOrdersQuerySchema,
  ListAdminIpRevenueQuerySchema,
  ListIpTaxonomyTermsQuerySchema,
  RevokeAdminIpEntitlementSchema,
  ResolveAdminIpReportSchema,
  UpdateAdminIpTaxonomyTermSchema,
  UpdateAdminIpPublicationSchema,
  UpdateAdminIpRevenueConfigSchema,
  UpdateIpCommerceSettingSchema,
  IpCommerceSettingParamsSchema,
  IpOrderParamsSchema,
  type AdminIpTaxonomyTermParams,
  type AdminIpDiscoveryParams,
  type CreateAdminIpTaxonomyTermInput,
  type CreateAdminIpDiscoveryInput,
  type ListAdminIpDiscoveryQuery,
  type ReorderAdminIpDiscoveryInput,
  type UpdateAdminIpDiscoveryInput,
  type UploadAdminDiscoveryMediaQuery,
  type GrantAdminIpEntitlementInput,
  type IpEntitlementParams,
  type IpLocaleQuery,
  type IpReportParams,
  type IpParams,
  type ListAdminIpEntitlementsQuery,
  type ListAdminIpsQuery,
  type ListAdminIpOrdersQuery,
  type ListAdminIpRevenueQuery,
  type ListIpTaxonomyTermsQuery,
  type RevokeAdminIpEntitlementInput,
  type ResolveAdminIpReportInput,
  type UpdateAdminIpTaxonomyTermInput,
  type UpdateAdminIpPublicationInput,
  type UpdateAdminIpRevenueConfigInput,
  type UpdateIpCommerceSettingInput,
  type IpCommerceSettingParams,
  type IpOrderParams,
} from './dto';
import { IpCommerceService } from './ip-commerce.service';

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ip-commerce')
export class IpCommerceAdminController {
  constructor(
    private readonly ipCommerce: IpCommerceService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('overview')
  async overview(
    @Query(new ZodValidationPipe(ListAdminIpsQuerySchema))
    query: ListAdminIpsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getAdminOverview(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('ips')
  async listIps(
    @Query(new ZodValidationPipe(ListAdminIpsQuerySchema))
    query: ListAdminIpsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listAdminIps(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('orders')
  async listOrders(
    @Query(new ZodValidationPipe(ListAdminIpOrdersQuerySchema))
    query: ListAdminIpOrdersQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listAdminPurchaseOrders(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('entitlements')
  async listEntitlements(
    @Query(new ZodValidationPipe(ListAdminIpEntitlementsQuerySchema))
    query: ListAdminIpEntitlementsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listAdminEntitlements(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Post('entitlements/grants')
  async grantEntitlement(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(GrantAdminIpEntitlementSchema))
    body: GrantAdminIpEntitlementInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.grantAdminEntitlement(
      adminToAuthUser(admin),
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.entitlement.grant',
      resourceType: 'ip_entitlement',
      resourceId: data.entitlement.id,
      metadata: {
        ipId: body.ipId,
        episodeId: body.episodeId ?? null,
        userId: body.userId,
        targetType: body.targetType,
        reason: body.reason,
        alreadyGranted: data.alreadyGranted,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('taxonomy')
  async listTaxonomy(
    @Query(new ZodValidationPipe(ListIpTaxonomyTermsQuerySchema))
    query: ListIpTaxonomyTermsQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listAdminTaxonomyTerms(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Post('taxonomy')
  async createTaxonomyTerm(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminIpTaxonomyTermSchema))
    body: CreateAdminIpTaxonomyTermInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.createAdminTaxonomyTerm(
      adminToAuthUser(admin),
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.taxonomy.create',
      resourceType: 'ip_taxonomy_term',
      resourceId: data.term.id,
      metadata: {
        type: body.type,
        code: data.term.code,
        status: data.term.status,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Patch('taxonomy/:termId')
  async updateTaxonomyTerm(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminIpTaxonomyTermParamsSchema))
    params: AdminIpTaxonomyTermParams,
    @Body(new ZodValidationPipe(UpdateAdminIpTaxonomyTermSchema))
    body: UpdateAdminIpTaxonomyTermInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.updateAdminTaxonomyTerm(
      adminToAuthUser(admin),
      params.termId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.taxonomy.update',
      resourceType: 'ip_taxonomy_term',
      resourceId: params.termId,
      metadata: {
        status: body.status ?? null,
        displayOrder: body.displayOrder ?? null,
        localizationCount: body.localizations?.length ?? null,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('discovery')
  async listDiscovery(
    @Query(new ZodValidationPipe(ListAdminIpDiscoveryQuerySchema))
    query: ListAdminIpDiscoveryQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listAdminDiscovery(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Post('discovery')
  async createDiscovery(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(CreateAdminIpDiscoverySchema))
    body: CreateAdminIpDiscoveryInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.createAdminDiscovery(
      adminToAuthUser(admin),
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.discovery.create',
      resourceType: 'ip_discovery_recommendation',
      resourceId: data.recommendation.id,
      metadata: {
        placementKey: body.placementKey,
        ipId: body.ipId,
        status: data.recommendation.status,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Post('discovery/reorder')
  async reorderDiscovery(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(ReorderAdminIpDiscoverySchema))
    body: ReorderAdminIpDiscoveryInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.reorderAdminDiscovery(
      adminToAuthUser(admin),
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.discovery.reorder',
      resourceType: 'ip_discovery_recommendation',
      resourceId: body.placementKey,
      metadata: {
        placementKey: body.placementKey,
        count: body.orderedIds.length,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Patch('discovery/:recommendationId')
  async updateDiscovery(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(AdminIpDiscoveryParamsSchema))
    params: AdminIpDiscoveryParams,
    @Body(new ZodValidationPipe(UpdateAdminIpDiscoverySchema))
    body: UpdateAdminIpDiscoveryInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.updateAdminDiscovery(
      adminToAuthUser(admin),
      params.recommendationId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.discovery.update',
      resourceType: 'ip_discovery_recommendation',
      resourceId: params.recommendationId,
      metadata: {
        status: body.status ?? null,
        sortOrder: body.sortOrder ?? null,
        localizationCount: body.localizations?.length ?? null,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Post('discovery/media')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 256 * 1024 * 1024 } }),
  )
  async uploadDiscoveryMedia(
    @Query(new ZodValidationPipe(UploadAdminDiscoveryMediaQuerySchema))
    query: UploadAdminDiscoveryMediaQuery,
    @UploadedFile()
    file:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }
      | undefined,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.uploadAdminDiscoveryMedia(query.kind, file),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('ips/:ipId')
  async getIp(
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(IpLocaleQuerySchema))
    query: IpLocaleQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getAdminIp(params.ipId, query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Patch('entitlements/:entitlementId/revoke')
  async revokeEntitlement(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(IpEntitlementParamsSchema))
    params: IpEntitlementParams,
    @Body(new ZodValidationPipe(RevokeAdminIpEntitlementSchema))
    body: RevokeAdminIpEntitlementInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.revokeAdminEntitlement(
      adminToAuthUser(admin),
      params.entitlementId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.entitlement.revoke',
      resourceType: 'ip_entitlement',
      resourceId: params.entitlementId,
      metadata: {
        reason: body.reason,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpPublish)
  @Patch('ips/:ipId/publication')
  async updatePublication(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(UpdateAdminIpPublicationSchema))
    body: UpdateAdminIpPublicationInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.updateAdminIpPublication(
      adminToAuthUser(admin),
      params.ipId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.publish',
      resourceType: 'ip',
      resourceId: params.ipId,
      metadata: {
        status: body.status,
        listingVisibility: body.listingVisibility ?? null,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Patch('reports/:reportId')
  async resolveReport(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(IpReportParamsSchema))
    params: IpReportParams,
    @Body(new ZodValidationPipe(ResolveAdminIpReportSchema))
    body: ResolveAdminIpReportInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.resolveAdminReport(
      adminToAuthUser(admin),
      params.reportId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.report.resolve',
      resourceType: 'ip_report',
      resourceId: params.reportId,
      metadata: {
        status: body.status,
        actionType: body.actionType ?? null,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return {
      code: 200,
      data,
    };
  }

  // --- Creator revenue: platform settings + per-IP config + observability ----

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('settings')
  async getSettings() {
    return {
      code: 200,
      data: await this.ipCommerce.getAdminIpCommerceSettings(),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Patch('settings/:key')
  async updateSetting(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(IpCommerceSettingParamsSchema))
    params: IpCommerceSettingParams,
    @Body(new ZodValidationPipe(UpdateIpCommerceSettingSchema))
    body: UpdateIpCommerceSettingInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.updateAdminIpCommerceSetting(
      adminToAuthUser(admin),
      params.key,
      body.valueInt,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.revenue.settings',
      resourceType: 'ip_commerce_setting',
      resourceId: params.key,
      metadata: { valueInt: body.valueInt },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('ips/:ipId/revenue-config')
  async getRevenueConfig(
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Query(new ZodValidationPipe(IpLocaleQuerySchema))
    query: IpLocaleQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getAdminIpRevenueConfig(
        params.ipId,
        query.locale,
      ),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpModerate)
  @Patch('ips/:ipId/revenue-config')
  async updateRevenueConfig(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(IpParamsSchema))
    params: IpParams,
    @Body(new ZodValidationPipe(UpdateAdminIpRevenueConfigSchema))
    body: UpdateAdminIpRevenueConfigInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.updateAdminIpRevenueConfig(
      adminToAuthUser(admin),
      params.ipId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.revenue.config',
      resourceType: 'ip',
      resourceId: params.ipId,
      metadata: {
        creatorRevenueShareBps: body.creatorRevenueShareBps ?? null,
        contributorCount: body.contributors?.length ?? 0,
      },
      context: {
        ipAddress: request.ip,
        userAgent: headerValue(request.headers['user-agent']),
      },
    });
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('revenue/entries')
  async listRevenueEntries(
    @Query(new ZodValidationPipe(ListAdminIpRevenueQuerySchema))
    query: ListAdminIpRevenueQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listAdminRevenueEntries(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('orders/:orderId/revenue-breakdown')
  async getOrderRevenueBreakdown(
    @Param(new ZodValidationPipe(IpOrderParamsSchema))
    params: IpOrderParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getAdminOrderRevenueBreakdown(params.orderId),
    };
  }
}

function adminToAuthUser(admin: AdminActor): AuthUser {
  return {
    userId: admin.id,
    userName: admin.email,
    nickName: admin.displayName,
    email: admin.email,
    userLevel: 'ADMIN',
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}
