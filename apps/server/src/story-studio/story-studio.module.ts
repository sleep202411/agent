/**
 * Story Studio (文字游戏) — sovereign domain module.
 *
 * Owns story projects, drafts, and (second batch) releases + the publish
 * state machine. Deliberately does NOT import workspaces/sharing/documents:
 * a story project is not a PlatformProject and carries none of that
 * collaboration semantics (design doc docs/story-studio-project-schema-v1.md).
 */
import { Module } from '@nestjs/common';
import { StoryLlmClient } from './generation/llm-client';
import { StoryGenerationService } from './generation/story-generation.service';
import { StoryProjectsController } from './story-projects.controller';
import { StoryProjectsService } from './story-projects.service';

@Module({
  controllers: [StoryProjectsController],
  providers: [StoryProjectsService, StoryGenerationService, StoryLlmClient],
  exports: [StoryProjectsService],
})
export class StoryStudioModule {}
