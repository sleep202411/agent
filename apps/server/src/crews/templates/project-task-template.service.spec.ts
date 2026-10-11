jest.mock('../tasks/task-delivery-folder', () => ({
  provisionTaskDeliveryFolderTx: jest.fn().mockResolvedValue('folder'),
}));
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CrewProductionKind, type Prisma } from '@prisma/client';
import { ProjectTaskTemplateService } from './project-task-template.service';
import { DEFAULT_SERIES_TASK_TEMPLATE } from './project-task-template.types';

describe('ProjectTaskTemplateService', () => {
  let service: ProjectTaskTemplateService;
  const makePrisma = () => ({ projectTaskTemplate: { findFirst: jest.fn() } });
  const makeTx = () => ({
    $queryRaw: jest.fn((): Promise<unknown[]> => Promise.resolve([])),
    $executeRaw: jest.fn(),
    crewTask: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    crewTaskWorkflowState: { findFirst: jest.fn() },
    crewEpisode: { findFirst: jest.fn() },
    crewTaskDependency: { create: jest.fn() },
    projectTaskTemplate: { findFirst: jest.fn() },
  });
  let mockPrisma: ReturnType<typeof makePrisma>;
  let mockTx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    mockPrisma = makePrisma();
    service = new ProjectTaskTemplateService(mockPrisma as never);
    mockTx = makeTx();
  });

  describe('resolveActiveTemplate', () => {
    it('returns db template if present', async () => {
      const dbTemplate = {
        id: 'tmpl-1',
        projectType: CrewProductionKind.series,
        name: 'Custom series',
        version: 2,
        active: true,
        definition: DEFAULT_SERIES_TASK_TEMPLATE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.projectTaskTemplate.findFirst.mockResolvedValue(dbTemplate);

      const result = await service.resolveActiveTemplate(
        CrewProductionKind.series,
      );
      expect(result).toBe(dbTemplate);
      expect(mockPrisma.projectTaskTemplate.findFirst).toHaveBeenCalledWith({
        where: { projectType: CrewProductionKind.series, active: true },
        orderBy: { version: 'desc' },
      });
    });

    it('falls back to default series template if db record not found', async () => {
      mockPrisma.projectTaskTemplate.findFirst.mockResolvedValue(null);

      const result = await service.resolveActiveTemplate(
        CrewProductionKind.series,
      );
      expect(result).not.toBeNull();
      expect(result?.projectType).toBe(CrewProductionKind.series);
      expect(result?.name).toBe('短剧全流程标准模板');
      expect(result?.version).toBe(1);
    });

    it('returns null for non-series kind if db record not found', async () => {
      mockPrisma.projectTaskTemplate.findFirst.mockResolvedValue(null);

      const result = await service.resolveActiveTemplate(
        CrewProductionKind.interactive_film,
      );
      expect(result).toBeNull();
    });
  });

  describe('instantiateTasks', () => {
    const mockTemplate = {
      id: '01990000-0000-7000-8000-000000000001',
      projectType: CrewProductionKind.series,
      name: '短剧全流程标准模板',
      version: 1,
      active: true,
      definition: DEFAULT_SERIES_TASK_TEMPLATE,
    };

    it('instantiates 6 tasks for series crew with correct metadata and dependencies', async () => {
      mockTx.crewTask.findMany.mockResolvedValue([]); // No existing tasks
      mockTx.crewTaskWorkflowState.findFirst.mockResolvedValue({
        id: 'wf-open-1',
        systemKey: 'open',
      });
      mockTx.crewEpisode.findFirst.mockResolvedValue({ id: 'ep-1' });
      mockTx.crewTask.findFirst.mockResolvedValue(null); // No prior task

      mockTx.crewTask.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...data }),
      );
      mockTx.crewTaskDependency.create.mockResolvedValue({});

      const createdTasks = await service.instantiateTasks(
        mockTx as unknown as Prisma.TransactionClient,
        'crew-1',
        mockTemplate as unknown as Parameters<
          typeof service.instantiateTasks
        >[2],
        {
          idempotencyKey: 'crew-1',
          userId: 'user-creator',
        },
      );

      expect(createdTasks).toHaveLength(12);
      expect(mockTx.crewTask.create).toHaveBeenCalledTimes(12);

      // Verify metadata on tasks
      for (const task of createdTasks) {
        expect(task.metadata).toMatchObject({
          templateId: mockTemplate.id,
          templateVersion: 1,
          idempotencyKey: 'crew-1',
        });
        expect(
          (task.metadata as Record<string, unknown>).templateKey,
        ).toBeDefined();
      }

      // Verify dependencies were created
      expect(mockTx.crewTaskDependency.create).toHaveBeenCalled();
    });

    it('returns existing tasks and creates 0 new tasks on duplicate call (idempotency)', async () => {
      const existingTasks = [
        {
          id: 'task-1',
          crewId: 'crew-1',
          number: 1,
          title: '剧本',
          metadata: {
            templateId: mockTemplate.id,
            templateVersion: 1,
            templateKey: 'script',
          },
        },
      ];
      mockTx.crewTask.findMany.mockResolvedValue(existingTasks);

      const result = await service.instantiateTasks(
        mockTx as unknown as Prisma.TransactionClient,
        'crew-1',
        mockTemplate as unknown as Parameters<
          typeof service.instantiateTasks
        >[2],
        {
          idempotencyKey: 'crew-1',
        },
      );

      expect(result).toEqual(existingTasks);
      expect(mockTx.crewTask.create).not.toHaveBeenCalled();
      expect(mockTx.crewTaskDependency.create).not.toHaveBeenCalled();
    });
  });
});
