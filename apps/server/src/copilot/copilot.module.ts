/**
 * Studio copilot module — fully decoupled from the StoryOS/Mastra assistant
 * stack (imports nothing from src/assistant). Auth is the global AuthGuard;
 * REDIS is a @Global provider, so no module imports are needed here.
 */
import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotStore } from './copilot.store';

@Module({
  controllers: [CopilotController],
  providers: [CopilotStore],
})
export class CopilotModule {}
