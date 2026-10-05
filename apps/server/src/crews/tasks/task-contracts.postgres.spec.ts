import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewAssetAccessService } from '../assets/asset-access.service';
import { CrewTaskContractsService } from './task-contracts';
import { requireNoTaskContractReferences } from '../assets/task-contract-retention';
const url = process.env.TASK_CONTRACTS_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Immutable grouped task contracts (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      service: CrewTaskContractsService,
      taskId: string,
      stateId: string;
    const crewId = randomUUID(),
      owner = randomUUID(),
      member = randomUUID(),
      mediaIds: string[] = [];
    const read = jest.fn().mockResolvedValue({
      url: 'https://fixture.invalid/read',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      const auth = new CrewAuthorizationService(db as never),
        access = new CrewAssetAccessService(db as never, auth);
      service = new CrewTaskContractsService(db as never, auth, access, {
        forProvider: () => ({ createReadUrl: read }),
      } as never);
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Contract fixture',
          description: '',
          logo: 'fixture',
          createdByUserId: owner,
        },
      });
      const leader = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: owner,
          joinedVia: 'invitation',
        },
      });
      await db.crewOwnership.create({ data: { crewId, memberId: leader.id } });
      await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: member,
          joinedVia: 'invitation',
        },
      });
      stateId = (
        await db.crewTaskWorkflowState.create({
          data: {
            crewId,
            name: 'Open',
            color: '#888888',
            semantic: 'open',
            createdByUserId: owner,
          },
        })
      ).id;
      taskId = (
        await db.crewTask.create({
          data: {
            crewId,
            number: 1,
            title: 'Contract task',
            workflowStateId: stateId,
            createdByUserId: owner,
          },
        })
      ).id;
    });
    afterAll(async () => {
      try {
        if (db) {
          await db.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              'SET LOCAL session_replication_role = replica',
            );
            await tx.crewTaskContractFile.deleteMany({
              where: { task: { crewId } },
            });
          });
          await db.crew.deleteMany({ where: { id: crewId } });
          await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } });
        }
      } finally {
        await db?.$disconnect();
      }
    });
    async function file(name: string, restricted = false) {
      const media = await db.mediaAsset.create({
        data: {
          kind: 'document',
          status: 'ready',
          storageProvider: 'aliyun_oss',
          bucket: 'private-fixture',
          objectKey: randomUUID(),
          contentType: 'application/pdf',
          sizeBytes: 123n,
        },
      });
      mediaIds.push(media.id);
      return db.crewAssetNode.create({
        data: {
          crewId,
          kind: 'file',
          name,
          mediaAssetId: media.id,
          accessMode: restricted ? 'restricted' : 'inherit',
          createdByUserId: owner,
          updatedByUserId: owner,
        },
      });
    }
    it('appends multiple immutable files, deduplicates concurrent retries and protects addenda', async () => {
      const original = await file('Original.pdf'),
        addendum = await file('Addendum.pdf');
      const ids = await Promise.all([
        service.attach(taskId, owner, original.id),
        service.attach(taskId, owner, original.id),
        service.attach(taskId, owner, addendum.id),
      ]);
      expect(ids[0]).toEqual(ids[1]);
      expect(
        (await service.forTask(taskId, owner)).items.map((x) => x.name).sort(),
      ).toEqual(['Addendum.pdf', 'Original.pdf']);
      await expect(
        db.crewTaskContractFile.delete({ where: { id: ids[2].id } }),
      ).rejects.toThrow('immutable');
      await expect(
        db.crewAssetNode.update({
          where: { id: addendum.id },
          data: { name: 'Changed.pdf' },
        }),
      ).rejects.toThrow('read-only');
      await expect(
        db.crewAssetNode.update({
          where: { id: addendum.id },
          data: { mediaAssetId: original.mediaAssetId },
        }),
      ).rejects.toThrow('read-only');
      await expect(
        db.crewTaskContractFile.update({
          where: { id: ids[2].id },
          data: { assetNodeId: original.id },
        }),
      ).rejects.toThrow('immutable');
      await expect(
        db.$transaction((tx) =>
          requireNoTaskContractReferences(tx, crewId, [addendum.id]),
        ),
      ).rejects.toMatchObject({
        response: { code: 'CREW_TASK_CONTRACT_LOCKED' },
      });
      await expect(
        service.attach(taskId, 'outsider', original.id),
      ).rejects.toThrow();
    });
    it('includes archived task files without reopening editing or bypassing file ACLs', async () => {
      const privateFile = await file('Private.pdf', true);
      const privateLink = await service.attach(taskId, owner, privateFile.id);
      await db.crewTask.update({
        where: { id: taskId },
        data: { deletedAt: new Date() },
      });
      const own = await service.list(owner, {
        limit: 20,
        lifecycle: 'archived',
      });
      expect(own.items).toEqual([
        expect.objectContaining({
          id: taskId,
          archived: true,
          files: expect.arrayContaining([
            expect.objectContaining({ name: 'Private.pdf' }),
          ]) as unknown,
        }),
      ]);
      expect(
        (await service.list(owner, { limit: 20, lifecycle: 'active' })).items,
      ).toEqual([]);
      const visible = await service.forTask(taskId, member);
      expect(visible.items.map((x) => x.name).sort()).toEqual([
        'Addendum.pdf',
        'Original.pdf',
      ]);
      await expect(service.download(privateLink.id, member)).rejects.toThrow();
      expect(read).not.toHaveBeenCalled();
      expect(await service.download(privateLink.id, owner)).toMatchObject({
        url: 'https://fixture.invalid/read',
      });
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'Private.pdf',
          cacheControl: 'private, no-store',
          expiresInSeconds: 60,
        }),
      );
      await expect(
        service.attach(taskId, owner, (await file('Late.pdf')).id),
      ).rejects.toThrow('Active task');
      await expect(
        service.list(owner, { limit: 1, lifecycle: 'active', cursor: taskId }),
      ).rejects.toThrow('cursor');
      await expect(
        service.download(privateLink.id, 'outsider'),
      ).rejects.toThrow();
    });
    it('paginates grouped tasks and rejects cursor replay after membership revocation', async () => {
      const task = await db.crewTask.create({
        data: {
          crewId,
          number: 2,
          title: 'Next task',
          workflowStateId: stateId,
          createdByUserId: owner,
        },
      });
      await service.attach(task.id, owner, (await file('Next.pdf')).id);
      const first = await service.list(member, { limit: 1, lifecycle: 'all' });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeTruthy();
      const second = await service.list(member, {
        limit: 1,
        lifecycle: 'all',
        cursor: first.nextCursor!,
      });
      expect(second.items).toHaveLength(1);
      expect(
        new Set([...first.items, ...second.items].map((x) => x.id)).size,
      ).toBe(2);
      await db.crewMember.updateMany({
        where: { crewId, userId: member },
        data: { status: 'removed', removedAt: new Date() },
      });
      expect(
        (await service.list(member, { limit: 20, lifecycle: 'all' })).items,
      ).toEqual([]);
      await expect(
        service.list(member, {
          limit: 1,
          lifecycle: 'all',
          cursor: first.nextCursor!,
        }),
      ).rejects.toThrow('cursor');
    });
    it('retains primary attachments from older writers and allows only recovery from trash', async () => {
      const node = await file('Recovered.pdf');
      await db.crewAssetNode.update({
        where: { id: node.id },
        data: {
          status: 'trashed',
          trashedAt: new Date(),
          trashedByUserId: owner,
        },
      });
      const task = await db.crewTask.create({
        data: {
          crewId,
          number: 3,
          title: 'Recovered contract',
          workflowStateId: stateId,
          createdByUserId: owner,
          metadata: { contractAssetNodeId: node.id },
        },
      });
      const attachment = await db.crewTaskContractFile.findUniqueOrThrow({
        where: {
          taskId_assetNodeId: { taskId: task.id, assetNodeId: node.id },
        },
      });
      expect(attachment.attachedByUserId).toBe(owner);
      await expect(
        db.crewAssetNode.update({
          where: { id: node.id },
          data: { name: 'Different.pdf' },
        }),
      ).rejects.toThrow('read-only');
      await db.crewAssetNode.update({
        where: { id: node.id },
        data: { status: 'active', trashedAt: null, trashedByUserId: null },
      });
      expect((await service.forTask(task.id, owner)).items).toEqual([
        expect.objectContaining({ name: 'Recovered.pdf', available: true }),
      ]);
      await expect(
        db.crewAssetNode.update({
          where: { id: node.id },
          data: {
            status: 'trashed',
            trashedAt: new Date(),
            trashedByUserId: owner,
          },
        }),
      ).rejects.toThrow('read-only');
    });
  },
);
