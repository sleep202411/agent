import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CrewStudioWorkspaceService } from './studio-workspace.service';

/** Additive workspace endpoints; the existing project-link API stays available. */
@Controller('crews/:crewId')
export class CrewStudioWorkspaceController {
  constructor(private readonly workspaces: CrewStudioWorkspaceService) {}

  @Get('studio-workspace-options')
  options(@Param('crewId') id: string, @CurrentUser() user: AuthUser) {
    return this.workspaces.options(parseIdParam(id, 'crewId'), user.userId);
  }

  @Post('studio-workspace/initialize')
  initialize(@Param('crewId') id: string, @CurrentUser() user: AuthUser) {
    return this.workspaces.initialize(parseIdParam(id, 'crewId'), user.userId);
  }

  @Patch('studio-workspace')
  link(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(
      new ZodValidationPipe(
        z.object({ workspaceId: z.string().uuid().nullable() }).strict(),
      ),
    )
    input: { workspaceId: string | null },
  ) {
    return this.workspaces.link(
      parseIdParam(id, 'crewId'),
      user.userId,
      input.workspaceId,
    );
  }
}
