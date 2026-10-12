import type { Response } from 'express';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Query,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  StartStoryRunSchema,
  CreateStoryConversationSchema,
  UpdateStoryConversationSchema,
  ResumeStoryRunSchema,
  ChangeStoryVideoModelSchema,
  type ChangeStoryVideoModel,
  type StartStoryRun,
} from '@repo/app-story-protocol';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AppStoryAgentService } from './app-story-agent.service';
import type { CopilotDocumentUploadFile } from '../copilot/copilot-document.service';

const ProjectParams = z.object({ projectId: z.uuid() }).strict();
const RunParams = ProjectParams.extend({ runId: z.uuid() }).strict();
const ChapterParams = ProjectParams.extend({ chapterId: z.uuid() }).strict();
const EntryInput = z
  .object({
    entryId: z.uuid(),
    locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
    title: z.string().trim().min(1).max(160),
  })
  .strict();

@Controller('app-story-agent')
export class AppStoryEntryController {
  constructor(private readonly runs: AppStoryAgentService) {}
  @Post('entry')
  @HttpCode(200)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(EntryInput)) input: z.infer<typeof EntryInput>,
  ) {
    return { code: 200, data: await this.runs.createEntry(user, input) };
  }
}

@Controller('app-story-agent/projects/:projectId')
export class AppStoryAgentController {
  constructor(private readonly runs: AppStoryAgentService) {}
  @Get('runs/:runId/video-models')
  async videoModels(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(RunParams)) params: z.infer<typeof RunParams>,
  ) {
    return {
      code: 200,
      data: await this.runs.videoModels(user, params.projectId, params.runId),
    };
  }
  @Post('runs/:runId/video-model')
  @HttpCode(200)
  async changeVideoModel(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(RunParams)) params: z.infer<typeof RunParams>,
    @Body(new ZodValidationPipe(ChangeStoryVideoModelSchema))
    input: ChangeStoryVideoModel,
  ) {
    return {
      code: 200,
      data: await this.runs.changeVideoModel(
        user,
        params.projectId,
        params.runId,
        input,
      ),
    };
  }
  @Get('conversations')
  async conversations(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParams))
    params: z.infer<typeof ProjectParams>,
  ) {
    return {
      code: 200,
      data: await this.runs.conversations(user, params.projectId),
    };
  }
  @Post('conversations')
  @HttpCode(200)
  async createConversation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParams))
    params: z.infer<typeof ProjectParams>,
    @Body(new ZodValidationPipe(CreateStoryConversationSchema))
    input: z.infer<typeof CreateStoryConversationSchema>,
  ) {
    return {
      code: 200,
      data: await this.runs.createConversation(user, params.projectId, input),
    };
  }
  @Post('chapters/:chapterId/conversation')
  @HttpCode(200)
  async updateConversation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ChapterParams))
    params: z.infer<typeof ChapterParams>,
    @Body(new ZodValidationPipe(UpdateStoryConversationSchema))
    input: z.infer<typeof UpdateStoryConversationSchema>,
  ) {
    return {
      code: 200,
      data: await this.runs.updateConversation(
        user,
        params.projectId,
        params.chapterId,
        input,
      ),
    };
  }
  @Post('chapters/:chapterId/attachments')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async attach(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ChapterParams))
    params: z.infer<typeof ChapterParams>,
    @UploadedFile() file: CopilotDocumentUploadFile,
  ) {
    if (!file) throw new BadRequestException('A file is required.');
    return {
      code: 200,
      data: await this.runs.attach(
        user,
        params.projectId,
        params.chapterId,
        file,
      ),
    };
  }
  @Get('chapters/:chapterId/attachments/:id')
  async readAttachment(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ChapterParams.extend({ id: z.uuid() })))
    params: z.infer<typeof ChapterParams> & { id: string },
    @Res() response: Response,
  ) {
    const row = await this.runs.attachment(
      user,
      params.projectId,
      params.chapterId,
      params.id,
    );
    response.setHeader('content-type', row.mediaType);
    response.setHeader(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.send(Buffer.from(row.data));
  }
  @Post('documents')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParams))
    params: z.infer<typeof ProjectParams>,
    @Headers('x-submission-id') submissionId: string,
    @UploadedFile() file: CopilotDocumentUploadFile,
  ) {
    if (!file || !z.uuid().safeParse(submissionId).success)
      throw new BadRequestException('A file and submission ID are required.');
    return {
      code: 200,
      data: await this.runs.upload(user, params.projectId, submissionId, file),
    };
  }
  @Get('history')
  async history(
    @Query(
      new ZodValidationPipe(z.object({ cursor: z.uuid().optional() }).strict()),
    )
    query: { cursor?: string },
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParams))
    params: z.infer<typeof ProjectParams>,
  ) {
    return {
      code: 200,
      data: await this.runs.history(user, params.projectId, query.cursor),
    };
  }
  @Post('runs')
  @HttpCode(200)
  async start(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectParams))
    params: z.infer<typeof ProjectParams>,
    @Body(new ZodValidationPipe(StartStoryRunSchema)) input: StartStoryRun,
  ) {
    return {
      code: 200,
      data: await this.runs.start(user, params.projectId, input),
    };
  }
  @Get('chapters/:chapterId/outputs')
  async outputs(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ChapterParams))
    params: z.infer<typeof ChapterParams>,
    @Query(
      new ZodValidationPipe(z.object({ runId: z.uuid().optional() }).strict()),
    )
    query: { runId?: string },
  ) {
    return {
      code: 200,
      data: await this.runs.outputs(
        user,
        params.projectId,
        params.chapterId,
        query.runId,
      ),
    };
  }
  @Get('chapters/:chapterId/script')
  async script(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ChapterParams))
    params: z.infer<typeof ChapterParams>,
  ) {
    return {
      code: 200,
      data: await this.runs.script(user, params.projectId, params.chapterId),
    };
  }
  @Get('chapters/:chapterId/preview')
  async preview(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ChapterParams))
    params: z.infer<typeof ChapterParams>,
  ) {
    return {
      code: 200,
      data: await this.runs.workingPreview(
        user,
        params.projectId,
        params.chapterId,
      ),
    };
  }
  @Post('runs/:runId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(RunParams)) params: z.infer<typeof RunParams>,
  ) {
    return {
      code: 200,
      data: await this.runs.cancel(user, params.projectId, params.runId),
    };
  }
  @Post('runs/:runId/resume')
  @HttpCode(200)
  async resume(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(RunParams)) params: z.infer<typeof RunParams>,
    @Body(new ZodValidationPipe(ResumeStoryRunSchema))
    input: z.infer<typeof ResumeStoryRunSchema>,
  ) {
    return {
      code: 200,
      data: await this.runs.resume(
        user,
        params.projectId,
        params.runId,
        input.authorizedPoints,
        input.confirmedQuote,
        input.refreshQuote,
      ),
    };
  }
}
