import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces';
import { ProjectSectionsController } from './project-sections.controller';
import { ProjectSectionsService } from './project-sections.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [ProjectSectionsController],
  providers: [ProjectSectionsService],
  exports: [ProjectSectionsService],
})
export class ProjectSectionsModule {}
