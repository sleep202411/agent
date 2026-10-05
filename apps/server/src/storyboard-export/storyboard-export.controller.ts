import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  CreateStoryboardExport,
  StoryboardExportJobsService,
} from './storyboard-export-jobs.service';
import { StoryboardExportOutputService } from './storyboard-export-output.service';
const Params = z.strictObject({ id: z.uuid() });
const ListQuery = z.strictObject({ documentId: z.uuid() });
@Controller('storyboard-exports')
export class StoryboardExportController {
  constructor(
    private readonly jobs: StoryboardExportJobsService,
    private readonly outputs: StoryboardExportOutputService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ) {
    return {
      code: 200,
      data: await this.jobs.list(user.userId, query.documentId),
    };
  }
  @Post()
  @HttpCode(200)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStoryboardExport))
    body: z.infer<typeof CreateStoryboardExport>,
  ) {
    return { code: 200, data: await this.jobs.create(user.userId, body) };
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
  ) {
    return { code: 200, data: await this.jobs.get(user.userId, params.id) };
  }
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
  ) {
    return { code: 200, data: await this.jobs.cancel(user.userId, params.id) };
  }
  @Post(':id/download')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async download(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
  ) {
    return {
      code: 200,
      data: await this.outputs.download(user.userId, params.id),
    };
  }
}
