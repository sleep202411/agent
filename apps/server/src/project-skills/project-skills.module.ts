import { Module } from '@nestjs/common';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { WorkspacesModule } from '../workspaces';
import { ProjectSkillsCatalogBootstrap } from './project-skills.catalog-bootstrap';
import { ProjectSkillsController } from './project-skills.controller';
import { ProjectSkillsResolver } from './project-skills.resolver';
import { ProjectSkillsService } from './project-skills.service';

@Module({
  imports: [WorkspacesModule, StoryAccessModule],
  controllers: [ProjectSkillsController],
  providers: [
    ProjectSkillsCatalogBootstrap,
    ProjectSkillsResolver,
    ProjectSkillsService,
  ],
  exports: [ProjectSkillsResolver, ProjectSkillsService],
})
export class ProjectSkillsModule {}
