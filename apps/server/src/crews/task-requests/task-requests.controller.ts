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
import { CurrentUser, Public, type AuthUser } from '../../auth';
import {
  AdminAuthGuard,
  CurrentAdmin,
  type AdminActor,
} from '../../admin-auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { parseIdParam } from '../../common/params';
import { CrewTaskRequestsService } from './task-requests.service';

@Controller('crews/:crewId/task-requests')
export class CrewTaskRequestsController {
  constructor(private readonly requests: CrewTaskRequestsService) {}
  @Get()
  list(@Param('crewId') crewId: string, @CurrentUser() user: AuthUser) {
    return this.requests.list(parseIdParam(crewId, 'crewId'), user.userId);
  }
}
const Decision = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(2000).default(''),
  })
  .strict();
@Public()
@UseGuards(AdminAuthGuard)
@Controller('admin/crew-task-requests')
export class CrewTaskRequestsAdminController {
  constructor(private readonly requests: CrewTaskRequestsService) {}
  @Get()
  async list(
    @CurrentAdmin() admin: AdminActor,
    @Query('cursor', new ZodValidationPipe(z.string().uuid().optional()))
    cursor?: string,
  ) {
    return { code: 200, data: await this.requests.listAdmin(admin, cursor) };
  }
  @Post(':id/decision')
  async decide(
    @CurrentAdmin() admin: AdminActor,
    @Param('id', new ZodValidationPipe(z.string().uuid())) id: string,
    @Body(new ZodValidationPipe(Decision)) body: z.infer<typeof Decision>,
  ) {
    return {
      code: 200,
      data: await this.requests.decide(admin, id, body.decision, body.note),
    };
  }
}
