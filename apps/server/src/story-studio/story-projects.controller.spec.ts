import { STORY_CANVAS_LAYOUT_SCHEMA_VERSION } from './dto';
import { StoryProjectsController } from './story-projects.controller';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const NOW = '2026-07-12T12:00:00.000Z';

describe('StoryProjectsController canvas layout', () => {
  const layout = {
    projectId: PROJECT_ID,
    schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
    nodePositions: { __story_root__: { x: -500, y: 120 } },
    revision: 2,
    updatedByUserId: USER.userId,
    updatedBySessionId: 'canvas-session',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('returns the tenant-scoped layout envelope', async () => {
    const service = {
      getCanvasLayout: jest.fn(() => Promise.resolve(layout)),
    };
    const controller = new StoryProjectsController(service as never);

    await expect(
      controller.getCanvasLayout(USER as never, WORKSPACE_ID, {
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({ code: 200, data: layout });
    expect(service.getCanvasLayout).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
    );
  });

  it('passes the validated CAS body to the layout service', async () => {
    const service = {
      putCanvasLayout: jest.fn(() => Promise.resolve(layout)),
    };
    const controller = new StoryProjectsController(service as never);
    const body = {
      expectedRevision: 1,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: layout.nodePositions,
      sessionId: 'canvas-session',
    };

    await expect(
      controller.putCanvasLayout(
        USER as never,
        WORKSPACE_ID,
        { projectId: PROJECT_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: layout });
    expect(service.putCanvasLayout).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      body,
    );
  });
});
