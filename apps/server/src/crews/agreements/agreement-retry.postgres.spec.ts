import { randomUUID } from 'node:crypto';
import { buildPrisma } from '../../infra/db/db.module';
import { CrewAgreementsService } from './agreements.service';

const suite =
  process.env.DATABASE_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;
suite('Agreement retry PostgreSQL admission', () => {
  let db: ReturnType<typeof buildPrisma>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '5433' ||
      url.pathname !== '/fizzdragon_outbox_test'
    )
      throw new Error('Use the isolated local test database.');
    db = buildPrisma();
    await db.$connect();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it.each([
    { archive: false, restarted: false, denyCommit: false },
    { archive: false, restarted: true, denyCommit: false },
    { archive: true, restarted: false, denyCommit: false },
    { archive: true, restarted: true, denyCommit: false },
    { archive: false, restarted: false, denyCommit: true },
    { archive: true, restarted: false, denyCommit: true },
  ])(
    'preserves a concurrent retry: %j',
    async ({ archive, restarted, denyCommit }) => {
      const crewId = randomUUID();
      const userId = `retry-${randomUUID()}`;
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Retry fixture',
          description: 'Fixture',
          logo: 'fixture.png',
          createdByUserId: userId,
        },
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let blockerPid = 0;
      let blocker: Promise<unknown> | undefined;
      let request: Promise<unknown> | undefined;
      try {
        const agreement = await db.crewAgreement.create({
          data: {
            crewId,
            memberUserId: userId,
            signerName: 'Fixture',
            signerEmail: 'fixture@example.invalid',
            title: 'Retry fixture',
            createdByUserId: userId,
            status: archive ? 'signed' : 'failed',
            providerDocumentId: archive ? randomUUID() : null,
          },
        });
        const data = {
          agreementId: agreement.id,
          status: 'failed' as const,
          attempt: 10,
          lastError: 'fixture failure',
        };
        if (archive) await db.crewAgreementArchiveJob.create({ data });
        else await db.crewAgreementSendJob.create({ data });
        const replacement = new Date();
        blocker = db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT id FROM crew_agreements WHERE id=${agreement.id}::uuid FOR UPDATE`;
            const [backend] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            blockerPid = backend.pid;
            entered();
            await held;
            if (restarted) {
              const update = {
                where: { agreementId: agreement.id },
                data: {
                  status: 'processing' as const,
                  lockedAt: replacement,
                  lockedBy: 'replacement',
                  attempt: 1,
                },
              };
              if (archive) await tx.crewAgreementArchiveJob.update(update);
              else await tx.crewAgreementSendJob.update(update);
            }
          },
          { timeout: 15000 },
        );
        await ready;
        // This suite isolates retry-state serialization. Authorization is supplied
        // as a fixture; commit denial verifies rollback, not membership resolution.
        let permissionChecks = 0;
        const service = new CrewAgreementsService(
          db as never,
          {
            require: () => {
              permissionChecks += 1;
              return denyCommit && permissionChecks === 3
                ? Promise.reject(
                    new Error('Permission withdrawn before commit'),
                  )
                : Promise.resolve({});
            },
          } as never,
          { isEnabled: () => true, isConfigured: () => true } as never,
          {} as never,
        );
        request = (
          archive
            ? service.retryArchive(agreement.id, userId)
            : service.retrySend(agreement.id, userId)
        ).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        let waiting = false;
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          const [state] = await db.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
            AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))) AS waiting
        `;
          if (state.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        release();
        await blocker;
        const outcome = await request;
        if (denyCommit)
          expect(outcome).toMatchObject({
            error: { message: 'Permission withdrawn before commit' },
          });
        else expect(outcome).toHaveProperty('value');
        const job = archive
          ? await db.crewAgreementArchiveJob.findUniqueOrThrow({
              where: { agreementId: agreement.id },
            })
          : await db.crewAgreementSendJob.findUniqueOrThrow({
              where: { agreementId: agreement.id },
            });
        expect(job.status).toBe(
          denyCommit ? 'failed' : restarted ? 'processing' : 'pending',
        );
        expect(job.attempt).toBe(denyCommit ? 10 : restarted ? 1 : 0);
        expect(job.lockedBy).toBe(restarted ? 'replacement' : null);
        expect(job.lockedAt).toEqual(restarted ? replacement : null);
        const saved = await db.crewAgreement.findUniqueOrThrow({
          where: { id: agreement.id },
        });
        expect(saved.status).toBe(
          archive ? 'signed' : restarted || denyCommit ? 'failed' : 'draft',
        );
      } finally {
        release();
        await Promise.allSettled([blocker, request]);
        await db.crew.delete({ where: { id: crewId } });
      }
    },
    20000,
  );
});
