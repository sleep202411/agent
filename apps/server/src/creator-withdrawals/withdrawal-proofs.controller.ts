import {
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser, SkipEndUserAuth, type AuthUser } from '../auth';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { WithdrawalProofsService } from './withdrawal-proofs.service';
import { WITHDRAWAL_MANAGE_PERMISSION } from './withdrawal-admin.service';
import { REVENUE_CONTRACT_MAX_BYTES } from './revenue-contract-file';

@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(WITHDRAWAL_MANAGE_PERMISSION)
@Controller('admin/creator-withdrawals/:id/proofs')
export class WithdrawalProofsController {
  constructor(private readonly proofs: WithdrawalProofsService) {}
  @Post()
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: REVENUE_CONTRACT_MAX_BYTES,
        files: 1,
        fields: 0,
        parts: 2,
      },
    }),
  )
  async upload(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    return { code: 200, data: await this.proofs.upload(admin, id, file) };
  }
  @Post(':proofId/download')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async download(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Param('proofId', new ZodValidationPipe(z.uuid())) proofId: string,
  ) {
    return { code: 200, data: await this.proofs.download(admin, id, proofId) };
  }
}

@Controller('me/withdrawals')
export class CreatorWithdrawalProofsController {
  constructor(private readonly proofs: WithdrawalProofsService) {}
  @Post(':id/payment-proof/download')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  download(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.proofs.downloadForCreator(user.userId, id);
  }
}
