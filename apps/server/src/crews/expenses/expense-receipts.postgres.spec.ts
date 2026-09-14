import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewExpenseDraftService, SaveExpenseDraft } from './expense-drafts';
import { CrewExpenseReceiptService } from './expense-receipts';
const url =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(url ? describe : describe.skip)('private expense receipts', () => {
  it('recovers finalization, isolates draft evidence, submits once and retains own reads after departure', async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !(
        (target.port === '55439' && target.pathname === '/task01') ||
        (target.port === '5433' &&
          target.pathname === '/fizzdragon_outbox_test')
      )
    )
      throw Error('Explicitly allowed loopback test database required');
    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
      transactionOptions: { timeout: 15000 },
    });
    const crew = randomUUID(),
      user = randomUUID(),
      draft = randomUUID(),
      receipt = randomUUID(),
      member = randomUUID();
    const objects = new Map<
      string,
      { exists: true; sizeBytes: number; contentType: string }
    >();
    let failAfterCopy = true;
    const storage = {
      createPrivateUploadUrl: jest.fn(
        (input: { storageKey: string; contentType: string }) =>
          Promise.resolve({
            url: 'https://fixture.invalid/put',
            method: 'PUT',
            headers: { 'Content-Type': input.contentType },
            storageKey: input.storageKey,
            bucket: 'private-receipts',
            region: null,
            provider: 's3_compatible',
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          }),
      ),
      headStoredObject: jest.fn((ref: { storageKey: string }) =>
        Promise.resolve(objects.get(ref.storageKey) ?? { exists: false }),
      ),
      promoteObject: jest.fn(
        (input: {
          source: { storageKey: string };
          destination: { storageKey: string };
        }) => {
          objects.set(
            input.destination.storageKey,
            objects.get(input.source.storageKey)!,
          );
          if (failAfterCopy) {
            failAfterCopy = false;
            return Promise.reject(Error('Copy response lost'));
          }
          return Promise.resolve();
        },
      ),
      createReadUrl: jest.fn(() =>
        Promise.resolve({
          url: 'https://fixture.invalid/read',
        }),
      ),
    };
    const authz = new CrewAuthorizationService(db as never);
    const receipts = new CrewExpenseReceiptService(
      db as never,
      authz,
      storage as never,
      { forProvider: () => storage } as never,
    );
    const drafts = new CrewExpenseDraftService(db as never, authz);
    const definition = SaveExpenseDraft.parse({
      expectedVersion: 0,
      definition: {
        category: 'Travel',
        purpose: 'Client meeting',
        occurredOn: '2026-09-13',
        currency: 'USD',
        amountMinor: '1234',
        evidenceNote: '',
      },
    });
    try {
      await db.crew.create({
        data: {
          id: crew,
          name: 'Receipt fixture',
          description: '',
          logo: 'fixture',
          createdByUserId: user,
        },
      });
      await db.crewMember.create({
        data: { id: member, crewId: crew, userId: user, joinedVia: 'creation' },
      });
      await drafts.save(crew, draft, user, definition);
      const input = {
        name: 'receipt.pdf',
        contentType: 'application/pdf' as const,
        sizeBytes: 12,
      };
      const issued = await receipts.issue(crew, draft, receipt, user, input);
      expect(await receipts.issue(crew, draft, receipt, user, input)).toEqual(
        issued,
      );
      expect(storage.createPrivateUploadUrl).toHaveBeenCalledTimes(1);
      objects.set(issued.storageKey, {
        exists: true,
        sizeBytes: 11,
        contentType: 'application/pdf',
      });
      await expect(
        receipts.confirm(crew, draft, receipt, user),
      ).rejects.toThrow('do not match');
      objects.set(issued.storageKey, {
        exists: true,
        sizeBytes: 12,
        contentType: 'application/pdf',
      });
      await expect(
        receipts.confirm(crew, draft, receipt, user),
      ).rejects.toThrow('Copy response lost');
      expect(
        await db.mediaAsset.count({ where: { createdByUserId: user } }),
      ).toBe(0);
      expect(
        await Promise.all([
          receipts.confirm(crew, draft, receipt, user),
          receipts.confirm(crew, draft, receipt, user),
        ]),
      ).toEqual([{ id: receipt }, { id: receipt }]);
      expect(
        await db.mediaAsset.count({
          where: { createdByUserId: user, visibility: 'private' },
        }),
      ).toBe(1);
      expect(storage.promoteObject).toHaveBeenCalledTimes(1);
      expect((await receipts.list(crew, draft, user)).items).toEqual([
        { id: receipt, name: 'receipt.pdf' },
      ]);
      expect((await receipts.list(crew, draft, randomUUID())).items).toEqual(
        [],
      );
      expect((await receipts.list(randomUUID(), draft, user)).items).toEqual(
        [],
      );

      await expect(
        receipts.read(draft, receipt, { submittedVersion: 1 }),
      ).rejects.toThrow('Receipt not found');
      await expect(
        receipts.read(draft, receipt, { userId: randomUUID(), crewId: crew }),
      ).rejects.toThrow('Receipt not found');
      await expect(
        drafts.save(crew, draft, user, {
          expectedVersion: 1,
          definition: { ...definition.definition, receiptIds: [randomUUID()] },
        }),
      ).rejects.toThrow('unavailable');
      await drafts.save(crew, draft, user, {
        expectedVersion: 1,
        definition: { ...definition.definition, receiptIds: [receipt] },
      });
      await expect(
        receipts.read(draft, receipt, { submittedVersion: 2 }),
      ).rejects.toThrow('Receipt not found');
      await drafts.submit(crew, draft, user, { expectedVersion: 2 });
      await expect(
        receipts.read(draft, receipt, { submittedVersion: 2 }),
      ).resolves.toBeDefined();
      expect(storage.createReadUrl).toHaveBeenLastCalledWith(
        expect.objectContaining({
          bucket: 'private-receipts',
          cacheControl: 'private, no-store',
          expiresInSeconds: 60,
        }),
      );
      await db.crewMember.update({
        where: { id: member },
        data: { status: 'removed', removedAt: new Date() },
      });
      await expect(
        receipts.read(draft, receipt, { userId: user, crewId: crew }),
      ).resolves.toBeDefined();
      await expect(
        receipts.issue(crew, draft, randomUUID(), user, input),
      ).rejects.toThrow('Active crew membership');
      await db.mediaAsset.updateMany({
        where: { createdByUserId: user },
        data: { moderationStatus: 'blocked' },
      });
      await expect(
        receipts.read(draft, receipt, { submittedVersion: 2 }),
      ).rejects.toThrow('unavailable');
    } finally {
      await db.$executeRaw`DELETE FROM crew_expense_submissions WHERE draft_id=${draft}::uuid`;
      await db.$executeRaw`DELETE FROM crew_expense_receipts WHERE draft_id=${draft}::uuid`;
      await db.$executeRaw`DELETE FROM crew_expense_draft_revisions WHERE id=${draft}::uuid`;
      await db.mediaAsset.deleteMany({ where: { createdByUserId: user } });
      await db.crew.deleteMany({ where: { id: crew } });
      await db.$disconnect();
    }
  });
});
