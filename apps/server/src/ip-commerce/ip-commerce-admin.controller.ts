import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
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
  CreateAdminIpTaxonomyTermSchema,
  GrantAdminIpEntitlementSchema,
  IpEntitlementParamsSchema,
  IpReportParamsSchema,
  IpLocaleQuerySchema,
  IpParamsSchema,
  ListAdminIpEntitlementsQuerySchema,
  ListAdminIpsQuerySchema,
  ListAdminIpOrdersQuerySchema,
  ListIpTaxonomyTermsQuerySchema,
  RevokeAdminIpEntitlementSchema,
  ResolveAdminIpReportSchema,
  UpdateAdminIpTaxonomyTermSchema,
  UpdateAdminIpPublicationSchema,
  type AdminIpTaxonomyTermParams,
  type CreateAdminIpTaxonomyTermInput,
  type GrantAdminIpEntitlementInput,
  type IpEntitlementParams,
  type IpLocaleQuery,
  type IpReportParams,
  type IpParams,
  type ListAdminIpEntitlementsQuery,
  type ListAdminIpsQuery,
  type ListAdminIpOrdersQuery,
  type ListIpTaxonomyTermsQuery,
  type RevokeAdminIpEntitlementInput,
  type ResolveAdminIpReportInput,
  type UpdateAdminIpTaxonomyTermInput,
  type UpdateAdminIpPublicationInput,
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
