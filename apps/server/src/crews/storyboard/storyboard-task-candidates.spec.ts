import { StoryboardChildrenService } from './storyboard-children.service';

describe('Storyboard task picker', () => {
  function fixture() {
    const tasks = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ id: 'parent' })
        .mockResolvedValueOnce({ parentId: 'ancestor' })
        .mockResolvedValueOnce({ parentId: null }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'task', title: 'Existing shot', number: 3, metadata: null },
        {
          id: 'linked',
          title: 'Linked shot',
          number: 4,
          metadata: { plotTreeNodeId: 'other' },
        },
        {
          id: 'imported',
          title: 'Imported shot',
          number: 5,
          metadata: {
            canvasTaskImport: 'another-project',
            sourceNodeId: 'scene',
          },
        },
      ]),
    };
    const project = {
      requireProjectRole: jest.fn().mockResolvedValue(undefined),
    };
    const authorization = { require: jest.fn().mockResolvedValue(undefined) };
    const service = new StoryboardChildrenService(
      {
        platformProject: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ studioCrew: { id: 'crew' } }),
        },
        crewTask: tasks,
      } as never,
      {} as never,
      project as never,
      authorization as never,
    );
    return { service, tasks, project, authorization };
  }
  it('requires task management and scopes search to live tasks in the project Crew', async () => {
    const f = fixture();
    const result = await f.service.candidates('project', 'user', { q: 'shot' });
    expect(f.authorization.require).toHaveBeenCalledWith(
      'crew',
      'user',
      'tasks.manage',
    );
    expect(f.tasks.findMany).toHaveBeenCalledWith({
      where: {
        crewId: 'crew',
        deletedAt: null,
        id: { notIn: ['parent', 'ancestor'] },
        title: { contains: 'shot', mode: 'insensitive' },
      },
      select: { id: true, title: true, number: true, metadata: true },
      orderBy: { id: 'asc' },
      take: 51,
    });
    expect(result).toEqual({
      items: [{ id: 'task', title: 'Existing shot', number: 3 }],
      nextCursor: null,
    });
  });
  it('does not query candidates for an unauthorized viewer', async () => {
    const f = fixture();
    f.authorization.require.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(
      f.service.candidates('project', 'viewer', { q: '' }),
    ).rejects.toThrow('Forbidden');
    expect(f.tasks.findMany).not.toHaveBeenCalled();
  });
  it('advances pagination even when every task on a page is already linked', async () => {
    const f = fixture();
    f.tasks.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({
        id: `task-${i}`,
        title: 'Linked',
        number: i,
        metadata: { plotTreeNodeId: 'node' },
      })),
    );
    const result = await f.service.candidates('project', 'user', {
      q: '',
      cursor: 'previous',
    });
    expect(result).toEqual({ items: [], nextCursor: 'task-49' });
  });
});
