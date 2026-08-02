import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createAlibaba } from '@ai-sdk/alibaba';
import { generateObject } from 'ai';
import { CrewTaskDraftService } from './task-draft.service';

jest.mock('@ai-sdk/alibaba', () => ({
  createAlibaba: jest.fn(() => jest.fn(() => 'task-draft-model')),
}));
jest.mock('ai', () => ({ generateObject: jest.fn() }));

const mockedGenerateObject = generateObject as unknown as jest.Mock;
const mockedCreateAlibaba = createAlibaba as unknown as jest.Mock;

function firstCallArgument<T>(mockFn: { mock: { calls: unknown[][] } }): T {
  const value = mockFn.mock.calls.at(0)?.at(0);
  if (value === undefined) throw new Error('Expected the mock to be called.');
  return value as T;
}

describe('CrewTaskDraftService', () => {
  const previousApiKey = process.env.ALIBABA_API_KEY;
  const previousBaseUrl = process.env.ALIBABA_BASE_URL;

  const prisma = {
    crewMember: { findMany: jest.fn() },
    crewTask: { findMany: jest.fn() },
    crewTaskCycle: { findMany: jest.fn() },
  };
  const authorization = { require: jest.fn() };
  const service = new CrewTaskDraftService(
    prisma as never,
    authorization as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ALIBABA_API_KEY = 'test-task-draft-key';
    delete process.env.ALIBABA_BASE_URL;
    authorization.require.mockResolvedValue(undefined);
    prisma.crewMember.findMany.mockResolvedValue([
      { userId: 'owner-1' },
      { userId: 'member-1' },
    ]);
    prisma.crewTask.findMany.mockResolvedValue([
      { id: 'task-10', number: 10, title: 'Storyboard SC.010' },
      { id: 'task-20', number: 20, title: 'Animate SC.010' },
    ]);
    prisma.crewTaskCycle.findMany.mockResolvedValue([
      { id: 'cycle-current', name: 'Iteration 1', status: 'active' },
    ]);
  });

  afterAll(() => {
    if (previousApiKey === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = previousApiKey;
    if (previousBaseUrl === undefined) delete process.env.ALIBABA_BASE_URL;
    else process.env.ALIBABA_BASE_URL = previousBaseUrl;
  });

  it('returns a validated draft and discards model references outside crew context', async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        title: '  完成 SC.010 动画  ',
        description: '交付可审核版本。',
        priority: null,
        startDate: '2026-02-30',
        dueDate: '2026-08-10',
        estimatePoints: -2,
        computeBudgetPoints: 2_000_000_000,
        revisionLimit: 120,
        cycleId: 'cycle-outside-crew',
        parentTaskNumber: 10,
        blockedByTaskNumbers: [20, 20, 999],
        assigneeUserIds: ['member-1', 'member-1', 'outsider-1'],
        questions: ['  请确认素材版本。  ', ''],
      },
    });

    const result = await service.draft('crew-1', 'owner-1', {
      prompt: '请让小林在 8 月 10 日前完成 SC.010 动画。',
      locale: 'zh-CN',
      timeZone: 'Asia/Shanghai',
      memberHints: [
        { userId: 'member-1', displayName: '小林' },
        { userId: 'outsider-1', displayName: '外部用户' },
      ],
    });

    expect(authorization.require).toHaveBeenCalledWith(
      'crew-1',
      'owner-1',
      'tasks.manage',
    );
    expect(mockedCreateAlibaba).toHaveBeenCalledWith({
      apiKey: 'test-task-draft-key',
    });
    expect(mockedGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'task-draft-model' }),
    );
    const prompt = firstCallArgument<{ prompt: string }>(
      mockedGenerateObject,
    ).prompt;
    expect(prompt).toContain('"displayName":"小林"');
    expect(prompt).not.toContain('外部用户');
    expect(result).toEqual({
      title: '完成 SC.010 动画',
      description: '交付可审核版本。',
      priority: 'normal',
      startDate: null,
      dueDate: '2026-08-10',
      estimatePoints: 0,
      computeBudgetPoints: 1_000_000_000,
      revisionLimit: 100,
      cycleId: null,
      parentId: 'task-10',
      blockedByTaskIds: ['task-20'],
      assigneeUserIds: ['member-1'],
      questions: ['请确认素材版本。', '请确认任务开始日期。'],
    });
  });

  it('fails loudly when AI task drafting is not configured', async () => {
    delete process.env.ALIBABA_API_KEY;

    await expect(
      service.draft('crew-1', 'owner-1', {
        prompt: 'Create a storyboard task.',
        locale: 'en-US',
        timeZone: 'UTC',
        memberHints: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedGenerateObject).not.toHaveBeenCalled();
  });

  it('surfaces the upstream model failure instead of returning a fake draft', async () => {
    mockedGenerateObject.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.draft('crew-1', 'owner-1', {
        prompt: 'Create a storyboard task.',
        locale: 'en-US',
        timeZone: 'UTC',
        memberHints: [],
      }),
    ).rejects.toThrow(
      new BadGatewayException('AI task drafting failed: provider unavailable'),
    );
  });
});
