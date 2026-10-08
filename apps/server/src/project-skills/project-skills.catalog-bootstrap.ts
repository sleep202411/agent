import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { materializeBundledCatalogSkills } from '@repo/agent-skills';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';

/**
 * Mirrors the Git-governed bundled catalog into PostgreSQL.
 * Existing published versions are verified, never updated; drift fails boot.
 */
@Injectable()
export class ProjectSkillsCatalogBootstrap implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const previewBaseUrl = process.env.PROJECT_SKILL_PREVIEW_BASE_URL?.trim();
    if (!previewBaseUrl) {
      throw new Error(
        'PROJECT_SKILL_PREVIEW_BASE_URL is required to publish the bundled Project Skill catalog',
      );
    }
    const catalog = materializeBundledCatalogSkills({ previewBaseUrl });
    await this.prisma.$transaction(async (tx) => {
      for (const definition of catalog) {
        await tx.skillCatalogItem.upsert({
          where: { id: definition.id },
          create: {
            id: definition.id,
            slug: definition.slug,
            name: definition.name,
            description: definition.description,
            localizedMetadata: {
              translationKey: definition.translationKey,
            },
            publisherName: definition.publisherName,
            category: definition.category,
            kind: definition.kind,
            visibility: 'public',
            status: 'published',
            previewUrl: definition.previewUrl,
            previewVideoUrl: definition.previewVideoUrl,
          },
          update: {
            slug: definition.slug,
            name: definition.name,
            description: definition.description,
            localizedMetadata: {
              translationKey: definition.translationKey,
            },
            publisherName: definition.publisherName,
            category: definition.category,
            kind: definition.kind,
            visibility: 'public',
            status: 'published',
            previewUrl: definition.previewUrl,
            previewVideoUrl: definition.previewVideoUrl,
          },
        });

        const existingVersion = await tx.skillVersion.findUnique({
          where: { id: definition.version.id },
          select: {
            skillId: true,
            version: true,
            checksum: true,
            status: true,
          },
        });
        if (existingVersion) {
          if (
            existingVersion.skillId !== definition.id ||
            existingVersion.version !== definition.version.version ||
            existingVersion.checksum !== definition.version.checksum ||
            existingVersion.status !== 'published'
          ) {
            throw new Error(
              `Published Skill version drift detected: ${definition.slug}@${definition.version.version}`,
            );
          }
        } else {
          await tx.skillVersion.create({
            data: {
              id: definition.version.id,
              skillId: definition.id,
              version: definition.version.version,
              status: 'published',
              manifestSchemaVersion: definition.version.manifestSchemaVersion,
              instructions: definition.version.instructions,
              generationPolicy: definition.version
                .generationPolicy as Prisma.InputJsonValue,
              configSchema: definition.version
                .configSchema as Prisma.InputJsonValue,
              capabilities: [...definition.version.capabilities],
              projectKinds: [...definition.version.projectKinds],
              workbenchModes: [...definition.version.workbenchModes],
              toolIds: [...definition.version.toolIds],
              riskPolicy: definition.version
                .riskPolicy as Prisma.InputJsonValue,
              evalSuite: definition.version.evalSuite,
              checksum: definition.version.checksum,
              publishedAt: new Date(definition.version.publishedAt),
            },
          });
        }

        await tx.skillCatalogItem.update({
          where: { id: definition.id },
          data: { latestPublishedVersionId: definition.version.id },
        });
      }
    });
  }
}
