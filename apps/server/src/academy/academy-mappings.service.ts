import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { type AdminActor, ADMIN_PERMISSION_KEYS } from '../admin-auth';
import { CURRENT_CELL } from '../common/region/current-cell';
import { AcademyAuthorityService } from './academy-authority.service';

export const SaveCourseCertificate = z.strictObject({
  certificateId: z.number().int().positive().safe().nullable(),
  expectedVersion: z.number().int().nonnegative().safe(),
});
export const CertificateCoursesQuery = z.object({
  locale: z.enum(['en-US', 'zh-CN', 'zh-HK']).default('en-US'),
  after: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});

@Injectable()
export class AcademyMappingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AcademyAuthorityService,
  ) {}

  private access(admin: AdminActor, permission: string) {
    if (
      admin.status !== 'active' ||
      !admin.permissions.includes(permission) ||
      (admin.siteScope !== 'all' &&
        admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global'))
    ) {
      throw new ForbiddenException(
        'Course management access for this region is required.',
      );
    }
  }

  async editor(admin: AdminActor, courseId: string) {
    this.access(admin, ADMIN_PERMISSION_KEYS.CoursesRead);
    const [course, certificates, mapping] = await Promise.all([
      this.authority.course(courseId),
      this.authority.certificates(),
      this.prisma.academyCourseCertificate.findUnique({ where: { courseId } }),
    ]);
    return {
      courseId,
      certificateId: course.certificateId ?? mapping?.certificateId ?? null,
      version: mapping?.version ?? 0,
      certificates,
    };
  }

  async index(admin: AdminActor, courseIds: string[]) {
    this.access(admin, ADMIN_PERMISSION_KEYS.CoursesRead);
    const ids = [...new Set(courseIds)].slice(0, 100);
    if (ids.length === 0) return { items: [] };
    const [certificates, mappings] = await Promise.all([
      this.authority.certificates(),
      this.prisma.academyCourseCertificate.findMany({
        where: { courseId: { in: ids }, certificateId: { not: null } },
      }),
    ]);
    const byId = new Map(certificates.map((item) => [item.id, item]));
    return {
      items: mappings.flatMap((mapping) => {
        if (mapping.certificateId == null) return [];
        const certificate = byId.get(mapping.certificateId);
        return [
          {
            courseId: mapping.courseId,
            certificate: {
              id: mapping.certificateId,
              name: certificate?.name ?? `#${mapping.certificateId}`,
              imagePath: certificate?.imagePath ?? null,
            },
          },
        ];
      }),
    };
  }

  async save(
    admin: AdminActor,
    courseId: string,
    input: z.infer<typeof SaveCourseCertificate>,
  ) {
    this.access(admin, ADMIN_PERMISSION_KEYS.CoursesWrite);
    const [, certificates] = await Promise.all([
      this.authority.course(courseId),
      this.authority.certificates(),
    ]);
    if (
      input.certificateId !== null &&
      !certificates.some((item) => item.id === input.certificateId)
    ) {
      throw new BadRequestException(
        'Select an Academy skill certificate from this region.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // hashtext is available on every supported Postgres; hashtextextended needs PG14+.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academy-course:${courseId}`})::bigint)`;
      const previous = await tx.academyCourseCertificate.findUnique({
        where: { courseId },
      });
      if ((previous?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException(
          'This mapping changed. Reload it before saving.',
        );
      const mapping = await tx.academyCourseCertificate.upsert({
        where: { courseId },
        create: { courseId, certificateId: input.certificateId, version: 1 },
        update: {
          certificateId: input.certificateId,
          version: { increment: 1 },
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId: admin.id,
          actorSessionId: admin.sessionId,
          siteScope: CURRENT_CELL === 'cn' ? 'cn' : 'global',
          action: 'academy.course_certificate.save',
          resourceType: 'academy_course',
          resourceId: courseId,
          before: {
            certificateId: previous?.certificateId ?? null,
            version: previous?.version ?? 0,
          },
          after: {
            certificateId: mapping.certificateId,
            version: mapping.version,
          },
        },
      });
      return {
        courseId,
        certificateId: mapping.certificateId,
        version: mapping.version,
        certificates,
      };
    });
  }

  async published(courseId: string) {
    const course = await this.authority.course(courseId);
    if (!course.published) throw new NotFoundException('Course not found.');
    const mapping = await this.prisma.academyCourseCertificate.findUnique({
      where: { courseId },
    });
    const certificateId =
      course.certificateId ?? mapping?.certificateId ?? null;
    if (!certificateId) return { courseId, certificate: null };
    const certificate = (await this.authority.certificates()).find(
      (item) => item.id === certificateId,
    );
    if (!certificate)
      throw new ConflictException(
        'The course certificate is no longer available.',
      );
    return { courseId, certificate };
  }

  async courses(
    certificateId: number,
    query: z.infer<typeof CertificateCoursesQuery>,
  ) {
    if (
      !(await this.authority.certificates()).some(
        (item) => item.id === certificateId,
      )
    ) {
      throw new NotFoundException('Academy skill certificate not found.');
    }
    const mappings = await this.prisma.academyCourseCertificate.findMany({
      where: {
        certificateId,
        ...(query.after ? { courseId: { gt: query.after } } : {}),
      },
      orderBy: { courseId: 'asc' },
      take: 11,
    });
    const page = mappings.slice(0, 10);
    const items: { courseId: string; title: string }[] = [];
    // Keep upstream concurrency bounded; draft or deleted courses never leak through this lookup.
    for (const mapping of page) {
      try {
        const course = await this.authority.course(mapping.courseId);
        if (course.published)
          items.push({
            courseId: mapping.courseId,
            title:
              course.localized?.[query.locale]?.title?.trim() ||
              course.localized?.['en-US']?.title?.trim() ||
              mapping.courseId,
          });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return {
      certificateId,
      items,
      nextCursor: mappings.length > 10 ? page.at(-1)!.courseId : null,
    };
  }
}
