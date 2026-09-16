import { Module } from '@nestjs/common';
import { BytePlusAssetsModule } from '../ai-generation/providers/byteplus/assets/byteplus-assets.module';
import { AuthModule } from '../auth';
import { StorageModule } from '../infra/storage/storage.module';
import { WorkspacesModule } from '../workspaces';
import { CharacterCastingService } from './character-casting.service';
import { CharacterEnrollmentService } from './character-enrollment.service';
import { CharacterGenerationService } from './character-generation.service';
import { CharacterGrantService } from './character-grant.service';
import { CharactersConfigService } from './characters-config.service';
import {
  CharacterCastingController,
  CharactersController,
  ProjectCastController,
} from './characters.controller';
import { CharactersService } from './characters.service';

/**
 * Character library (角色库) — workspace-owned reusable generation subjects
 * (演员池) plus per-project cast visibility (演员表). Includes gated
 * real-person enrollment, consent withdrawal and provider teardown.
 *
 * PrismaService comes from the global DbModule; AuthModule supplies the
 * identity the global AuthGuard attaches; WorkspacesModule exports the
 * WorkspacePermissionService all authorization goes through.
 *
 * CharactersService is exported so the generation path (ai-generation) can
 * expand character reference bindings without re-implementing library rules.
 */
@Module({
  // No import of AiGenerationModule (that would cycle — it imports us for
  // reference expansion). CharacterGrantService resolves the
  // REAL_PERSON_JOB_CANCELLER port lazily via ModuleRef instead.
  imports: [AuthModule, WorkspacesModule, StorageModule, BytePlusAssetsModule],
  controllers: [
    CharactersController,
    ProjectCastController,
    CharacterCastingController,
  ],
  providers: [
    CharactersService,
    CharacterGenerationService,
    CharacterEnrollmentService,
    CharacterGrantService,
    CharacterCastingService,
    CharactersConfigService,
  ],
  exports: [
    CharactersService,
    CharacterGenerationService,
    CharacterEnrollmentService,
    CharacterGrantService,
    CharactersConfigService,
  ],
})
export class CharactersModule {}
