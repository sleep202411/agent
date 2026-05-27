import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces';
import { DocumentsController } from './documents.controller';
import { DocumentsGateway } from './documents.gateway';
import { DocumentsService } from './documents.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsGateway],
  exports: [DocumentsService],
})
export class DocumentsModule {}
