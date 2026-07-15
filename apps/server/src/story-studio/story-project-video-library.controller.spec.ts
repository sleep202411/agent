import { StoryProjectVideoLibraryController } from './story-project-video-library.controller';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';

describe('StoryProjectVideoLibraryController', () => {
  it('returns the tenant-scoped cursor page envelope', async () => {
    const page = { items: [], nextCursor: null };
    const service = { list: jest.fn().mockResolvedValue(page) };
    const controller = new StoryProjectVideoLibraryController(service as never);

    await expect(
      controller.list(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID },
        { limit: 30 },
      ),
    ).resolves.toEqual({ code: 200, data: page });
    expect(service.list).toHaveBeenCalledWith(USER, WORKSPACE_ID, PROJECT_ID, {
      limit: 30,
    });
  });
});
