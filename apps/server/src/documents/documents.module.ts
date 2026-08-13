import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { WorkspacesModule } from '../workspaces';
import { StoryAccessModule } from '../story-studio/story-access.module';
import { DocumentAutosaveService } from './document-autosave.service';
import { DocumentCompactionService } from './document-compaction.service';
import { DocumentsController } from './documents.controller';
import { DocumentsGateway } from './documents.gateway';
import { DocumentsService } from './documents.service';
import { StudioDocumentAccessService } from './studio-document-access.service';
import { StudioDocumentStateService } from './studio-document-state.service';

@Module({
  imports: [AuthModule, WorkspacesModule, StoryAccessModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsGateway,
    DocumentCompactionService,
    DocumentAutosaveService,
    StudioDocumentAccessService,
    StudioDocumentStateService,
  ],
  exports: [DocumentsService, DocumentsGateway, StudioDocumentAccessService],
})
export class DocumentsModule {}
