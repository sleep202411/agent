import { ForbiddenException } from '@nestjs/common';
import { ProjectSkillsService } from './project-skills.service';

function setup() {
  let saved: Record<string, unknown> | null = null;
  const version = {
    id: 'version',
    version: '1.0.0',
    checksum: 'checksum',
    capabilities: ['image_generation'],
    projectKinds: ['platform'],
    workbenchModes: [],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  };
  const db = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    skillCatalogItem: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'skill',
        name: 'Fixture',
        latestPublishedVersion: version,
      }),
    },
    projectSkillState: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    projectSkillInstallation: {
      create: jest.fn().mockResolvedValue({
        id: 'installation',
        skillId: 'skill',
        pinnedVersionId: 'version',
        revision: 0,
        status: 'active',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        activations: [],
        pinnedVersion: version,
      }),
    },
    projectSkillAudit: { create: jest.fn().mockResolvedValue({}) },
    projectSkillMutation: {
      findUnique: jest.fn(() => Promise.resolve(saved)),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        saved = data;
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    ...db,
    $transaction: jest.fn((work: (tx: typeof db) => Promise<unknown>) =>
      work(db),
    ),
  };
  const permissions = {
    requireProjectRole: jest
      .fn()
      .mockResolvedValue({ workspaceId: 'workspace' }),
  };
  const service = new ProjectSkillsService(
    prisma as never,
    permissions as never,
    {} as never,
    {} as never,
  );
  const body = {
    skillId: 'skill',
    expectedProjectRevision: 0,
    idempotencyKey: 'same-key',
  };
  const install = (userId = 'owner', input = body) =>
    service.install({ userId }, 'platform', 'project', input);
  return { db, version, permissions, body, install };
}

describe('Skill install receipt replay', () => {
  it('returns the original installation after the catalog entry becomes unavailable', async () => {
    const { db, install } = setup();
    const first = await install();
    db.skillCatalogItem.findFirst.mockResolvedValue(null);
    await expect(install()).resolves.toEqual(first);
    expect(db.skillCatalogItem.findFirst).toHaveBeenCalledTimes(1);
    expect(db.projectSkillInstallation.create).toHaveBeenCalledTimes(1);
    expect(db.projectSkillState.updateMany).toHaveBeenCalledTimes(1);
    expect(db.projectSkillAudit.create).toHaveBeenCalledTimes(1);
  });
  it('replays the originally pinned version after a new incompatible version becomes latest', async () => {
    const { db, install, version } = setup();
    const first = await install();
    db.skillCatalogItem.findFirst.mockResolvedValue({
      id: 'skill',
      name: 'Fixture',
      latestPublishedVersion: {
        ...version,
        id: 'new-version',
        projectKinds: ['story'],
      },
    });
    await expect(install()).resolves.toEqual(first);
    expect(db.projectSkillInstallation.create).toHaveBeenCalledTimes(1);
  });
  it('still rejects a fresh install of an unavailable catalog entry', async () => {
    const { db, install } = setup();
    db.skillCatalogItem.findFirst.mockResolvedValue(null);
    await expect(install()).rejects.toMatchObject({
      response: { code: 'PROJECT_SKILL_NOT_FOUND' },
    });
    expect(db.projectSkillInstallation.create).not.toHaveBeenCalled();
  });
  it('checks current management permission before replay', async () => {
    const { install, permissions } = setup();
    await install();
    permissions.requireProjectRole.mockRejectedValue(new ForbiddenException());
    await expect(install()).rejects.toMatchObject({ status: 403 });
  });
  it('rejects another actor or payload even when the catalog is now unavailable', async () => {
    const { install, db, body } = setup();
    await install();
    db.skillCatalogItem.findFirst.mockResolvedValue(null);
    await expect(install('other')).rejects.toMatchObject({
      response: { code: 'PROJECT_SKILL_IDEMPOTENCY_CONFLICT' },
    });
    await expect(
      install('owner', { ...body, skillId: 'other-skill' }),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_SKILL_IDEMPOTENCY_CONFLICT' },
    });
  });
});
