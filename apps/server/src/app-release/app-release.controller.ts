import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth';
import { AppReleaseService } from './app-release.service';

/**
 * Version manifest for the mobile clients' update check. Region is implicit:
 * each cell (com / cn) announces its own build line, and the app only ever
 * talks to its region's aurora host.
 */
@Controller('app-releases')
export class AppReleaseController {
  constructor(private readonly service: AppReleaseService) {}

  @Public()
  @Get('latest')
  async latest(@Query('platform') platform?: string) {
    if (platform !== 'ios' && platform !== 'android') {
      throw new BadRequestException('platform must be ios or android');
    }
    const release = await this.service.latest(platform);
    return { code: 200, data: { release } };
  }
}
