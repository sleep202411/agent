import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { WorkspacesModule } from '../workspaces';
import { AiActorsService } from './ai-actors.service';
import {
  AiActorsController,
  AdminAiActorsController,
} from './ai-actors.controller';
@Module({
  imports: [AdminAuthModule, WorkspacesModule],
  controllers: [AiActorsController, AdminAiActorsController],
  providers: [AiActorsService],
})
export class AiActorsModule {}
