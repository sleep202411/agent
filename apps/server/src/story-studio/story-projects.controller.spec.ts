import { StoryProjectsController } from './story-projects.controller';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000003';
const MEDIA_ASSET_ID = '0197f4a2-0800-7000-8000-000000000004';

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

  it('reads the project-wide production canvas without chapter context', async () => {
    const canvas = {
      projectId: PROJECT_ID,
      schemaVersion: 'story-production-canvas-v2',
      content: { nodes: [], edges: [], assets: [], groups: [] },
    };
    const service = {
      getProductionCanvas: jest.fn().mockResolvedValue(canvas),
    };
    const controller = new StoryProjectsController(service as never);

    await expect(
      controller.getProductionCanvas(USER as never, WORKSPACE_ID, {
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({ code: 200, data: canvas });
    expect(service.getProductionCanvas).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
    );
  });

  it('persists the complete project-wide production canvas document', async () => {
    const body = {
      schemaVersion: 'story-production-canvas-v2' as const,
      content: { nodes: [], edges: [], assets: [], groups: [] },
      sessionId: 'session-1',
    };
    const service = {
      putProductionCanvas: jest.fn().mockResolvedValue({
        projectId: PROJECT_ID,
        ...body,
      }),
    };
    const controller = new StoryProjectsController(service as never);

    await controller.putProductionCanvas(
      USER as never,
      WORKSPACE_ID,
      { projectId: PROJECT_ID },
      body,
    );
    expect(service.putProductionCanvas).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      body,
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
      controller.addCandidateAsset(USER as never, WORKSPACE_ID, params),
    ).resolves.toEqual({ code: 200, data: candidate });
    await expect(
      controller.removeCandidateAsset(USER as never, WORKSPACE_ID, params),
    ).resolves.toEqual({
      code: 200,
      data: { mediaAssetId: MEDIA_ASSET_ID },
    });
    expect(service.addCandidateAsset).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      MEDIA_ASSET_ID,
    );
    expect(service.removeCandidateAsset).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      MEDIA_ASSET_ID,
    );
  });
});

describe('StoryProjectsController shared-link workspace resolve', () => {
  /**
   * A shared project link carries no workspace, so this route must not take the
   * header every sibling route requires. Pinning the call shape keeps a later
   * "make it consistent" edit from reintroducing `requiredWorkspaceId` on the
   * one route that cannot have it.
   */
  it('resolves a project workspace without a workspace header', async () => {
    const service = {
      resolveWorkspace: jest.fn(() =>
        Promise.resolve({ workspaceId: WORKSPACE_ID }),
      ),
    };
    const controller = new StoryProjectsController(service as never);

    await expect(
      controller.resolveWorkspace(USER as never, { projectId: PROJECT_ID }),
    ).resolves.toEqual({ code: 200, data: { workspaceId: WORKSPACE_ID } });
    expect(service.resolveWorkspace).toHaveBeenCalledWith(USER, PROJECT_ID);
  });
});
