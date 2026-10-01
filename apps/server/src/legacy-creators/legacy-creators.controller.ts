import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
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
    @Query('availableForWork') availableForWork?: string,
  ) {
    if (
      availableForWork !== undefined &&
      availableForWork !== 'true' &&
      availableForWork !== 'false'
    ) {
      throw new BadRequestException('availableForWork must be true or false');
    }
    const data = await this.service.listCreators({
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
      authenticated: !!user,
      availableForWork: availableForWork === 'true',
    });
    return { code: 200, data };
  }
}
