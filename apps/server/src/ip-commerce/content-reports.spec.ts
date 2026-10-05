import { IpCommerceService } from './ip-commerce.service';
import type { AuthUser } from '../auth';
import type { Prisma } from '@prisma/client';
function firstArgument<T>(mock: { mock: { calls: unknown[][] } }): T {
  return mock.mock.calls[0][0] as T;
}
const actor = { userId: 'reporter' } as AuthUser;
function setup() {
  const db = {
    $executeRaw: jest.fn().mockResolvedValue([]),
    ipContentReport: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'report', createdAt: new Date() }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    mediaAsset: { findFirst: jest.fn() },
    ip: { findFirst: jest.fn().mockResolvedValue({ id: 'ip' }) },
  };
  const transaction = jest.fn((work: (tx: typeof db) => Promise<unknown>) =>
    work(db),
  );
  const svc = new IpCommerceService(
    { ...db, $transaction: transaction } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { db, svc, transaction };
}
it('scopes initiated reports to the signed-in reporter', async () => {
  const { db, svc } = setup();
  await svc.listMyContentReports(actor, { view: 'initiated', limit: 20 });
  const call = firstArgument<Prisma.IpContentReportFindManyArgs>(
    db.ipContentReport.findMany,
  );
  expect(call.where).toEqual({ reporterUserId: 'reporter' });
  expect(call.select?.reporterUserId).toBeUndefined();
  expect(call.select?.metadata).toBeUndefined();
});
it('shows only completed outcomes on currently owned IPs without complaint evidence', async () => {
  const { db, svc } = setup();
  await svc.listMyContentReports(actor, { view: 'responses', limit: 20 });
  const call = firstArgument<Prisma.IpContentReportFindManyArgs>(
    db.ipContentReport.findMany,
  );
  expect(call.where).toEqual({
    ip: { createdById: 'reporter', deletedAt: null },
    status: { in: ['actioned', 'dismissed'] },
  });
  expect(call.select?.description).toBeUndefined();
  expect(call.select?.evidenceAssetId).toBeUndefined();
});
it('rejects a cursor outside the actor scope before listing', async () => {
  const { db, svc } = setup();
  db.ipContentReport.findFirst.mockResolvedValue(null);
  await expect(
    svc.listMyContentReports(actor, {
      view: 'initiated',
      limit: 20,
      cursor: 'other',
    }),
  ).rejects.toMatchObject({
    response: { code: 'CONTENT_REPORT_CURSOR_INVALID' },
  });
  expect(db.ipContentReport.findMany).not.toHaveBeenCalled();
});
it('rejects evidence files not owned by the reporter', async () => {
  const { db, svc } = setup();
  db.mediaAsset.findFirst.mockResolvedValue(null);
  await expect(
    svc.reportContent(actor, {
      targetType: 'ip',
      targetId: 'ip',
      reason: 'copyright',
      evidenceAssetId: 'file',
    }),
  ).rejects.toMatchObject({
    response: { code: 'REPORT_EVIDENCE_UNAVAILABLE' },
  });
  expect(db.mediaAsset.findFirst).toHaveBeenCalledWith({
    where: { id: 'file', createdByUserId: 'reporter', deletedAt: null },
    select: { id: true },
  });
});

it('locks and validates evidence in the same transaction as the report write', async () => {
  const { db, svc, transaction } = setup();
  db.mediaAsset.findFirst.mockResolvedValue({ id: 'file' });
  await svc.reportContent(actor, {
    targetType: 'ip',
    targetId: 'ip',
    reason: 'copyright',
    evidenceAssetId: 'file',
  });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
    db.mediaAsset.findFirst.mock.invocationCallOrder[0],
  );
  expect(db.mediaAsset.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
    db.ipContentReport.create.mock.invocationCallOrder[0],
  );
});

it('creates a report without evidence without taking a media lock', async () => {
  const { db, svc } = setup();
  await expect(
    svc.reportContent(actor, {
      targetType: 'ip',
      targetId: 'ip',
      reason: 'copyright',
    }),
  ).resolves.toMatchObject({ report: { id: 'report' } });
  expect(db.$executeRaw).not.toHaveBeenCalled();
  expect(db.mediaAsset.findFirst).not.toHaveBeenCalled();
});
