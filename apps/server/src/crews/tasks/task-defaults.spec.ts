import { defaultCrewTaskView } from './task-defaults';

describe('Crew default task layout', () => {
  it('creates a Board system view without changing grouping or completed-task visibility', () => {
    const view = defaultCrewTaskView('crew-1', 'user-1');
    expect(view).toMatchObject({
      crewId: 'crew-1',
      createdByUserId: 'user-1',
      layout: 'board',
      groupBy: 'status',
      isSystem: true,
      completedMode: 'all',
    });
    expect(view.visibleFields).toContain('dueAt');
  });
});
