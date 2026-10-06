import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  DiscoveryPreferenceUpdateSchema,
  type DiscoveryPreferenceUpdate,
} from '@repo/shared/discovery-preferences';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { DiscoveryPreferencesService } from './discovery-preferences.service';
@Controller('me/discovery-preferences')
export class DiscoveryPreferencesController {
  constructor(private readonly service: DiscoveryPreferencesService) {}
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user);
  }
  @Put()
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DiscoveryPreferenceUpdateSchema))
    input: DiscoveryPreferenceUpdate,
  ) {
    return this.service.update(user, input);
  }
}
