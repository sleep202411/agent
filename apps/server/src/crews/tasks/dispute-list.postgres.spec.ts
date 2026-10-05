import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewDisputeAttachmentsService } from './dispute-attachments';
import { CrewTaskDisputesService } from './task-disputes';
const url = process.env.DISPUTE_LIST_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Dispute lifecycle pagination (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      service: CrewTaskDisputesService,
      crewId: string,
      taskId: string;
    const alice = randomUUID(),
      bob = randomUUID();
    const ids: Record<string, string> = {};
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Owned audit fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      service = new CrewTaskDisputesService(
        db as never,
        { send: jest.fn() } as never,
      );
      crewId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Dispute fixture',
          description: 'Fixture',
          logo: 'fixture',
          createdByUserId: alice,
        },
      });
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Open',
          color: '#888888',
          semantic: 'open',
          createdByUserId: alice,
        },
      });
      const task = await db.crewTask.create({
        data: {
          crewId,
          number: 1,
          title: 'Fixture',
          workflowStateId: state.id,
          createdByUserId: alice,
        },
      });
      taskId = task.id;
      for (const [index, status] of [
        'open',
        'in_review',
        'appealed',
        'resolved',
      ].entries()) {
        ids[status] = randomUUID();
        await db.crewTaskDispute.create({
          data: {
            id: ids[status],
            taskId,
            title: status,
            status,
            ownerAdminId: ['resolved', 'in_review'].includes(status)
              ? randomUUID()
              : null,
            openedByUserId: index % 2 ? bob + index : alice,
            respondentUserId: index % 2 ? alice : bob + index,
            createdAt: new Date('2026-10-05T12:00:00Z'),
          },
        });
      }
      ids.foreign = randomUUID();
      await db.crewTaskDispute.create({
        data: {
          id: ids.foreign,
          taskId,
          title: 'Foreign',
          status: 'resolved',
          ownerAdminId: randomUUID(),
          openedByUserId: randomUUID(),
          respondentUserId: randomUUID(),
        },
      });
    });
    afterAll(async () => {
      try {
        if (db && taskId)
          await db.$transaction(async (tx) => {
            // This suite is allowlisted to the owned local audit database above.
            // Disable immutable-history triggers only inside this cleanup transaction.
            await tx.$executeRawUnsafe(
              'SET LOCAL session_replication_role = replica',
            );
            await tx.crewDisputeAttachment.deleteMany({
              where: { OR: [{ draftTaskId: taskId }, { dispute: { taskId } }] },
            });
            await tx.crewTaskDisputeEvent.deleteMany({
              where: { dispute: { taskId } },
            });
            await tx.crewTaskDispute.deleteMany({ where: { taskId } });
          });
        if (db && crewId) await db.crew.deleteMany({ where: { id: crewId } });
      } finally {
        await db?.$disconnect();
      }
    });
    it('paginates all active statuses without leaking unrelated or resolved cases', async () => {
      const found: string[] = [];
      let beforeId: string | undefined;
      do {
        const result = await service.list(
          { kind: 'user', id: alice },
          { limit: 1, lifecycle: 'active', beforeId },
        );
        found.push(...result.items.map((row) => row.id));
        beforeId = result.nextBeforeId ?? undefined;
      } while (beforeId);
      expect(found.sort()).toEqual(
        [ids.open, ids.in_review, ids.appealed].sort(),
      );
      expect(new Set(found).size).toBe(3);
    });
    it('combines archived status with participation and validates cursor scope', async () => {
      const actor = { kind: 'user' as const, id: alice };
      expect(
        (
          await service.list(actor, {
            limit: 20,
            lifecycle: 'archived',
            view: 'responses',
          })
        ).items.map((row) => row.id),
      ).toEqual([ids.resolved]);
      expect(
        (
          await service.list(actor, {
            limit: 20,
            lifecycle: 'archived',
            view: 'initiated',
          })
        ).items,
      ).toEqual([]);
      for (const beforeId of [ids.open, ids.foreign])
        await expect(
          service.list(actor, { limit: 20, lifecycle: 'archived', beforeId }),
        ).rejects.toThrow('cursor not found');
      expect(
        (await service.list(actor, { limit: 20, lifecycle: 'all' })).items,
      ).toHaveLength(4);
    });
    it('persists classification and requested outcome with immutable concurrent retries', async () => {
      await db.crewTask.update({
        where: { id: taskId },
        data: { approvedByUserId: bob },
      });
      const input = {
        id: randomUUID(),
        respondentUserId: bob,
        title: 'Payment disagreement',
        message: 'Please review the allocation',
        submissionIds: [],
        category: 'payment' as const,
        desiredResolution: 'payment_allocation' as const,
      };
      const rows = await Promise.all(
        Array.from({ length: 3 }, () => service.open(taskId, alice, input)),
      );
      expect(rows.every((row) => row.id === input.id)).toBe(true);
      expect(
        await db.crewTaskDisputeEvent.count({ where: { disputeId: input.id } }),
      ).toBe(1);
      expect(
        await db.crewTaskDispute.findUnique({ where: { id: input.id } }),
      ).toMatchObject({
        category: 'payment',
        desiredResolution: 'payment_allocation',
      });
      await expect(
        service.open(taskId, alice, { ...input, category: 'other' }),
      ).rejects.toThrow('different details');
      await expect(
        service.open(taskId, alice, { ...input, desiredResolution: 'warning' }),
      ).rejects.toThrow('different details');
      await expect(
        db.crewTaskDispute.update({
          where: { id: input.id },
          data: { category: 'invented' },
        }),
      ).rejects.toThrow();
      await expect(
        db.crewTaskDispute.update({
          where: { id: input.id },
          data: { desiredResolution: 'automatic_refund' },
        }),
      ).rejects.toThrow();
      expect(
        await db.crewTaskDispute.findUnique({ where: { id: ids.open } }),
      ).toMatchObject({ category: null, desiredResolution: null });
    });
    it('keeps initial evidence private until one atomic case submission binds it', async () => {
      const respondent = randomUUID(),
        caseId = randomUUID(),
        attachmentId = randomUUID();
      await db.crewTask.update({
        where: { id: taskId },
        data: { approvedByUserId: respondent },
      });
      const objects = new Map<
        string,
        { exists: boolean; sizeBytes: number; contentType: string }
      >();
      const upload = {
        name: 'initial.pdf',
        contentType: 'application/pdf' as const,
        sizeBytes: 123,
      };
      const sign = jest.fn(
        (input: { storageKey: string; contentType: string }) =>
          Promise.resolve({
            url: 'https://fixture.invalid/put',
            method: 'PUT',
            headers: { 'Content-Type': input.contentType },
            storageKey: input.storageKey,
            provider: 'aliyun_oss',
            bucket: 'private-fixture',
            region: 'ap-southeast-1',
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          }),
      );
      const attachments = new CrewDisputeAttachmentsService(
        db as never,
        service,
        { createPrivateUploadUrl: sign } as never,
        {
          forProvider: () => ({
            headStoredObject: (ref: { storageKey: string }) =>
              Promise.resolve(objects.get(ref.storageKey) ?? { exists: false }),
            promoteObject: (input: {
              source: { storageKey: string };
              destination: { storageKey: string };
            }) => {
              objects.set(
                input.destination.storageKey,
                objects.get(input.source.storageKey)!,
              );
              return Promise.resolve();
            },
            createReadUrl: () =>
              Promise.resolve({
                url: 'https://fixture.invalid/read',
              }),
          }),
        } as never,
      );
      await expect(
        attachments.issue(caseId, randomUUID(), 'outsider', upload, taskId),
      ).rejects.toThrow('participated');
      expect(sign).not.toHaveBeenCalled();
      const placement = await attachments.issue(
        caseId,
        attachmentId,
        alice,
        upload,
        taskId,
      );
      expect(
        await db.crewTaskDispute.findUnique({ where: { id: caseId } }),
      ).toBeNull();
      await expect(
        attachments.list(caseId, { kind: 'user', id: respondent }),
      ).rejects.toThrow('not found');
      await expect(
        attachments.confirm(caseId, attachmentId, respondent, taskId),
      ).rejects.toThrow('not found');
      await expect(
        attachments.confirm(caseId, attachmentId, alice, taskId),
      ).rejects.toThrow('expected size');
      objects.set(placement.storageKey, {
        exists: true,
        sizeBytes: 123,
        contentType: 'application/pdf',
      });
      await attachments.confirm(caseId, attachmentId, alice, taskId);
      await attachments.confirm(caseId, attachmentId, alice, taskId);
      const input = {
        id: caseId,
        respondentUserId: respondent,
        title: 'Initial evidence',
        message: 'Review the attachment',
        submissionIds: [],
        attachmentIds: [attachmentId],
        category: 'payment' as const,
      };
      await expect(
        service.open(taskId, alice, { ...input, id: randomUUID() }),
      ).rejects.toThrow('initial attachments');
      await expect(
        service.open(taskId, alice, {
          ...input,
          attachmentIds: Array.from({ length: 6 }, () => randomUUID()),
        }),
      ).rejects.toThrow();
      const rows = await Promise.all([
        service.open(taskId, alice, input),
        service.open(taskId, alice, input),
      ]);
      expect(rows[0].id).toBe(rows[1].id);
      expect(
        await db.crewTaskDisputeEvent.findMany({
          where: { disputeId: caseId },
        }),
      ).toEqual([expect.objectContaining({ attachmentIds: [attachmentId] })]);
      expect(
        await db.crewDisputeAttachment.findUnique({
          where: { id: attachmentId },
        }),
      ).toMatchObject({
        disputeId: caseId,
        draftTaskId: null,
        draftDisputeId: null,
      });
      expect(
        (await attachments.list(caseId, { kind: 'user', id: respondent }))
          .items,
      ).toEqual([
        expect.objectContaining({
          id: attachmentId,
          ready: true,
          shared: true,
        }),
      ]);
      await expect(
        attachments.read(caseId, attachmentId, {
          kind: 'user',
          id: 'outsider',
        }),
      ).rejects.toThrow('not found');
      await expect(
        attachments.issue(caseId, randomUUID(), alice, upload, taskId),
      ).rejects.toThrow('already been submitted');
    });
  },
);
