import { ForbiddenException } from '@nestjs/common';
import { ProjectSkillsService } from './project-skills.service';

function setup() {
  let removed = false;
  let saved: Record<string, unknown> | null = null;
  const installation = {
    id: 'installation',
    skillId: 'skill',
    pinnedVersionId: 'version',
    revision: 0,
    status: 'active',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    activations: [],
    pinnedVersion: {
      id: 'version',
      version: '1.0.0',
      checksum: 'checksum',
      capabilities: [],
      projectKinds: [],
      workbenchModes: [],
    },
  };
  const db = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    projectSkillState: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    projectSkillInstallation: {
      findFirst: jest.fn(() => Promise.resolve(removed ? null : installation)),
      deleteMany: jest.fn(() => {
        removed = true;
        return Promise.resolve({ count: 1 });
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
    expectedRevision: 0,
    expectedProjectRevision: 0,
    idempotencyKey: 'same-key',
  };
  const remove = (userId = 'owner', input = body) =>
    service.uninstall({ userId }, 'platform', 'project', 'installation', input);
  return { db, permissions, body, remove };
}

describe('Skill uninstall response replay', () => {
  it('replays deletion without another lookup, revision bump or audit', async () => {
    const { db, remove } = setup();
    const first = await remove();
    await expect(remove()).resolves.toEqual(first);
    expect(first).toEqual({
      projectRevision: 1,
      installationId: 'installation',
      uninstalled: true,
    });
    expect(db.projectSkillInstallation.findFirst).toHaveBeenCalledTimes(1);
    expect(db.projectSkillInstallation.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.projectSkillState.updateMany).toHaveBeenCalledTimes(1);
    expect(db.projectSkillAudit.create).toHaveBeenCalledTimes(1);
  });
  it('requires current management permission before replay', async () => {
    const { permissions, remove } = setup();
    await remove();
    permissions.requireProjectRole.mockRejectedValue(new ForbiddenException());
    await expect(remove()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects reuse of the key by another actor', async () => {
    const { remove } = setup();
    await remove();
    await expect(remove('other')).rejects.toMatchObject({
      response: { code: 'PROJECT_SKILL_IDEMPOTENCY_CONFLICT' },
    });
  });
  it('rejects reuse of the key with another request', async () => {
    const { remove, body } = setup();
    await remove();
    await expect(
      remove('owner', { ...body, expectedRevision: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_SKILL_IDEMPOTENCY_CONFLICT' },
    });
  });
});
