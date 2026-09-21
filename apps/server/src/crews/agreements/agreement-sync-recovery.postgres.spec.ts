import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { workspaceTestDatabase } from '../production/__tests__/workspace-test-database';
import { CrewAgreementsService } from './agreements.service';
const url = workspaceTestDatabase(process.env);
(url ? describe : describe.skip)(
  'Agreement sync concurrency (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    beforeAll(() => {
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
    });
    afterAll(async () => {
      await db.$disconnect();
    });
    it.each(['signed', 'declined', 'expired', 'voided'] as const)(
      'preserves %s committed while the provider response is pending',
      async (status) => {
        const crewId = randomUUID(),
          userId = randomUUID();
        await db.crew.create({
          data: {
            id: crewId,
            name: 'Sync fixture',
            description: '',
            logo: 'fixture',
            createdByUserId: userId,
          },
        });
        let release!: (value: string) => void;
        let entered!: () => void;
        const ready = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const response = new Promise<string>((resolve) => {
          release = resolve;
        });
        const notifications = { send: jest.fn().mockResolvedValue({}) };
        const service = new CrewAgreementsService(
          db as never,
          {
            requireMembership: jest
              .fn()
              .mockResolvedValue({ permissions: ['agreements.manage'] }),
          } as never,
          {
            getDocumentStatus: jest.fn(() => {
              entered();
              return response;
            }),
          } as never,
          notifications as never,
        );
        let pending: Promise<unknown> | undefined;
        try {
          const agreement = await db.crewAgreement.create({
            data: {
              crewId,
              memberUserId: userId,
              signerName: 'Fixture',
              signerEmail: 'fixture@example.invalid',
              title: 'Sync fixture',
              createdByUserId: userId,
              status: 'sent',
              providerDocumentId: randomUUID(),
              providerStatus: 'Sent',
            },
          });
          pending = service.sync(agreement.id, userId);
          await ready;
          const eventAt = new Date('2026-09-21T01:00:00Z');
          await db.crewAgreement.update({
            where: { id: agreement.id },
            data: {
              status,
              providerStatus: status,
              lastProviderEventId: 'newer-event',
              lastProviderEventAt: eventAt,
              ...(status === 'signed' ? { signedAt: eventAt } : {}),
              ...(status === 'voided' ? { voidedAt: eventAt } : {}),
            },
          });
          release('Sent');
          await pending;
          expect(
            await db.crewAgreement.findUniqueOrThrow({
              where: { id: agreement.id },
            }),
          ).toMatchObject({
            status,
            providerStatus: status,
            lastProviderEventId: 'newer-event',
          });
          expect(notifications.send).not.toHaveBeenCalled();
        } finally {
          release('Sent');
          await pending?.catch(() => undefined);
          await db.crew.delete({ where: { id: crewId } });
        }
      },
    );
  },
);
