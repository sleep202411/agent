import {
  BadGatewayException,
  Injectable,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  JAVA_CONTENT_URL,
  JAVA_REQUEST_TIMEOUT_MS,
} from '../integrations/java/java-config';

export const CourseId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Certificate = z.object({
  id: z.coerce.number().int().positive().safe(),
  name: z.string().trim().min(1),
  type: z.coerce.number().int().nullish(),
  imagePath: z.string().nullable().optional(),
});

const Course = z.object({
  id: z.union([z.string(), z.number()]),
  published: z
    .union([z.boolean(), z.literal(0), z.literal(1)])
    .transform((value) => value === true || value === 1),
  certificateId: z
    .union([z.coerce.number().int().safe(), z.null()])
    .nullish()
    .transform((value) =>
      typeof value === 'number' && value > 0 ? value : null,
    ),
  priceCredits: z.union([z.string(), z.number()]).nullish(),
  enrollmentEnabled: z
    .union([z.boolean(), z.literal(0), z.literal(1)])
    .nullish(),
  instructorShares: z
    .array(
      z.object({
        userId: z.union([z.string(), z.number()]),
        shareBps: z.coerce.number().int().min(0).max(10000),
      }),
    )
    .optional(),
  instructors: z
    .array(
      z.object({
        userId: z.union([z.string(), z.number()]),
        nickName: z.string().nullish(),
        shareBps: z.coerce.number().int().min(0).max(10000).nullish(),
      }),
    )
    .optional(),
  localized: z
    .record(z.string(), z.object({ title: z.string().nullish() }))
    .nullish(),
});

/** Always reads this deployment's Java authority; never infers relationships from names. */
@Injectable()
export class AcademyAuthorityService {
  private async read(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const token = process.env.JAVA_ADMIN_API_TOKEN?.trim();
    if (!token)
      throw new ServiceUnavailableException(
        'JAVA_ADMIN_API_TOKEN is required to validate Academy mappings.',
      );
    try {
      const response = await fetch(`${JAVA_CONTENT_URL}/api/admin/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'X-Admin-Api-Token': token,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(JAVA_REQUEST_TIMEOUT_MS),
      });
      const result = z
        .object({
          code: z.number(),
          data: z.unknown().optional(),
          msg: z.string().optional(),
        })
        .safeParse(await response.json());
      if (
        response.status === 404 ||
        (result.success && result.data.code === 404)
      )
        throw new NotFoundException('Academy record not found in this region.');
      if (!response.ok || !result.success || result.data.code !== 200) {
        throw new BadGatewayException(
          result.success && result.data.msg
            ? result.data.msg
            : 'The regional Academy authority could not be verified.',
        );
      }
      return result.data.data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException(
        'The regional Academy authority could not be verified. No mapping was changed.',
      );
    }
  }

  async course(id: string) {
    const result = Course.safeParse(
      await this.read(`courses/${encodeURIComponent(CourseId.parse(id))}`),
    );
    if (!result.success || String(result.data.id) !== id)
      throw new NotFoundException('Course not found in this region.');
    return result.data;
  }

  async coursePage(page: number) {
    const result = z
      .object({
        list: z.array(Course).max(10),
        total: z.coerce.number().int().nonnegative().safe(),
      })
      .safeParse(
        await this.read(`courses?published=true&page=${page}&pageSize=10`),
      );
    if (
      !result.success ||
      new Set(result.data.list.map((course) => String(course.id))).size !==
        result.data.list.length ||
      result.data.list.some(
        (course) => !CourseId.safeParse(String(course.id)).success,
      ) ||
      (result.data.list.length === 0 && (page - 1) * 10 < result.data.total)
    ) {
      throw new BadGatewayException(
        'The regional course catalogue is invalid.',
      );
    }
    return result.data;
  }

  async grantSkill(userId: string, certificateId: number) {
    if (!/^\d+$/.test(userId) || !Number.isSafeInteger(Number(userId)))
      throw new ServiceUnavailableException(
        'A valid regional Academy user is required.',
      );
    if (!(await this.certificates()).some((c) => c.id === certificateId))
      throw new NotFoundException(
        'Academy skill certificate is no longer available.',
      );
    // Read first: retries after a lost response must not remove/recreate an
    // existing Java relation or overwrite a separately awarded certificate.
    const existing = z
      .array(
        z.object({ userId: z.coerce.string(), levelId: z.coerce.number() }),
      )
      .parse(
        await this.read(
          `user-levels?userId=${encodeURIComponent(userId)}&levelId=${certificateId}&page=1&pageSize=10`,
        ),
      );
    if (
      existing.some((r) => r.userId === userId && r.levelId === certificateId)
    )
      return;
    await this.read('user-levels', {
      userId: Number(userId),
      levelId: certificateId,
      remark: 'Academy homework approved',
    });
  }

  async certificates() {
    const result = z
      .array(Certificate)
      .safeParse(await this.read('user-levels/levels'));
    if (!result.success)
      throw new BadGatewayException(
        'The regional certificate catalogue is invalid.',
      );
    return result.data.sort((a, b) => a.name.localeCompare(b.name));
  }
}
