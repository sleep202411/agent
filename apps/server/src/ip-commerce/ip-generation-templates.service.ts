import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { IpCommerceService } from './ip-commerce.service';
import { AiCanonicalCatalogService } from '../ai-generation/canonical-catalog.service';
import {
  AudienceGenerationTemplateAdmin,
  AudienceGenerationTemplatePublic,
  toPublicAudienceTemplate,
  UpdateAudienceGenerationTemplatesDto,
} from './ip-generation-template.dto';

@Injectable()
export class IpGenerationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
    private readonly catalog: AiCanonicalCatalogService,
  ) {}

  private async readRaw(ipId: string): Promise<{
    templates: AudienceGenerationTemplateAdmin[];
    version: number;
    createdById: string;
  }> {
    const [row] = await this.prisma.$queryRaw<
      {
        audience_generation_templates: AudienceGenerationTemplateAdmin[] | null;
        version: number;
        created_by_id: string;
      }[]
    >`
      SELECT audience_generation_templates, version, created_by_id
      FROM ips
      WHERE id = ${ipId}::uuid AND deleted_at IS NULL
    `;

    if (!row) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        message: 'Film not found.',
      });
    }

    return {
      templates: row.audience_generation_templates ?? [],
      version: row.version,
      createdById: row.created_by_id,
    };
  }

  async getAdminTemplates(
    user: AuthUser,
    ipId: string,
  ): Promise<{
    templates: AudienceGenerationTemplateAdmin[];
    version: number;
  }> {
    await this.ips.requireEditableIp(user, ipId);
    const { templates, version } = await this.readRaw(ipId);
    return { templates, version };
  }

  async updateAdminTemplates(
    user: AuthUser,
    ipId: string,
    input: UpdateAudienceGenerationTemplatesDto,
  ): Promise<{
    templates: AudienceGenerationTemplateAdmin[];
    version: number;
  }> {
    // 1. Validate that all models exist in canonical catalog
    const knownModels = await this.catalog.listModels();
    const knownModelIds = new Set(knownModels.map((m) => m.id));

    for (const t of input.templates) {
      if (!knownModelIds.has(t.modelId)) {
        throw new BadRequestException({
          code: 'UNKNOWN_AI_MODEL',
          message: `Model ${t.modelId} is not in the canonical catalog.`,
        });
      }
    }

    // 2. Validate logoAssetIds belong to media assets created by film manager/IP owner
    const logoIds = input.templates
      .map((t) => t.logoAssetId)
      .filter((id): id is string => Boolean(id));

    if (logoIds.length > 0) {
      const assets = await this.prisma.mediaAsset.findMany({
        where: {
          id: { in: logoIds },
          createdByUserId: user.userId,
          deletedAt: null,
        },
        select: { id: true },
      });
      const validAssetIds = new Set(assets.map((a) => a.id));
      for (const logoId of logoIds) {
        if (!validAssetIds.has(logoId)) {
          throw new BadRequestException({
            code: 'INVALID_LOGO_ASSET',
            message: `Media asset ${logoId} not found or not owned by user.`,
          });
        }
      }
    }

    // 3. Atomically lock and update with optimistic version checking
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`ip:generation-templates:${ipId}`})::bigint)
      `;
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${ipId}::uuid FOR UPDATE`;
      await this.ips.requireEditableIp(user, ipId, tx);

      const rows = await tx.$queryRaw<
        {
          audience_generation_templates: AudienceGenerationTemplateAdmin[];
          version: number;
        }[]
      >`
        UPDATE ips
        SET audience_generation_templates = ${JSON.stringify(input.templates)}::jsonb,
            version = version + 1,
            updated_at = now(),
            updated_by_id = ${user.userId}
        WHERE id = ${ipId}::uuid AND version = ${input.expectedVersion}
        RETURNING audience_generation_templates, version
      `;

      if (!rows[0]) {
        throw new ConflictException({
          code: 'IP_VERSION_CONFLICT',
          message: 'This film was updated elsewhere. Refresh and try again.',
        });
      }

      return {
        templates: rows[0].audience_generation_templates ?? [],
        version: rows[0].version,
      };
    });
  }

  async getPublicTemplates(
    ipId: string,
    user?: AuthUser,
  ): Promise<{ templates: AudienceGenerationTemplatePublic[] }> {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const { templates } = await this.readRaw(ipId);

    const publicTemplates = templates
      .filter((t) => t.enabled)
      .sort((a, b) => a.order - b.order)
      .map(toPublicAudienceTemplate);

    return { templates: publicTemplates };
  }
}
