import {
  AcademyMappingsService,
  SaveCourseCertificate,
} from './academy-mappings.service';
import { AcademyAuthorityService } from './academy-authority.service';
import { PrismaService } from '../infra/db/db.module';
import type { AdminActor } from '../admin-auth';
import { NotFoundException } from '@nestjs/common';

const admin = {
  id: 'admin',
  sessionId: 'session',
  status: 'active',
  siteScope: 'global',
  permissions: ['courses.read', 'courses.write'],
} as AdminActor;
const certificates = [{ id: 13, name: 'AI Producer', type: 4 }];
function fixture() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    academyCourseCertificate: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest
        .fn()
        .mockResolvedValue({ courseId: '42', certificateId: 13, version: 1 }),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const authority = {
    course: jest.fn().mockResolvedValue({ id: 42, published: true }),
    certificates: jest.fn().mockResolvedValue(certificates),
  };
  const service = new AcademyMappingsService(
    prisma as unknown as PrismaService,
    authority as unknown as AcademyAuthorityService,
  );
  return { service, tx, prisma, authority };
}

describe('Academy course mappings', () => {
  it('lists only published courses and preserves pagination across deleted courses', async () => {
    const { service, tx, authority } = fixture();
    tx.academyCourseCertificate.findMany.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => ({ courseId: String(i + 10) })),
    );
    authority.course.mockImplementation((id: string) =>
      id === '10'
        ? Promise.reject(new NotFoundException())
        : Promise.resolve({
            id,
            published: id !== '11',
            localized: { 'zh-CN': { title: `课程${id}` } },
          }),
    );
    const result = await service.courses(13, { locale: 'zh-CN' });
    expect(result.items).toHaveLength(8);
    expect(result.items[0]).toEqual({ courseId: '12', title: '课程12' });
    expect(result.nextCursor).toBe('19');
    await service.courses(13, { locale: 'en-US', after: '19' });
    expect(tx.academyCourseCertificate.findMany).toHaveBeenLastCalledWith({
      where: { certificateId: 13, courseId: { gt: '19' } },
      orderBy: { courseId: 'asc' },
      take: 11,
    });
  });
  it('does not turn a reverse-lookup service failure into an empty result', async () => {
    const { service, tx, authority } = fixture();
    tx.academyCourseCertificate.findMany.mockResolvedValue([
      { courseId: '42' },
    ]);
    authority.course.mockRejectedValue(new Error('Java unavailable'));
    await expect(service.courses(13, { locale: 'en-US' })).rejects.toThrow(
      'Java unavailable',
    );
  });
  it('indexes assigned certificates for the current course list', async () => {
    const { service, tx, authority } = fixture();
    authority.certificates.mockResolvedValue([
      { id: 13, name: 'AI Producer', type: 4, imagePath: 'static/ai.png' },
    ]);
    tx.academyCourseCertificate.findMany.mockResolvedValue([
      { courseId: '42', certificateId: 13 },
      { courseId: '7', certificateId: 99 },
    ]);
    await expect(service.index(admin, ['42', '7'])).resolves.toEqual({
      items: [
        {
          courseId: '42',
          certificate: {
            id: 13,
            name: 'AI Producer',
            imagePath: 'static/ai.png',
          },
        },
        {
          courseId: '7',
          certificate: { id: 99, name: '#99', imagePath: null },
        },
      ],
    });
  });
  it('represents an unconfigured course explicitly', async () => {
    const { service } = fixture();
    await expect(service.editor(admin, '42')).resolves.toEqual({
      courseId: '42',
      certificateId: null,
      version: 0,
      certificates,
    });
  });
  it('saves an authoritative certificate and audit in one transaction', async () => {
    const { service, tx, prisma } = fixture();
    await expect(
      service.save(admin, '42', { certificateId: 13, expectedVersion: 0 }),
    ).resolves.toMatchObject({ certificateId: 13, version: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin',
        resourceId: '42',
        after: { certificateId: 13, version: 1 },
      }) as Record<string, unknown>,
    });
  });
  it('rejects stale writes before upsert or audit', async () => {
    const { service, tx } = fixture();
    tx.academyCourseCertificate.findUnique.mockResolvedValue({
      version: 2,
      certificateId: 13,
    });
    await expect(
      service.save(admin, '42', { certificateId: 13, expectedVersion: 1 }),
    ).rejects.toThrow('This mapping changed');
    expect(tx.academyCourseCertificate.upsert).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });
  it('does not accept invented or honorary certificate IDs', async () => {
    const { service, prisma } = fixture();
    await expect(
      service.save(admin, '42', { certificateId: 999, expectedVersion: 0 }),
    ).rejects.toThrow('Academy skill certificate');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    { ...admin, siteScope: 'cn' },
    { ...admin, permissions: ['courses.read'] },
    { ...admin, status: 'disabled' },
  ])('rejects invalid authority before calling Java', async (actor) => {
    const { service, authority } = fixture();
    await expect(
      service.save(actor as AdminActor, '42', {
        certificateId: 13,
        expectedVersion: 0,
      }),
    ).rejects.toThrow('Course management access');
    expect(authority.course).not.toHaveBeenCalled();
  });
  it('does not save when the catalogue is unavailable', async () => {
    const { service, authority, prisma } = fixture();
    authority.certificates.mockRejectedValue(new Error('Java unavailable'));
    await expect(
      service.save(admin, '42', { certificateId: 13, expectedVersion: 0 }),
    ).rejects.toThrow('Java unavailable');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('retains a tombstone version when clearing the association', async () => {
    const { service, tx } = fixture();
    tx.academyCourseCertificate.findUnique.mockResolvedValue({
      version: 2,
      certificateId: 13,
    });
    tx.academyCourseCertificate.upsert.mockResolvedValue({
      courseId: '42',
      certificateId: null,
      version: 3,
    });
    await expect(
      service.save(admin, '42', { certificateId: null, expectedVersion: 2 }),
    ).resolves.toMatchObject({ certificateId: null, version: 3 });
    expect(tx.academyCourseCertificate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { certificateId: null, version: { increment: 1 } },
      }),
    );
  });
  it('does not expose unpublished course mappings', async () => {
    const { service, authority } = fixture();
    authority.course.mockResolvedValue({ id: 42, published: false });
    await expect(service.published('42')).rejects.toThrow('Course not found');
  });
  it('returns the live certificate and rejects deleted definitions', async () => {
    const { service, tx, authority } = fixture();
    tx.academyCourseCertificate.findUnique.mockResolvedValue({
      certificateId: 13,
    });
    await expect(service.published('42')).resolves.toEqual({
      courseId: '42',
      certificate: certificates[0],
    });
    authority.certificates.mockResolvedValue([]);
    await expect(service.published('42')).rejects.toThrow(
      'no longer available',
    );
  });
  it('rejects unknown command keys and invalid versions', () => {
    expect(
      SaveCourseCertificate.safeParse({
        certificateId: 13,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      SaveCourseCertificate.safeParse({
        certificateId: 13,
        expectedVersion: 0,
        userId: 1,
      }).success,
    ).toBe(false);
  });
});
