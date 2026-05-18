/**
 * Database module — wires a single PrismaClient shared across the app.
 *
 * Prisma 7 requires a driver adapter; we use @prisma/adapter-pg backed
 * by a node-postgres Pool. The Pool is created here and lives the
 * lifetime of the Nest process — pg manages connection pooling
 * underneath; PrismaClient delegates queries to it.
 *
 * Lifecycle: Prisma's `$connect` is lazy (first query opens), but we
 * eagerly call `$disconnect` on shutdown so SIGTERM doesn't leak
 * sockets.
 */
import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

function buildPrisma(): PrismaClient {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor() {
    // We extend PrismaClient just to get the Injectable wrapper for
    // Nest DI. The real construction happens through the helper so
    // the adapter is wired identically wherever PrismaClient is
    // instantiated (tests, scripts, app).
    super(buildPrismaCtorArgs());
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

function buildPrismaCtorArgs(): ConstructorParameters<typeof PrismaClient>[0] {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return { adapter };
}

// Keep the standalone factory exported in case scripts/tests need a
// Prisma client without going through Nest DI.
export { buildPrisma };

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DbModule {}
