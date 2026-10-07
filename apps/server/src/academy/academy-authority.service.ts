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

/** Always reads this deployment's Java authority; never infers relationships from names. */
@Injectable()
export class AcademyAuthorityService {
  private async read(path: string): Promise<unknown> {
    const token = process.env.JAVA_ADMIN_API_TOKEN?.trim();
    if (!token)
      throw new ServiceUnavailableException(
        'JAVA_ADMIN_API_TOKEN is required to validate Academy mappings.',
      );
    try {
      const response = await fetch(`${JAVA_CONTENT_URL}/api/admin/${path}`, {
        headers: { 'X-Admin-Api-Token': token },
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
    const result = z
      .object({
        id: z.union([z.string(), z.number()]),
        published: z
          .union([z.boolean(), z.literal(0), z.literal(1)])
          .transform((value) => value === true || value === 1),
        localized: z
          .record(z.string(), z.object({ title: z.string().nullish() }))
          .nullish(),
      })
      .safeParse(
        await this.read(`courses/${encodeURIComponent(CourseId.parse(id))}`),
      );
    if (!result.success || String(result.data.id) !== id)
      throw new NotFoundException('Course not found in this region.');
    return result.data;
  }

  async certificates() {
    const result = z
      .array(Certificate)
      .safeParse(await this.read('user-levels/levels'));
    if (!result.success)
      throw new BadGatewayException(
        'The regional certificate catalogue is invalid.',
      );
    return result.data
      .filter((item) => item.type === 4)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
