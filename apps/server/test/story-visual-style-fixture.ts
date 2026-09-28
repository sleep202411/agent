import { Prisma, type PrismaClient } from '@prisma/client';
import { materializeBundledCatalogSkills } from '@repo/agent-skills';

/** Persistent immutable seed in an explicitly owned test database only. */
export async function ensureStoryVisualStyleFixture(db: PrismaClient) {
  const definition = materializeBundledCatalogSkills({
    previewBaseUrl: 'https://fixture.invalid/skills',
  }).find((item) => item.slug === 'cinematic-realism')!;
  await db.$transaction(async (tx) => {
    const [target] = await tx.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (!['task01', 'fizzdragon_outbox_test'].includes(target.name))
      throw new Error('Owned test database required');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('test:cinematic-realism-catalog',0))`;
    const existing = await tx.skillCatalogItem.findUnique({
      where: { id: definition.id },
    });
    if (
      existing &&
      (existing.slug !== definition.slug ||
        existing.category !== 'style' ||
        existing.status !== 'published' ||
        existing.latestPublishedVersionId !== definition.version.id)
    )
      throw new Error(
        'Existing visual-style fixture catalog differs from the bundled definition',
      );
    if (!existing)
      await tx.skillCatalogItem.create({
        data: {
          id: definition.id,
          slug: definition.slug,
          name: definition.name,
          description: definition.description,
          publisherName: definition.publisherName,
          category: definition.category,
          kind: definition.kind,
          visibility: 'public',
          status: 'published',
        },
      });
    const version = await tx.skillVersion.findUnique({
      where: { id: definition.version.id },
    });
    if (
      version &&
      (version.skillId !== definition.id ||
        version.status !== 'published' ||
        version.checksum !== definition.version.checksum)
    )
      throw new Error(
        'Existing immutable visual-style fixture version differs from the bundled definition',
      );
    if (!version)
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
          riskPolicy: definition.version.riskPolicy as Prisma.InputJsonValue,
          evalSuite: definition.version.evalSuite,
          checksum: definition.version.checksum,
          publishedAt: new Date(definition.version.publishedAt),
        },
      });
    if (!existing)
      await tx.skillCatalogItem.update({
        where: { id: definition.id },
        data: { latestPublishedVersionId: definition.version.id },
      });
  });
}
