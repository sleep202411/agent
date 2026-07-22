import { StoryProjectsController } from './story-projects.controller';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000003';

describe('StoryProjectsController chapters', () => {
  it('creates a chapter inside the tenant-scoped project', async () => {
    const chapter = {
      id: CHAPTER_ID,
      projectId: PROJECT_ID,
      title: 'Chapter 2',
    };
    const service = {
      createChapter: jest.fn(() => Promise.resolve(chapter)),
    };
    const controller = new StoryProjectsController(service as never);

    await expect(
      controller.createChapter(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID },
        { title: 'A New Chapter' },
      ),
    ).resolves.toEqual({ code: 200, data: chapter });
    expect(service.createChapter).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      { title: 'A New Chapter' },
    );
  });

  it('passes the chapter id through the nested layout route', async () => {
    const layout = { projectId: PROJECT_ID, chapterId: CHAPTER_ID };
    const service = {
      getCanvasLayout: jest.fn(() => Promise.resolve(layout)),
    };
    const controller = new StoryProjectsController(service as never);
    const params = { projectId: PROJECT_ID, chapterId: CHAPTER_ID };

    await expect(
      controller.getChapterCanvasLayout(USER as never, WORKSPACE_ID, params),
    ).resolves.toEqual({ code: 200, data: layout });
    expect(service.getCanvasLayout).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      CHAPTER_ID,
    );
  });

  it('passes the complete active order to the chapter service', async () => {
    const chapterIds = [CHAPTER_ID, '0197f4a2-0800-7000-8000-000000000004'];
    const body = { expectedProjectVersion: 4, chapterIds };
    const service = {
      reorderChapters: jest.fn(() => Promise.resolve([])),
    };
    const controller = new StoryProjectsController(service as never);

    await expect(
      controller.reorderChapters(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: [] });
    expect(service.reorderChapters).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      body,
    );
  });

  it('renames a chapter without a chapter-version token', async () => {
    const chapter = { id: CHAPTER_ID, title: 'A New Name' };
    const service = {
      patchChapter: jest.fn(() => Promise.resolve(chapter)),
    };
    const controller = new StoryProjectsController(service as never);

    await expect(
      controller.patchChapter(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID, chapterId: CHAPTER_ID },
        { title: 'A New Name' },
      ),
    ).resolves.toEqual({ code: 200, data: chapter });
    expect(service.patchChapter).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      CHAPTER_ID,
      { title: 'A New Name' },
    );
  });

  it('archives a chapter without a request body', async () => {
    const chapter = { id: CHAPTER_ID, archivedAt: new Date().toISOString() };
    const service = {
      archiveChapter: jest.fn(() => Promise.resolve(chapter)),
    };
    const controller = new StoryProjectsController(service as never);

    await expect(
      controller.archiveChapter(USER as never, WORKSPACE_ID, {
        projectId: PROJECT_ID,
        chapterId: CHAPTER_ID,
      }),
    ).resolves.toEqual({ code: 200, data: chapter });
    expect(service.archiveChapter).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      CHAPTER_ID,
    );
  });
});
