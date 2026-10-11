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
  const prisma = {
    academyCourseCertificate: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ certificateId: 99, version: 2 }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ courseId: '42', certificateId: 99 }]),
    },
    $transaction: jest.fn(),
  };
  const authority = {
    course: jest
      .fn()
      .mockResolvedValue({ id: 42, published: true, certificateId: 13 }),
    coursePage: jest.fn().mockResolvedValue({ list: [], total: 0 }),
    certificates: jest.fn().mockResolvedValue(certificates),
  };
  const service = new AcademyMappingsService(
    prisma as unknown as PrismaService,
    authority as unknown as AcademyAuthorityService,
  );
  return { service, prisma, authority };
}

describe('Academy authoritative course mappings', () => {
  it.each([null, undefined])(
    'does not revive a stale local certificate when Java returns %s',
    async (certificateId) => {
      const { service, authority } = fixture();
      authority.course.mockResolvedValue({
        id: 42,
        published: true,
        certificateId,
      });
      expect(await service.published('42')).toEqual({
        courseId: '42',
        certificate: null,
      });
      expect(await service.editor(admin, '42')).toMatchObject({
        certificateId: null,
      });
      expect(await service.index(admin, ['42'])).toEqual({ items: [] });
    },
  );
  it('uses Java consistently for editor, public detail and index despite conflicting local rows', async () => {
    const { service } = fixture();
    expect(await service.editor(admin, '42')).toMatchObject({
      certificateId: 13,
    });
    expect(await service.published('42')).toEqual({
      courseId: '42',
      certificate: certificates[0],
    });
    expect(await service.index(admin, ['42', '42'])).toEqual({
      items: [
        {
          courseId: '42',
          certificate: { id: 13, name: 'AI Producer', imagePath: null },
        },
      ],
    });
  });
  it('finds courses assigned by the current editor without local mapping rows', async () => {
    const { service, authority, prisma } = fixture();
    authority.coursePage.mockResolvedValue({
      list: [
        {
          id: 42,
          published: true,
          certificateId: 13,
          localized: { 'zh-CN': { title: '课程' } },
        },
      ],
      total: 1,
    });
    expect(await service.courses(13, { locale: 'zh-CN' })).toEqual({
      certificateId: 13,
      items: [{ courseId: '42', title: '课程' }],
      nextCursor: null,
    });
    expect(prisma.academyCourseCertificate.findMany).not.toHaveBeenCalled();
  });
  it('keeps pagination through nonmatching pages and excludes unpublished or reassigned courses', async () => {
    const { service, authority } = fixture();
    authority.coursePage
      .mockResolvedValueOnce({
        list: [
          { id: 1, published: true, certificateId: 14 },
          { id: 2, published: false, certificateId: 13 },
          { id: 3, published: true, certificateId: null },
        ],
        total: 11,
      })
      .mockResolvedValueOnce({
        list: [{ id: 11, published: true, certificateId: 13 }],
        total: 11,
      });
    expect(await service.courses(13, { locale: 'en-US' })).toEqual({
      certificateId: 13,
      items: [],
      nextCursor: 'java_2',
    });
    expect(
      await service.courses(13, { locale: 'en-US', after: 'java_2' }),
    ).toEqual({
      certificateId: 13,
      items: [{ courseId: '11', title: '11' }],
      nextCursor: null,
    });
    expect(authority.coursePage).toHaveBeenLastCalledWith(2);
  });
  it.each(['42', 'java_0', 'java_9007199254740992', 'java_-1'])(
    'rejects invalid or obsolete cursor %s',
    async (after) => {
      const { service, authority } = fixture();
      await expect(
        service.courses(13, { locale: 'en-US', after }),
      ).rejects.toThrow('Reload');
      expect(authority.coursePage).not.toHaveBeenCalled();
    },
  );
  it('propagates authority outages rather than silently returning no recommendations', async () => {
    const { service, authority } = fixture();
    authority.coursePage.mockRejectedValue(new Error('Java unavailable'));
    await expect(service.courses(13, { locale: 'en-US' })).rejects.toThrow(
      'Java unavailable',
    );
  });
  it('skips deleted courses in the admin index but propagates other failures', async () => {
    const { service, authority } = fixture();
    authority.course.mockRejectedValueOnce(new NotFoundException());
    expect(await service.index(admin, ['deleted'])).toEqual({ items: [] });
    authority.course.mockRejectedValueOnce(new Error('Java unavailable'));
    await expect(service.index(admin, ['42'])).rejects.toThrow(
      'Java unavailable',
    );
  });
  it('rejects local-only saves rather than acknowledging an ineffective change', () => {
    const { service, prisma } = fixture();
    expect(() =>
      service.save(admin, '42', { certificateId: null, expectedVersion: 2 }),
    ).toThrow('course editor');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    { ...admin, siteScope: 'cn' },
    { ...admin, permissions: [] },
    { ...admin, status: 'disabled' },
  ])('enforces the regional admin read and write gates', async (actor) => {
    const { service, authority } = fixture();
    await expect(service.editor(actor as AdminActor, '42')).rejects.toThrow(
      'Course management access',
    );
    await expect(service.index(actor as AdminActor, ['42'])).rejects.toThrow(
      'Course management access',
    );
    expect(() =>
      service.save(actor as AdminActor, '42', {
        certificateId: 13,
        expectedVersion: 0,
      }),
    ).toThrow('Course management access');
    expect(authority.course).not.toHaveBeenCalled();
  });
  it('rejects unknown certificates and unpublished courses', async () => {
    const { service, authority } = fixture();
    await expect(service.courses(99, { locale: 'en-US' })).rejects.toThrow(
      'not found',
    );
    authority.course.mockResolvedValue({
      id: 42,
      published: false,
      certificateId: 13,
    });
    await expect(service.published('42')).rejects.toThrow('Course not found');
  });
  it('fails closed on a deleted certificate definition', async () => {
    const { service, authority } = fixture();
    authority.certificates.mockResolvedValue([]);
    await expect(service.published('42')).rejects.toThrow(
      'no longer available',
    );
  });
  it('still validates obsolete command input', () => {
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
