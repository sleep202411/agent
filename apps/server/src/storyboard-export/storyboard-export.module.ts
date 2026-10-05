import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DocumentsModule } from '../documents/documents.module';
import { MediaModule } from '../media/media.module';
import { StorageModule } from '../infra/storage/storage.module';
import { StoryboardExportJobsService } from './storyboard-export-jobs.service';
import { StoryboardExportQueueService } from './storyboard-export-queue.service';
import { StoryboardExportOutputService } from './storyboard-export-output.service';
import { StoryboardExportWorkerService } from './storyboard-export-worker.service';
import { StoryboardExportController } from './storyboard-export.controller';
@Module({
  imports: [AuthModule, DocumentsModule, MediaModule, StorageModule],
  controllers: [StoryboardExportController],
  providers: [
    StoryboardExportJobsService,
    StoryboardExportQueueService,
    StoryboardExportOutputService,
    StoryboardExportWorkerService,
  ],
})
export class StoryboardExportModule {}
