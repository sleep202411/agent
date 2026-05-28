import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
  IpReportParamsSchema,
  IpTitleParamsSchema,
  ListAdminIpTitlesQuerySchema,
  ResolveAdminIpReportSchema,
  UpdateAdminIpTitlePublicationSchema,
  type IpReportParams,
  type IpTitleParams,
  type ListAdminIpTitlesQuery,
  type ResolveAdminIpReportInput,
  type UpdateAdminIpTitlePublicationInput,
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
    @Query(new ZodValidationPipe(ListAdminIpTitlesQuerySchema))
    query: ListAdminIpTitlesQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getAdminOverview(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('titles')
  async listTitles(
    @Query(new ZodValidationPipe(ListAdminIpTitlesQuerySchema))
    query: ListAdminIpTitlesQuery,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.listAdminTitles(query),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  @Get('titles/:titleId')
  async getTitle(
    @Param(new ZodValidationPipe(IpTitleParamsSchema))
    params: IpTitleParams,
  ) {
    return {
      code: 200,
      data: await this.ipCommerce.getAdminTitle(params.titleId),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpPublish)
  @Patch('titles/:titleId/publication')
  async updatePublication(
    @CurrentAdmin() admin: AdminActor,
    @Param(new ZodValidationPipe(IpTitleParamsSchema))
    params: IpTitleParams,
    @Body(new ZodValidationPipe(UpdateAdminIpTitlePublicationSchema))
    body: UpdateAdminIpTitlePublicationInput,
    @Req() request: Request,
  ) {
    const data = await this.ipCommerce.updateAdminTitlePublication(
      adminToAuthUser(admin),
      params.titleId,
      body,
    );
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.ip.publish',
      resourceType: 'ip_title',
      resourceId: params.titleId,
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
