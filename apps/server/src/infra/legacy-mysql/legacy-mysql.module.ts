/**
 * LegacyMysqlModule — wires the legacy Java MySQL bridge.
 *
 * Deliberately NOT `@Global` (unlike `DbModule`, which is global because
 * the primary Postgres store is used everywhere). The legacy bridge is
 * a contained, low-trust side channel: a feature module that needs it
 * imports this module explicitly. That friction is the point — it keeps
 * "who reaches into the legacy DB" greppable and small, instead of
 * letting raw legacy SQL sprout anywhere a service can inject a global.
 *
 * Plain `@Module` (no dynamic `forRoot`/`forRootAsync`): there is one
 * instance, configured from env via `LegacyMysqlConfigService`, so the
 * dynamic-module ceremony from the NestJS database docs would add
 * indirection without buying anything. Match the codebase's existing
 * infra modules instead.
 */
import { Module } from '@nestjs/common';
import { LegacyMysqlConfigService } from './legacy-mysql.config';
import { LegacyMysqlService } from './legacy-mysql.service';

@Module({
  providers: [LegacyMysqlConfigService, LegacyMysqlService],
  exports: [LegacyMysqlService],
})
export class LegacyMysqlModule {}
