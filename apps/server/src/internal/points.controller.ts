import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { InternalPointsService } from './internal-points.service';

/**
 * User-facing points reads — default satoken auth (NOT the service token used by
 * the machine-facing InternalPointsController). Lets apps/web decide where its
 * FizzStudio entry should send the user: the new studio domain once they have
 * been migrated onto the PG compute_point wallet, otherwise the legacy art-studio.
 */
@Controller('points')
export class PointsController {
  constructor(private readonly points: InternalPointsService) {}

  @Get('migration-status')
  async migrationStatus(
    @CurrentUser() user: AuthUser,
  ): Promise<{ migrated: boolean }> {
    return { migrated: await this.points.isMigrated(user.userId) };
  }
}
