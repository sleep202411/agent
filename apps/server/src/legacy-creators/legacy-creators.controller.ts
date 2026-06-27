import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { LegacyCreatorsService } from './legacy-creators.service';

/**
 * GET /aurora/creators — public creators directory backed by the legacy
 * `client_user` bridge. @Public so guests can browse; the optional viewer
 * still rides along (when a valid token is present) to lift the 50-row cap.
 */
@Controller('creators')
export class LegacyCreatorsController {
  constructor(private readonly service: LegacyCreatorsService) {}

  @Public()
  @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const data = await this.service.listCreators({
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
      authenticated: !!user,
    });
    return { code: 200, data };
  }
}
