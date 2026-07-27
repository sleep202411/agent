import { StoryProjectVideoLibraryController } from './story-project-video-library.controller';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const MEDIA_ASSET_ID = '0197f4a2-0800-7000-8000-000000000003';

describe('StoryProjectVideoLibraryController', () => {
  it('starts async finalization and returns HTTP/code 202 while queued', async () => {
    const item = {
      mediaAssetId: MEDIA_ASSET_ID,
      status: 'queued',
      pollAfterMs: 1500,
      item: null,
      error: null,
    };
    const response = { status: jest.fn() };
    const service = { completeUpload: jest.fn().mockResolvedValue(item) };
    const controller = new StoryProjectVideoLibraryController(service as never);

    await expect(
      controller.completeUpload(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID },
        { mediaAssetId: MEDIA_ASSET_ID },
        response as never,
      ),
    ).resolves.toEqual({ code: 202, data: item });
    expect(response.status).toHaveBeenCalledWith(202);
    expect(service.completeUpload).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      { mediaAssetId: MEDIA_ASSET_ID },
    );
  });

  it('returns the polling status resource in a stable envelope', async () => {
    const data = {
      mediaAssetId: MEDIA_ASSET_ID,
      status: 'processing',
      pollAfterMs: 1500,
      item: null,
      error: null,
    };
    const service = { getUploadFinalize: jest.fn().mockResolvedValue(data) };
    const controller = new StoryProjectVideoLibraryController(service as never);

    await expect(
      controller.getUploadFinalize(USER as never, WORKSPACE_ID, {
        projectId: PROJECT_ID,
        mediaAssetId: MEDIA_ASSET_ID,
      }),
    ).resolves.toEqual({ code: 200, data });
  });
});
