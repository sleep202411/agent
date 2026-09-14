import { StoryProjectsController } from './story-projects.controller';

const USER = { userId: 'user-1' };
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000003';
const MEDIA_ASSET_ID = '0197f4a2-0800-7000-8000-000000000004';

describe('StoryProjectsController list', () => {
  it('creates a Story project in its explicit workspace', async () => {
    const project = { id: PROJECT_ID, title: 'Moving Pictures' };
    const service = {
      create: jest.fn(() => Promise.resolve(project)),
    };
    const controller = new StoryProjectsController(service as never);
    const body = {
      workspaceId: '0197f4a2-0800-7000-8000-000000000001',
      title: 'Moving Pictures',
      summary: null,
      defaultLocale: 'en-US',
      visibility: 'private' as const,
    };

    await expect(controller.create(USER as never, body)).resolves.toEqual({
      code: 200,
      data: project,
    });
    expect(service.create).toHaveBeenCalledWith(USER, body);
  });

  it('lists projects in the explicit workspace', async () => {
    const page = { items: [], nextCursor: null };
    const service = {
      list: jest.fn(() => Promise.resolve(page)),
    };
    const controller = new StoryProjectsController(service as never);
    const query = {
      workspaceId: '0197f4a2-0800-7000-8000-000000000001',
      status: 'active' as const,
      limit: 20,
    };

    await expect(controller.list(USER as never, query)).resolves.toEqual({
      code: 200,
      data: page,
    });
    expect(service.list).toHaveBeenCalledWith(USER, query);
  });
});

describe('StoryProjectsController installed mobile clients', () => {
  const workspaceId = '0197f4a2-0800-7000-8000-000000000001';
  const body = {
    title: 'Story',
    defaultLocale: 'en-US',
    visibility: 'private' as const,
  };
  function fixture() {
    const service = {
      create: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue({ items: [] }),
    };
    return {
      service,
      controller: new StoryProjectsController(service as never),
    };
  }
  it('accepts the existing mobile header for creation', async () => {
    const { controller, service } = fixture();
    await controller.create(USER as never, body, workspaceId);
    expect(service.create).toHaveBeenCalledWith(USER, { ...body, workspaceId });
  });
  it('accepts the existing mobile header for listing', async () => {
    const { controller, service } = fixture();
    await controller.list(
      USER as never,
      { status: 'active', limit: 20 },
      workspaceId,
    );
    expect(service.list).toHaveBeenCalledWith(USER, {
      status: 'active',
      limit: 20,
      workspaceId,
    });
  });
  it('keeps an explicit workspace ahead of the UI header', async () => {
    const { controller, service } = fixture();
    await controller.create(
      USER as never,
      { ...body, workspaceId },
      PROJECT_ID,
    );
    expect(service.create).toHaveBeenCalledWith(USER, { ...body, workspaceId });
  });
  it.each([undefined, 'invalid'])(
    'rejects missing or malformed workspace identity (%s)',
    async (header) => {
      const { controller, service } = fixture();
      await expect(
        controller.create(USER as never, body, header),
      ).rejects.toMatchObject({ status: 400 });
      expect(service.create).not.toHaveBeenCalled();
    },
  );
});

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
        { projectId: PROJECT_ID },
        { title: 'A New Chapter' },
      ),
    ).resolves.toEqual({ code: 200, data: chapter });
    expect(service.createChapter).toHaveBeenCalledWith(USER, PROJECT_ID, {
      title: 'A New Chapter',
    });
  });

  it('passes the chapter id through the nested layout route', async () => {
    const layout = { projectId: PROJECT_ID, chapterId: CHAPTER_ID };
    const service = {
      getCanvasLayout: jest.fn(() => Promise.resolve(layout)),
    };
    const controller = new StoryProjectsController(service as never);
    const params = { projectId: PROJECT_ID, chapterId: CHAPTER_ID };

    await expect(
      controller.getChapterCanvasLayout(USER as never, params),
    ).resolves.toEqual({ code: 200, data: layout });
    expect(service.getCanvasLayout).toHaveBeenCalledWith(
      USER,
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
        { projectId: PROJECT_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: [] });
    expect(service.reorderChapters).toHaveBeenCalledWith(
      USER,
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
        { projectId: PROJECT_ID, chapterId: CHAPTER_ID },
        { title: 'A New Name' },
      ),
    ).resolves.toEqual({ code: 200, data: chapter });
    expect(service.patchChapter).toHaveBeenCalledWith(
      USER,
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
      controller.archiveChapter(USER as never, {
        projectId: PROJECT_ID,
        chapterId: CHAPTER_ID,
      }),
    ).resolves.toEqual({ code: 200, data: chapter });
    expect(service.archiveChapter).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      CHAPTER_ID,
    );
  });

  it('adds and removes candidate media at project scope', async () => {
    const candidate = { asset: { id: MEDIA_ASSET_ID, kind: 'video' } };
    const service = {
      addCandidateAsset: jest.fn().mockResolvedValue(candidate),
      removeCandidateAsset: jest
        .fn()
        .mockResolvedValue({ mediaAssetId: MEDIA_ASSET_ID }),
    };
    const controller = new StoryProjectsController(service as never);
    const params = { projectId: PROJECT_ID, mediaAssetId: MEDIA_ASSET_ID };

    await expect(
      controller.addCandidateAsset(USER as never, params),
    ).resolves.toEqual({ code: 200, data: candidate });
    await expect(
      controller.removeCandidateAsset(USER as never, params),
    ).resolves.toEqual({
      code: 200,
      data: { mediaAssetId: MEDIA_ASSET_ID },
    });
    expect(service.addCandidateAsset).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      MEDIA_ASSET_ID,
    );
    expect(service.removeCandidateAsset).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      MEDIA_ASSET_ID,
    );
  });
});
