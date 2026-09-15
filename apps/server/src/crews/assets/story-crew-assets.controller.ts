import { Controller, Get, Query, Param } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/db/db.module';
import { StoryPermissionService } from '../../story-studio/story-permission.service';
import { CrewAssetsService } from './assets.service';
import { ListCrewAssetsSchema, type ListCrewAssetsQuery } from './dto';

@Controller('story-projects/:projectId/crew-assets')
export class StoryCrewAssetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly assets: CrewAssetsService,
  ) {}

  private async crew(projectId: string, userId: string) {
    const { project } = await this.permissions.requireProject(
      userId,
      projectId,
      'story.read',
    );
    return this.prisma.crew.findFirst({
      where: { studioWorkspaceId: project.workspaceId, deletedAt: null },
      select: { id: true, name: true, logo: true },
    });
  }
  @Get('context')
  async context(@Param('projectId') id: string, @CurrentUser() user: AuthUser) {
    return {
      code: 200,
      data: {
        crew: await this.crew(parseIdParam(id, 'projectId'), user.userId),
      },
    };
  }
  @Get()
  async list(
    @Param('projectId') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewAssetsSchema))
    query: ListCrewAssetsQuery,
  ): Promise<{
    code: number;
    data: Awaited<ReturnType<CrewAssetsService['list']>>;
  }> {
    const crew = await this.crew(parseIdParam(id, 'projectId'), user.userId);
    return {
      code: 200,
      data: crew
        ? await this.assets.list(crew.id, user.userId, query, true)
        : { items: [], nextCursor: null, parentId: null, source: query.source },
    };
  }
}
