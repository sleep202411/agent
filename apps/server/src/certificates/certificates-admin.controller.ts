import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  RequireAdminPermissions,
} from '../admin-auth';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CertificatesService } from './certificates.service';
import {
  AdminCertificateParamsSchema,
  CreateAdminCertificateSchema,
  ListAdminCertificatesQuerySchema,
  RevokeAdminCertificateSchema,
  UpdateAdminCertificateSchema,
  type AdminCertificateParams,
  type CreateAdminCertificateInput,
  type ListAdminCertificatesQuery,
  type RevokeAdminCertificateInput,
  type UpdateAdminCertificateInput,
} from './dto';

/**
 * Admin certificate management (后台「证书管理」).
 *
 * `@Public()` skips the end-user auth guard; access is gated instead by the
 * admin session + permission guards. Read requires `certificate.read`; every
 * mutating action requires `certificate.manage`.
 */
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/certificates')
export class CertificatesAdminController {
  constructor(private readonly certificates: CertificatesService) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CertificateRead)
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAdminCertificatesQuerySchema))
    query: ListAdminCertificatesQuery,
  ) {
    return { code: 200, data: await this.certificates.listAdmin(query) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CertificateManage)
  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 32 * 1024 * 1024 } }),
  )
  async uploadMedia(
    @UploadedFile()
    file:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }
      | undefined,
  ) {
    return { code: 200, data: await this.certificates.uploadAdminMedia(file) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CertificateManage)
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateAdminCertificateSchema))
    body: CreateAdminCertificateInput,
  ) {
    return { code: 200, data: await this.certificates.createAdmin(body) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CertificateManage)
  @Patch(':id')
  async update(
    @Param(new ZodValidationPipe(AdminCertificateParamsSchema))
    params: AdminCertificateParams,
    @Body(new ZodValidationPipe(UpdateAdminCertificateSchema))
    body: UpdateAdminCertificateInput,
  ) {
    return {
      code: 200,
      data: await this.certificates.updateAdmin(params.id, body),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CertificateManage)
  @Post(':id/revoke')
  async revoke(
    @Param(new ZodValidationPipe(AdminCertificateParamsSchema))
    params: AdminCertificateParams,
    @Body(new ZodValidationPipe(RevokeAdminCertificateSchema))
    body: RevokeAdminCertificateInput,
  ) {
    return {
      code: 200,
      data: await this.certificates.revokeAdmin(params.id, body.reason ?? null),
    };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CertificateManage)
  @Post(':id/restore')
  async restore(
    @Param(new ZodValidationPipe(AdminCertificateParamsSchema))
    params: AdminCertificateParams,
  ) {
    return { code: 200, data: await this.certificates.restoreAdmin(params.id) };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CertificateManage)
  @Delete(':id')
  async remove(
    @Param(new ZodValidationPipe(AdminCertificateParamsSchema))
    params: AdminCertificateParams,
  ) {
    return { code: 200, data: await this.certificates.deleteAdmin(params.id) };
  }
}
