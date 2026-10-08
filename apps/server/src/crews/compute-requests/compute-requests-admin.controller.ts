import { ProjectBudgetService, BudgetAction } from './project-budget.service';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../../admin-auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { parseIdParam } from '../../common/params';
import { CrewComputeRequestsService } from './compute-requests.service';
import { DecideComputeRequestSchema } from './compute-requests.controller';

const QueueQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  cursor: z.string().uuid().optional(),
});

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewComputeReview)
@Controller('admin/crew-compute-requests')
export class CrewComputeRequestsAdminController {
  constructor(
    private readonly requests: CrewComputeRequestsService,
    private readonly budgets: ProjectBudgetService,
  ) {}

  @Get(':crewId/budget')
  async budget(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId') crewId: string,
  ) {
    return {
      code: 200,
      data: await this.budgets.detail(admin, parseIdParam(crewId, 'crewId')),
    };
  }
  @Post(':crewId/budget')
  async changeBudget(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId') crewId: string,
    @Body(new ZodValidationPipe(BudgetAction))
    input: z.infer<typeof BudgetAction>,
  ) {
    return {
      code: 200,
      data: await this.budgets.change(
        admin,
        parseIdParam(crewId, 'crewId'),
        input,
      ),
    };
  }

  @Get()
  async list(
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(QueueQuery)) query: z.infer<typeof QueueQuery>,
  ) {
    return { code: 200, data: await this.requests.listAdmin(admin, query) };
  }

  @Post(':crewId/:requestId/decision')
  async decide(
    @CurrentAdmin() admin: AdminActor,
    @Param('crewId') crewId: string,
    @Param('requestId', new ZodValidationPipe(z.string().uuid()))
    requestId: string,
    @Body(new ZodValidationPipe(DecideComputeRequestSchema))
    input: z.infer<typeof DecideComputeRequestSchema>,
  ) {
    return {
      code: 200,
      data: await this.requests.decideAdmin(
        parseIdParam(crewId, 'crewId'),
        parseIdParam(requestId, 'requestId'),
        admin,
        input,
      ),
    };
  }
}
