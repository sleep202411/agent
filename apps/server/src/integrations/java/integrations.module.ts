import { Module } from '@nestjs/common';
import { JavaUserLookupService } from './user-lookup.service';

/**
 * Java integrations live behind this module so Nest features that
 * proxy Java (user-lookup, future content sync, mail dispatch) all
 * get their adapters from one place. Keep adapters STATELESS — caches
 * live in their respective domain modules (users.module's
 * UsersService caches lookups, not this module).
 */
@Module({
  providers: [JavaUserLookupService],
  exports: [JavaUserLookupService],
})
export class JavaIntegrationsModule {}
