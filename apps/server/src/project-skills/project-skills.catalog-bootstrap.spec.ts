import { materializeBundledCatalogSkills } from '@repo/agent-skills';
import { ProjectSkillsCatalogBootstrap } from './project-skills.catalog-bootstrap';

const PREVIEW_BASE_URL = 'https://preview.test.invalid';

function fixture() {
  const catalog = materializeBundledCatalogSkills({
    previewBaseUrl: PREVIEW_BASE_URL,
  });
  const versions = new Map(
    catalog.map((definition) => [
      definition.version.id,
      {
        skillId: definition.id,
        version: definition.version.version,
        checksum: definition.version.checksum,
        status: 'published',
      },
    ]),
  );
  const tx = {
    skillCatalogItem: {
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    skillVersion: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(versions.get(where.id) ?? null),
      ),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  };
  return {
    catalog,
    prisma,
    tx,
    service: new ProjectSkillsCatalogBootstrap(prisma as never),
  };
}

describe('ProjectSkillsCatalogBootstrap background isolation', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ['BACKGROUND_TASKS_ENABLED', 'PROJECT_SKILL_PREVIEW_BASE_URL'];

  beforeEach(() => {
    for (const key of keys) saved[key] = process.env[key];
    delete process.env.BACKGROUND_TASKS_ENABLED;
    process.env.PROJECT_SKILL_PREVIEW_BASE_URL = PREVIEW_BASE_URL;
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('does not overwrite persisted catalog metadata when background tasks are disabled', async () => {
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    delete process.env.PROJECT_SKILL_PREVIEW_BASE_URL;
    const { service, prisma, tx } = fixture();

    await service.onModuleInit();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.skillCatalogItem.upsert).not.toHaveBeenCalled();
    expect(tx.skillCatalogItem.update).not.toHaveBeenCalled();
    expect(tx.skillVersion.findUnique).not.toHaveBeenCalled();
    expect(tx.skillVersion.create).not.toHaveBeenCalled();
  });

  it('retains catalog synchronization and verifies existing published versions when omitted', async () => {
    const { service, prisma, tx, catalog } = fixture();

    await service.onModuleInit();

    expect(catalog.length).toBeGreaterThan(0);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.skillCatalogItem.upsert).toHaveBeenCalledTimes(catalog.length);
    expect(tx.skillVersion.findUnique).toHaveBeenCalledTimes(catalog.length);
    expect(tx.skillVersion.create).not.toHaveBeenCalled();
    expect(tx.skillCatalogItem.update).toHaveBeenCalledWith({
      where: { id: catalog[0].id },
      data: { latestPublishedVersionId: catalog[0].version.id },
    });
  });

  it('still rejects missing publication configuration when synchronization is enabled', async () => {
    process.env.BACKGROUND_TASKS_ENABLED = 'true';
    delete process.env.PROJECT_SKILL_PREVIEW_BASE_URL;
    const { service, prisma } = fixture();

    await expect(service.onModuleInit()).rejects.toThrow(
      'PROJECT_SKILL_PREVIEW_BASE_URL is required',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
