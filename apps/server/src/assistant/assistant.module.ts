import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, WorkspaceService],
})
export class AssistantModule {}
