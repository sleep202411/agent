import { Module } from '@nestjs/common';
import { StorySavesController } from './story-saves.controller';
import { StorySavesService } from './story-saves.service';

// PrismaService comes from the global DbModule; no local imports needed.
@Module({
  controllers: [StorySavesController],
  providers: [StorySavesService],
  exports: [StorySavesService],
})
export class StorySavesModule {}
