import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { buildPrisma } from '../../infra/db/db.module';
import { lockCrewAssetFolderNames } from '../assets/upload-lock';
import { CrewAgreementArchiveWorker } from './agreement-archive.worker';

const suite =
  process.env.DATABASE_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;
suite('Agreement archive publication PostgreSQL', () => {
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
  it.each([false, true])(
    'publishes only for the original claim after a folder wait (displaced=%s)',
    async (displaced) => {
      const crewId = randomUUID();
      const userId = `archive-${randomUUID()}`;
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Archive race',
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
      let publication: Promise<unknown> | undefined;
      try {
        const agreement = await db.crewAgreement.create({
          data: {
            crewId,
            memberUserId: userId,
            signerName: 'Fixture',
            signerEmail: 'fixture@example.invalid',
            title: 'Fixture agreement',
            createdByUserId: userId,
            status: 'signed',
          },
        });
        const lockedAt = new Date();
        const job = await db.crewAgreementArchiveJob.create({
          data: {
            agreementId: agreement.id,
            status: 'processing',
            lockedAt,
            lockedBy: `${hostname()}-${process.pid}`,
          },
          include: { agreement: true },
        });
        blocker = db.$transaction(
          async (tx) => {
            await lockCrewAssetFolderNames(tx, crewId, null);
            const [backend] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            blockerPid = backend.pid;
            entered();
            await held;
          },
          { timeout: 15000 },
        );
        await ready;
        const worker = new CrewAgreementArchiveWorker(
          db as never,
          {} as never,
          {} as never,
        ) as unknown as {
          persistArchive(
            value: unknown,
            signed: unknown,
            audit: unknown,
          ): Promise<void>;
        };
        const artifact = (kind: string) => ({
          kind,
          filename: `${kind}.pdf`,
          checksumSha256: 'a'.repeat(64),
          result: {
            provider: 's3_compatible',
            bucket: 'fixture',
            region: 'auto',
            storagePath: `${crewId}/${kind}.pdf`,
            bytes: 10,
          },
        });
        publication = worker
          .persistArchive(
            job,
            artifact('signed_document'),
            artifact('audit_trail'),
          )
          .then(
            () => ({ ok: true }),
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
        const replacement = new Date(lockedAt.getTime() + 1000);
        if (displaced)
          await db.crewAgreementArchiveJob.update({
            where: { id: job.id },
            data: { lockedAt: replacement },
          });
        release();
        await blocker;
        const result = await publication;
        const saved = await db.crewAgreement.findUniqueOrThrow({
          where: { id: agreement.id },
        });
        const savedJob = await db.crewAgreementArchiveJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        expect(await db.crewAssetNode.count({ where: { crewId } })).toBe(
          displaced ? 0 : 2,
        );
        expect(
          await db.mediaAsset.count({ where: { createdByUserId: userId } }),
        ).toBe(displaced ? 0 : 2);
        if (displaced) {
          expect(result).toMatchObject({
            error: {
              message: expect.stringContaining('archive lease lost') as unknown,
            },
          });
          expect(saved.assetNodeId).toBeNull();
          expect(saved.auditAssetNodeId).toBeNull();
          expect(savedJob.status).toBe('processing');
          expect(savedJob.lockedAt).toEqual(replacement);
        } else {
          expect(result).toEqual({ ok: true });
          expect(saved.assetNodeId).not.toBeNull();
          expect(saved.auditAssetNodeId).not.toBeNull();
          expect(savedJob.status).toBe('completed');
        }
      } finally {
        release();
        await Promise.allSettled([blocker, publication]);
        await db.crew.delete({ where: { id: crewId } });
        await db.mediaAsset.deleteMany({ where: { createdByUserId: userId } });
      }
    },
    20000,
  );
});
