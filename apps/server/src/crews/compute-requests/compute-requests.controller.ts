import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { parseIdParam } from '../../common/params';
import { CrewComputeRequestsService } from './compute-requests.service';
export const CreateComputeRequestSchema = z
  .object({
    taskId: z.string().uuid(),
    beneficiaryUserId: z.string().trim().min(1).max(64).optional(),
    points: z.number().int().positive().max(3000),
    remainingWorkload: z
      .number()
      .positive()
      .max(999_999_999_999)
      .multipleOf(0.01),
    workloadUnit: z.enum([
      'minutes',
      'hours',
      'days',
      'person_days',
      'percent',
    ]),
    reason: z.string().trim().min(1).max(2000),
    requestKey: z.string().uuid(),
  })
  .refine(
    (value) =>
      value.workloadUnit !== 'percent' || value.remainingWorkload <= 100,
    { message: 'Remaining percentage cannot exceed 100' },
  );
export const DecideComputeRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(2000).default(''),
});
@Controller('crews/:crewId/compute-requests')
export class CrewComputeRequestsController {
  constructor(private readonly requests: CrewComputeRequestsService) {}
  @Get()
  list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(
      new ZodValidationPipe(z.object({ cursor: z.string().uuid().optional() })),
    )
    query: { cursor?: string },
  ) {
    return this.requests.list(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query.cursor,
    );
  }
  @Post('workspace')
  setupWorkspace(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.requests.setupWorkspace(
      parseIdParam(crewId, 'crewId'),
      user.userId,
    );
  }
  @Post()
  create(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateComputeRequestSchema))
    input: z.infer<typeof CreateComputeRequestSchema>,
  ) {
    return this.requests.create(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      input,
    );
  }
  // Explicitly reject old clients; Crew ownership never grants Admin authority.
  @Post(':requestId/decision')
  decide() {
    throw new ForbiddenException(
      'Compute requests can only be reviewed in Admin',
    );
  }
}
