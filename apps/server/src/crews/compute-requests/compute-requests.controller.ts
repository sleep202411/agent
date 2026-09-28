import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { parseIdParam } from '../../common/params';
import { CrewComputeRequestsService } from './compute-requests.service';
export const CreateComputeRequestSchema = z.object({
  taskId: z.string().uuid(),
  points: z.number().int().positive().max(2_000_000_000),
  reason: z.string().trim().min(1).max(2000),
  requestKey: z.string().uuid(),
});
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
  @Post(':requestId/decision')
  decide(
    @Param('crewId') crewId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DecideComputeRequestSchema))
    input: z.infer<typeof DecideComputeRequestSchema>,
  ) {
    return this.requests.decide(
      parseIdParam(crewId, 'crewId'),
      parseIdParam(requestId, 'requestId'),
      user.userId,
      input,
    );
  }
}
