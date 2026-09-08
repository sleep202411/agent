import { requiredEnv } from '../../common/required-env';
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

// Prisma's default transaction limits (maxWait 2s, timeout 5s) are too tight
// under prod load: a slow implicit/`include` or interactive transaction can
// exceed them and surface as "Transaction already closed: A rollback cannot be
// executed on a committed transaction" (e.g. the IP-discovery admin create
// 500). Give every transaction more headroom. (Root fix per prisma/prisma#22188;
// the @prisma/adapter-pg patch lands in 7.9 — bump when stable.)
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

function buildPrisma(): PrismaClient {
  const connectionString = requiredEnv('DATABASE_URL');
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter, transactionOptions: TRANSACTION_OPTIONS });
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
  const connectionString = requiredEnv('DATABASE_URL');
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return { adapter, transactionOptions: TRANSACTION_OPTIONS };
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
