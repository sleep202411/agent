import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { WorkspacesModule } from '../workspaces';
import { DocumentAutosaveService } from './document-autosave.service';
import { DocumentCompactionService } from './document-compaction.service';
import { DocumentsController } from './documents.controller';
import { DocumentsGateway } from './documents.gateway';
import { DocumentsService } from './documents.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsGateway,
    DocumentCompactionService,
    DocumentAutosaveService,
  ],
  exports: [DocumentsService, DocumentsGateway],
})
export class DocumentsModule {}
