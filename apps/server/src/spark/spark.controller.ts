/**
 * `/aurora/spark/analyze` — multipart upload of a novel/script, returns
 * AI-proposed IP metadata. The Next.js rewrite strips `/aurora` so this
 * controller mounts at bare `spark`.
 *
 * Auth: relies on the global AuthGuard so anonymous users can't burn
 * Qwen tokens. The user identity isn't otherwise needed — Spark only
 * proposes; persistence happens via a separate /project/update call
 * the dialog issues after the user accepts.
 */

import {
  BadRequestException,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SparkDraft, SparkService, SparkUpload } from './spark.service';

const MAX_BYTES = 20 * 1024 * 1024;

@Controller('spark')
export class SparkController {
  private readonly logger = new Logger(SparkController.name);

  constructor(private readonly spark: SparkService) {}

  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BYTES },
    }),
  )
  async analyze(
    @UploadedFile() file: SparkUpload | undefined,
  ): Promise<{ code: number; data: SparkDraft }> {
    if (!file) {
      throw new BadRequestException('Missing "file" field in upload.');
    }
    try {
      const data = await this.spark.analyzeUpload(file);
      return { code: 200, data };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Spark analyze failed: ${msg}`);
      throw new HttpException(
        { code: 500, msg: msg || 'Spark analyze failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
