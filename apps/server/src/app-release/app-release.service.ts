import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AppPlatform } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type { CreateAppReleaseInput, UpdateAppReleaseInput } from './dto';

/**
 * Mobile app version manifest. The public read (`latest`) drives the in-app
 * update check; the admin CRUD is managed from admin-ui (应用发布 module).
 * The newest `active` row per platform is the one clients see.
 */
@Injectable()
export class AppReleaseService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: the release a client on `platform` should be offered, or null. */
  async latest(platform: AppPlatform) {
    const row = await this.prisma.appRelease.findFirst({
      where: { platform, active: true },
      // (platform, versionCode) is unique so ties can't occur, but the
      // createdAt tiebreaker keeps this deterministic regardless.
      orderBy: [{ versionCode: 'desc' }, { createdAt: 'desc' }],
    });
    if (!row) return null;
    return {
      platform: row.platform,
      versionName: row.versionName,
      versionCode: row.versionCode,
      downloadUrl: row.downloadUrl,
      releaseNotes: row.releaseNotes,
      minSupportedCode: row.minSupportedCode,
    };
  }

  /** Admin: full history (both platforms or one), newest first. */
  async listAdmin(platform?: AppPlatform) {
    return this.prisma.appRelease.findMany({
      where: platform ? { platform } : undefined,
      orderBy: [{ platform: 'asc' }, { versionCode: 'desc' }],
    });
  }

  async create(input: CreateAppReleaseInput) {
    try {
      return await this.prisma.appRelease.create({
        data: {
          platform: input.platform,
          versionName: input.versionName,
          versionCode: input.versionCode,
          downloadUrl: input.downloadUrl,
          releaseNotes: input.releaseNotes ?? null,
          minSupportedCode: input.minSupportedCode ?? null,
          active: input.active ?? true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `${input.platform} 版本号 ${input.versionCode} 已存在，请改用编辑`,
        );
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateAppReleaseInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM app_releases WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await tx.appRelease.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('release not found');
      const versionCode = input.versionCode ?? existing.versionCode;
      const minimum =
        input.minSupportedCode === undefined
          ? existing.minSupportedCode
          : input.minSupportedCode;
      if (minimum !== null && minimum > versionCode) {
        throw new BadRequestException({
          code: 'APP_RELEASE_INVALID_VERSION_RANGE',
          msg: 'Minimum supported version cannot exceed the release version.',
        });
      }
      try {
        const result = await tx.appRelease.update({
          where: { id },
          data: {
            ...(input.versionName !== undefined && {
              versionName: input.versionName,
            }),
            ...(input.versionCode !== undefined && {
              versionCode: input.versionCode,
            }),
            ...(input.downloadUrl !== undefined && {
              downloadUrl: input.downloadUrl,
            }),
            ...(input.releaseNotes !== undefined && {
              releaseNotes: input.releaseNotes,
            }),
            ...(input.minSupportedCode !== undefined && {
              minSupportedCode: input.minSupportedCode,
            }),
            ...(input.active !== undefined && { active: input.active }),
          },
        });
        return result;
      } catch (err) {
        // Renumbering onto an existing (platform, versionCode) → clean 409, same
        // as create(), not an opaque 500.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const versionCode = input.versionCode ?? existing.versionCode;
          throw new ConflictException(
            `${existing.platform} 版本号 ${versionCode} 已存在，请改用编辑`,
          );
        }
        throw err;
      }
    });
  }
}
