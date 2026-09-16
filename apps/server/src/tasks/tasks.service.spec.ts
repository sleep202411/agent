import { ForbiddenException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import type { PrismaService } from '../infra/db/db.module';
import type { AiGenerationService } from '../ai-generation/ai-generation.service';
import type { AgentOsProjectContextService } from '../agent-os-gateway/agent-os-project-context.service';
import type { AuthUser } from '../auth';

const user = { userId: 'owner' } as AuthUser;
const at = new Date('2026-09-15T00:00:00Z');
const row = (id: string, status: string) => ({
  id,
  status,
  createdAt: at,
  updatedAt: at,
});
describe('recent task aggregation', () => {
  const prisma = {
    agentOsRun: { findMany: jest.fn() },
    storyAgentRun: { findMany: jest.fn() },
    storyBuild: { findMany: jest.fn() },
  };
  const ai = { listJobs: jest.fn() };
  const projects = { requireRead: jest.fn() };
  const service = new TasksService(
    prisma as unknown as PrismaService,
    ai as unknown as AiGenerationService,
    projects as unknown as AgentOsProjectContextService,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    ai.listJobs.mockResolvedValue({
      jobs: [
        {
          ...row('same', 'in_progress'),
          type: 'image',
          prompt: 'private prompt',
          output: 'private output',
        },
      ],
    });
    prisma.agentOsRun.findMany.mockResolvedValue([
      {
        ...row('same', 'waiting_for_approval'),
        projectId: 'story',
        projectKind: 'story',
        workbenchMode: 'story',
      },
    ]);
    prisma.storyAgentRun.findMany.mockResolvedValue([
      { ...row('same', 'succeeded'), storyProjectId: 'story' },
    ]);
    prisma.storyBuild.findMany.mockResolvedValue([
      { ...row('same', 'ready'), storyProjectId: 'story' },
    ]);
    projects.requireRead.mockResolvedValue({ projectKind: 'story' });
  });
  it('combines generation, Agent and production without identifier collisions or private payloads', async () => {
    const result = await new TasksController(service).list(user);
    expect(result.code).toBe(200);
    expect(result.data).toHaveLength(4);
    expect(new Set(result.data.map((x) => x.id)).size).toBe(4);
    expect(result.data.find((x) => x.type === 'agent')?.status).toBe('waiting');
    expect(result.data.every((x) => Object.keys(x.input).length === 0)).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain('private');
    expect(projects.requireRead).toHaveBeenCalledTimes(1);
  });
  it('uses only the authenticated actor and bounded deterministic queries', async () => {
    await service.list(user);
    expect(ai.listJobs).toHaveBeenCalledWith(user, { limit: '100' });
    for (const [model, where] of [
      [prisma.agentOsRun, { actorId: 'owner' }],
      [prisma.storyAgentRun, { initiatedByUserId: 'owner' }],
      [prisma.storyBuild, { createdByUserId: 'owner' }],
    ] as const) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          take: 100,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    }
    expect(projects.requireRead).toHaveBeenCalledWith('owner', 'story');
  });
  it('excludes records after project access is revoked', async () => {
    projects.requireRead.mockRejectedValue(new ForbiddenException());
    expect((await service.list(user)).map((x) => x.type)).toEqual(['image']);
  });
  it('does not present a database/authorization outage as an empty successful list', async () => {
    projects.requireRead.mockRejectedValue(new Error('database unavailable'));
    await expect(service.list(user)).rejects.toThrow('database unavailable');
  });
  it('excludes unsupported Agent protocol records and unknown states', async () => {
    prisma.agentOsRun.findMany.mockResolvedValue([
      {
        ...row('bad', 'running'),
        projectId: 'story',
        projectKind: null,
        workbenchMode: null,
      },
      {
        ...row('unknown', 'constructor'),
        projectId: 'story',
        projectKind: 'story',
        workbenchMode: 'story',
      },
    ]);
    expect((await service.list(user)).some((x) => x.type === 'agent')).toBe(
      false,
    );
  });
});
