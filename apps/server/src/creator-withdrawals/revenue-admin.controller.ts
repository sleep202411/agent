import {
  RevenueDraftsService,
  SaveRevenueDraft,
} from './revenue-drafts.service';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { SkipEndUserAuth } from '../auth';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  ADMIN_PERMISSION_KEYS,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { assertNewCrewCurrency } from '../crews/earnings/ledger-currency';
import {
  RevenueAdminReadService,
  RevenueCrewQuery,
  RevenueHistoryQuery,
  RevenuePageQuery,
  RevenueUuidPageQuery,
} from './revenue-admin-read.service';
import {
  RevenueContractsService,
  REVENUE_CONTRACT_MAX_BYTES,
  type RevenueContractFile,
} from './revenue-contracts.service';
import {
  PostRevenueDistribution,
  ReverseRevenueDistribution,
  RevenueDistributionService,
} from './revenue-distribution.service';
import {
  allocateConfirmedRevenue,
  ConfirmedRevenueAllocation,
} from './revenue-allocation';

const UploadFields = z.strictObject({
  crewId: z.string().trim().min(1).max(128),
});
@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CreatorRevenueManage)
@Controller('admin/creator-revenue')
export class RevenueAdminController {
  constructor(
    private readonly contracts: RevenueContractsService,
    private readonly distributions: RevenueDistributionService,
    private readonly read: RevenueAdminReadService,
    private readonly drafts: RevenueDraftsService,
  ) {}

  @Get('crews/:crewId/draft')
  @Header('Cache-Control', 'private, no-store')
  async draft(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId', new ZodValidationPipe(z.string().min(1).max(128)))
    crewId: string,
  ) {
    return { code: 200, data: await this.drafts.get(admin, crewId) };
  }
  @Post('crews/:crewId/draft')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async saveDraft(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId', new ZodValidationPipe(z.string().min(1).max(128)))
    crewId: string,
    @Body(new ZodValidationPipe(SaveRevenueDraft))
    input: z.infer<typeof SaveRevenueDraft>,
  ) {
    return { code: 200, data: await this.drafts.save(admin, crewId, input) };
  }

  @Get('crews')
  @Header('Cache-Control', 'private, no-store')
  async crews(
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(RevenueCrewQuery))
    query: z.infer<typeof RevenueCrewQuery>,
  ) {
    return { code: 200, data: await this.read.crews(admin, query) };
  }

  @Get('crews/:crewId/members')
  @Header('Cache-Control', 'private, no-store')
  async members(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId', new ZodValidationPipe(z.string().min(1).max(128)))
    crewId: string,
    @Query(new ZodValidationPipe(RevenuePageQuery))
    query: z.infer<typeof RevenuePageQuery>,
  ) {
    return { code: 200, data: await this.read.members(admin, crewId, query) };
  }

  @Get('crews/:crewId/contracts')
  @Header('Cache-Control', 'private, no-store')
  async savedContracts(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId', new ZodValidationPipe(z.string().min(1).max(128)))
    crewId: string,
    @Query(new ZodValidationPipe(RevenueUuidPageQuery))
    query: z.infer<typeof RevenueUuidPageQuery>,
  ) {
    return { code: 200, data: await this.read.contracts(admin, crewId, query) };
  }

  @Get('crews/:crewId/distributions')
  @Header('Cache-Control', 'private, no-store')
  async history(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId', new ZodValidationPipe(z.string().min(1).max(128)))
    crewId: string,
    @Query(new ZodValidationPipe(RevenueUuidPageQuery))
    query: z.infer<typeof RevenueUuidPageQuery>,
  ) {
    return {
      code: 200,
      data: await this.read.distributions(admin, crewId, query),
    };
  }

  @Post('contracts')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: REVENUE_CONTRACT_MAX_BYTES,
        files: 1,
        fields: 1,
        fieldSize: 256,
      },
    }),
  )
  async upload(
    @CurrentAdmin() admin: AdminActor,
    @UploadedFile() file: RevenueContractFile | undefined,
    @Body(new ZodValidationPipe(UploadFields))
    input: z.infer<typeof UploadFields>,
  ) {
    return {
      code: 200,
      data: await this.contracts.upload(admin, input.crewId, file),
    };
  }

  @Get('distributions')
  @Header('Cache-Control', 'private, no-store')
  async allHistory(
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(RevenueHistoryQuery))
    query: z.infer<typeof RevenueHistoryQuery>,
  ) {
    return { code: 200, data: await this.read.history(admin, query) };
  }

  @Get('distributions/:id')
  @Header('Cache-Control', 'private, no-store')
  async receipt(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return { code: 200, data: await this.read.distribution(admin, id) };
  }

  @Post('contracts/:id/download')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async download(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return { code: 200, data: await this.contracts.download(admin, id) };
  }

  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  preview(
    @Body(new ZodValidationPipe(ConfirmedRevenueAllocation))
    input: z.infer<typeof ConfirmedRevenueAllocation>,
  ) {
    assertNewCrewCurrency(input.currency);
    return { code: 200, data: allocateConfirmedRevenue(input) };
  }

  @Post('distributions')
  @Header('Cache-Control', 'private, no-store')
  async post(
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(PostRevenueDistribution))
    input: z.infer<typeof PostRevenueDistribution>,
  ) {
    return { code: 200, data: await this.distributions.post(admin, input) };
  }

  @Post('distributions/:id/reverse')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async reverse(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(ReverseRevenueDistribution))
    input: z.infer<typeof ReverseRevenueDistribution>,
  ) {
    return {
      code: 200,
      data: await this.distributions.reverse(admin, id, input),
    };
  }
}
