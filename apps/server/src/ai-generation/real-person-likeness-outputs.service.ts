import { Injectable, Logger } from '@nestjs/common';
import { MediaAssetModerationStatus } from '@prisma/client';
import { MediaModerationAdminService } from '../media/media-moderation-admin.service';
import type {
  LikenessOutputItem,
  RealPersonLikenessOutputs,
} from '../characters/ports/real-person-likeness-outputs';
import { AiGenerationRepository } from './repository';

/**
 * Bridge implementing the {@link RealPersonLikenessOutputs} port (design v2
 * §6): lets a likeness subject SEE and TAKE DOWN the outputs generated from
 * their face. Lives in the generation module (which owns AiJob + imports the
 * media moderation service); the characters module consumes the port via
 * ModuleRef so it never imports either.
 */
@Injectable()
export class RealPersonLikenessOutputsService implements RealPersonLikenessOutputs {
  private readonly logger = new Logger(RealPersonLikenessOutputsService.name);

  constructor(
    private readonly store: AiGenerationRepository,
    private readonly moderation: MediaModerationAdminService,
  ) {}

  async listForCharacter(args: {
    characterId: string;
    projectId?: string;
  }): Promise<LikenessOutputItem[]> {
    const jobs = await this.store.referencingCharacterWithOutputs(
      args.characterId,
      { projectId: args.projectId },
    );
    return jobs.map((job) => ({
      jobId: job.id,
      projectId: job.projectId ?? null,
      status: job.status,
      createdAt: job.createdAt,
      outputs: job.outputs.map((o) => ({
        assetId: o.assetId ?? null,
        url: o.accessUrl ?? o.url ?? null,
        mimeType: o.mimeType ?? null,
        // The moderation state is not carried on the domain output; surfaced
        // as 'unknown' here — the studio reflects the block after refetch.
        moderationStatus: 'unknown',
      })),
    }));
  }

  async takedownForCharacter(args: {
    characterId: string;
    projectId?: string;
    jobId?: string;
    byUserId: string;
  }): Promise<number> {
    const jobs = await this.store.referencingCharacterWithOutputs(
      args.characterId,
      { projectId: args.projectId },
    );
    const targets = args.jobId ? jobs.filter((j) => j.id === args.jobId) : jobs;
    const assetIds = [
      ...new Set(
        targets
          .flatMap((j) => j.outputs.map((o) => o.assetId))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let blocked = 0;
    for (const assetId of assetIds) {
      try {
        await this.moderation.updateAssetModeration(
          assetId,
          // Subject-initiated takedown recorded as the actor on the moderation
          // action (not an admin) — the reason names the likeness withdrawal.
          `subject:${args.byUserId}`,
          {
            moderationStatus: MediaAssetModerationStatus.blocked,
            reason: 'real_person_likeness_takedown',
          },
        );
        blocked += 1;
      } catch (err) {
        this.logger.warn(
          `likeness takedown failed for asset ${assetId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return blocked;
  }
}
