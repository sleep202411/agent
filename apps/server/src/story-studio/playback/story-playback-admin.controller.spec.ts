import 'reflect-metadata';
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSIONS_KEY } from '../../admin-auth/admin-auth.decorator';
import { AdminAuthGuard, AdminPermissionGuard } from '../../admin-auth';
import { StoryPlaybackAdminController } from './story-playback-admin.controller';

const GAME_ID = '019f60f4-b101-70d4-8000-000000000002';
const admin = { id: 'admin-1' } as never;
const request = {
  ip: '10.0.0.1',
  headers: { 'user-agent': 'jest' },
} as never;

function harness() {
  const playback = {
    overview: jest.fn().mockResolvedValue({ games: [] }),
    retryFailed: jest.fn().mockResolvedValue({
      gameId: GAME_ID,
      version: 'v2',
      requeued: [{ assetId: 'a', jobId: 'j' }],
      refused: [
        { assetId: 'b', reason: 'x' },
        { assetId: 'c', reason: 'y' },
      ],
    }),
    reconcileNow: jest.fn().mockResolvedValue({
      outcome: 'completed',
      run: {
        status: 'failed',
        stats: {
          cataloguePages: 1,
          catalogueGames: 2,
          enqueued: 3,
          expired: 1,
        },
      },
    }),
  };
  const adminAuth = { writeAudit: jest.fn().mockResolvedValue(undefined) };
  return {
    controller: new StoryPlaybackAdminController(
      playback as never,
      adminAuth as never,
    ),
    playback,
    adminAuth,
  };
}

function pipeOf(
  method: keyof StoryPlaybackAdminController,
  index: number,
): PipeTransform<unknown, unknown> {
  const parameters = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    StoryPlaybackAdminController,
    method,
  ) as Record<
    string,
    { index: number; pipes: PipeTransform<unknown, unknown>[] }
  >;
  return Object.values(parameters).find((param) => param.index === index)!
    .pipes[0];
}

describe('StoryPlaybackAdminController', () => {
  it('guards every route behind the admin session and ip.moderate', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StoryPlaybackAdminController),
    ).toEqual([AdminAuthGuard, AdminPermissionGuard]);
    for (const method of ['overview', 'retryFailed', 'reconcile'] as const) {
      expect(
        Reflect.getMetadata(
          ADMIN_PERMISSIONS_KEY,
          StoryPlaybackAdminController.prototype[method],
        ),
      ).toEqual(['ip.moderate']);
    }
  });

  it('validates the overview query', () => {
    const pipe = pipeOf('overview', 0);
    expect(
      pipe.transform(
        { gameIds: ` ${GAME_ID},jinling-legacy,${GAME_ID} ` },
        { type: 'query' },
      ),
    ).toEqual({ gameIds: [GAME_ID, 'jinling-legacy'] });
    expect(() =>
      pipe.transform(
        { gameIds: `${GAME_ID},jinling-legacy`, include: 'clips' },
        { type: 'query' },
      ),
    ).toThrow(BadRequestException);
    expect(() => pipe.transform({ gameIds: ',' }, { type: 'query' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      pipe.transform(
        { gameIds: Array.from({ length: 101 }, (_, i) => `g${i}`).join(',') },
        { type: 'query' },
      ),
    ).toThrow(BadRequestException);
  });

  it('takes a UUID game id and no body', () => {
    expect(() =>
      pipeOf('retryFailed', 1).transform(
        { gameId: 'jinling-legacy' },
        { type: 'param' },
      ),
    ).toThrow(BadRequestException);
    const body = pipeOf('retryFailed', 2);
    expect(body.transform(undefined, { type: 'body' })).toEqual({});
    expect(() => body.transform({ force: true }, { type: 'body' })).toThrow(
      BadRequestException,
    );
  });

  it('wraps the overview in the admin envelope', async () => {
    const h = harness();
    await expect(
      h.controller.overview({ gameIds: [GAME_ID] }),
    ).resolves.toEqual({ code: 200, data: { games: [] } });
  });

  it('audits a retry with its counts', async () => {
    const h = harness();

    const response = await h.controller.retryFailed(
      admin,
      { gameId: GAME_ID },
      {},
      request,
    );

    expect(response.code).toBe(200);
    expect(h.playback.retryFailed).toHaveBeenCalledWith(GAME_ID);
    expect(h.adminAuth.writeAudit).toHaveBeenCalledWith({
      actor: admin,
      action: 'admin.interactive_film.hls.retry_failed',
      resourceType: 'interactive_film_playback',
      resourceId: GAME_ID,
      metadata: { gameId: GAME_ID, version: 'v2', requeued: 1, refused: 2 },
      context: { ipAddress: '10.0.0.1', userAgent: 'jest' },
    });
  });

  it('audits a reconcile with its outcome', async () => {
    const h = harness();

    await h.controller.reconcile(admin, {}, request);

    expect(h.adminAuth.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.interactive_film.hls.reconcile',
        metadata: {
          outcome: 'completed',
          status: 'failed',
          enqueued: 3,
          expired: 1,
        },
      }),
    );
  });
});
