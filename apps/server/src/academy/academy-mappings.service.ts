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
      certificateId: course.certificateId ?? null,
      version: mapping?.version ?? 0,
      certificates,
    };
  }

  async index(admin: AdminActor, courseIds: string[]) {
    this.access(admin, ADMIN_PERMISSION_KEYS.CoursesRead);
    const ids = [...new Set(courseIds)].slice(0, 100);
    if (ids.length === 0) return { items: [] };
    const certificates = await this.authority.certificates();
    const byId = new Map(certificates.map((item) => [item.id, item]));
    const items: {
      courseId: string;
      certificate: { id: number; name: string; imagePath: string | null };
    }[] = [];
    // Bound upstream concurrency and use the same authority as the course editor.
    for (const courseId of ids) {
      try {
        const course = await this.authority.course(courseId);
        if (course.certificateId == null) continue;
        const certificate = byId.get(course.certificateId);
        items.push({
          courseId,
          certificate: {
            id: course.certificateId,
            name: certificate?.name ?? `#${course.certificateId}`,
            imagePath: certificate?.imagePath ?? null,
          },
        });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return { items };
  }

  save(
    admin: AdminActor,
    _courseId: string,
    _input: z.infer<typeof SaveCourseCertificate>,
  ) {
    this.access(admin, ADMIN_PERMISSION_KEYS.CoursesWrite);
    void _courseId;
    void _input;
    // The current editor writes Java directly. A local-only write would be
    // invisible to course reads and must never acknowledge a successful save.
    throw new ConflictException(
      'Save the certificate in the course editor. Separate certificate mappings are no longer supported.',
    );
  }

  async published(courseId: string) {
    const course = await this.authority.course(courseId);
    if (!course.published) throw new NotFoundException('Course not found.');
    const certificateId = course.certificateId ?? null;
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
    // Versioned opaque cursors do not reuse the old local-table course ID.
    const match = query.after?.match(/^java_([1-9]\d*)$/);
    const page = query.after ? Number(match?.[1]) : 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
      throw new BadRequestException(
        'Course lookup changed. Reload the course list.',
      );
    }
    const result = await this.authority.coursePage(page);
    return {
      certificateId,
      items: result.list.flatMap((course) =>
        course.published && course.certificateId === certificateId
          ? [
              {
                courseId: String(course.id),
                title:
                  course.localized?.[query.locale]?.title?.trim() ||
                  course.localized?.['en-US']?.title?.trim() ||
                  String(course.id),
              },
            ]
          : [],
      ),
      // An empty matching page can still have later eligible courses.
      nextCursor: page * 10 < result.total ? `java_${page + 1}` : null,
    };
  }
}
