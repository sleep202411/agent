import { BadRequestException } from '@nestjs/common';
import { ProjectSkillsResolver } from './project-skills.resolver';

const INSTALLATION_ID = '10000000-0000-7000-8000-000000000001';
const PROJECT_ID = '40000000-0000-7000-8000-000000000001';

function installedSkill() {
  return {
    id: INSTALLATION_ID,
    skillId: '11000000-0000-7000-8000-000000000001',
    pinnedVersionId: '20000000-0000-7000-8000-000000000001',
    config: {},
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    skill: { slug: 'ink-wash-cinema', name: 'Ink-wash Cinema' },
    pinnedVersion: {
      version: '1.0.0',
      checksum: 'a'.repeat(64),
      capabilities: ['image_generation', 'agent_prompt'],
      projectKinds: ['platform', 'story'],
      workbenchModes: [],
      instructions: 'Use controlled ink-wash direction.',
      generationPolicy: {
        image: { promptSuffix: 'Use controlled ink wash.' },
      },
      toolIds: [],
    },
    activations: [
      {
        defaultEnabled: true,
        scope: 'image_generation',
        workbenchMode: '',
        sourceSurface: '',
      },
    ],
  };
}

function harness(rows = [installedSkill()]) {
  const prisma = {
    projectSkillState: {
      findFirst: jest.fn().mockResolvedValue({ revision: 5 }),
    },
    projectSkillInstallation: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  return {
    prisma,
    resolver: new ProjectSkillsResolver(prisma as never),
  };
}

describe('ProjectSkillsResolver', () => {
  it('preserves project-default provenance when its inline chip is also selected', async () => {
    const { resolver } = harness();
    const snapshot = await resolver.resolve({
      ownerKind: 'platform',
      projectId: PROJECT_ID,
      scope: 'image_generation',
      sourceSurface: 'fizzstudio-canvas',
      selection: { includeInstallationIds: [INSTALLATION_ID] },
    });

    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0]?.source).toBe('project_default');
    expect(snapshot.projectRevision).toBe(5);
    expect(snapshot.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses an explicit exclusion to turn a project default off', async () => {
    const { resolver } = harness();
    const snapshot = await resolver.resolve({
      ownerKind: 'platform',
      projectId: PROJECT_ID,
      scope: 'image_generation',
      selection: { excludeInstallationIds: [INSTALLATION_ID] },
    });
    expect(snapshot.skills).toEqual([]);
  });

  it('queries the exact typed owner boundary and rejects guessed installation ids', async () => {
    const { resolver, prisma } = harness([]);
    await expect(
      resolver.resolve({
        ownerKind: 'story',
        projectId: PROJECT_ID,
        scope: 'image_generation',
        selection: { includeInstallationIds: [INSTALLATION_ID] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.projectSkillInstallation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storyProjectId: PROJECT_ID,
          platformProjectId: null,
          status: 'active',
        },
      }),
    );
  });
});
