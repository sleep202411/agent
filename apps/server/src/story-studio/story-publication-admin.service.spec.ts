import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AdminActor } from '../admin-auth';
import { StoryPublicationAdminService } from './story-publication-admin.service';

let mockCell = 'com';
jest.mock('../common/region/current-cell', () => ({
  get CURRENT_CELL() {
    return mockCell;
  },
}));

const GAME_ID = crypto.randomUUID();
const admin = {
  id: 'reviewer',
  siteScope: 'global',
  permissions: ['ip.moderate'],
} as AdminActor;

describe('StoryPublicationAdminService', () => {
  const read = jest.fn();
  const getReviewListing = jest.fn();
  const service = new StoryPublicationAdminService(
    { read } as never,
    { getReviewListing } as never,
  );
  beforeEach(() => {
    mockCell = 'com';
    read.mockReset().mockResolvedValue({
      gameId: GAME_ID,
      status: 'reviewing',
      draftVersion: 'candidate-v2',
      currentVersion: 'approved-v1',
    });
    getReviewListing.mockReset().mockResolvedValue({
      gameId: GAME_ID,
      description: 'Frozen candidate introduction',
    });
  });

  it('reads the frozen candidate in review, independently of the public release', async () => {
    await expect(
      service.listing(admin, GAME_ID, 'candidate-v2'),
    ).resolves.toEqual({
      contentVersion: 'candidate-v2',
      listing: {
        gameId: GAME_ID,
        description: 'Frozen candidate introduction',
      },
    });
    expect(getReviewListing).toHaveBeenCalledWith(GAME_ID, 'candidate-v2');
  });

  it.each(['draft', 'reviewing'] as const)(
    'refuses a current or historical version while status is %s',
    async (status) => {
      read.mockResolvedValue({
        gameId: GAME_ID,
        status,
        draftVersion: 'candidate-v2',
        currentVersion: 'approved-v1',
      });
      await expect(
        service.listing(admin, GAME_ID, 'approved-v1'),
      ).rejects.toThrow(ConflictException);
      expect(getReviewListing).not.toHaveBeenCalled();
    },
  );

  it.each(['published', 'offline'] as const)(
    'binds status %s to the currently approved version',
    async (status) => {
      read.mockResolvedValue({
        gameId: GAME_ID,
        status,
        draftVersion: 'candidate-v2',
        currentVersion: 'approved-v1',
      });
      await expect(
        service.listing(admin, GAME_ID, 'approved-v1'),
      ).resolves.toMatchObject({ contentVersion: 'approved-v1' });
      await expect(
        service.listing(admin, GAME_ID, 'candidate-v2'),
      ).rejects.toThrow(ConflictException);
    },
  );

  it('can inspect the withdrawn first candidate when no published version exists', async () => {
    read.mockResolvedValue({
      gameId: GAME_ID,
      status: 'offline',
      draftVersion: 'candidate-v2',
      currentVersion: null,
    });
    await expect(
      service.listing(admin, GAME_ID, 'candidate-v2'),
    ).resolves.toMatchObject({ contentVersion: 'candidate-v2' });
  });

  it('distinguishes a missing historical snapshot from an upstream failure', async () => {
    getReviewListing.mockResolvedValue(null);
    await expect(
      service.listing(admin, GAME_ID, 'candidate-v2'),
    ).resolves.toEqual({ contentVersion: 'candidate-v2', listing: null });
    read.mockRejectedValue(new Error('Java publication unavailable'));
    await expect(
      service.listing(admin, GAME_ID, 'candidate-v2'),
    ).rejects.toThrow('Java publication unavailable');
  });

  it('does not read local snapshots for missing Java publications', async () => {
    read.mockResolvedValue(null);
    await expect(
      service.listing(admin, GAME_ID, 'candidate-v2'),
    ).rejects.toThrow(NotFoundException);
    expect(getReviewListing).not.toHaveBeenCalled();
  });

  it('does not read local snapshots when the Java candidate changed', async () => {
    await expect(service.listing(admin, GAME_ID, 'stale-v1')).rejects.toThrow(
      ConflictException,
    );
    expect(getReviewListing).not.toHaveBeenCalled();
  });

  it.each(['com', 'global', 'cn'])(
    'enforces the admin account site scope on the %s cell',
    async (currentCell) => {
      mockCell = currentCell;
      const allowed = currentCell === 'cn' ? 'cn' : 'global';
      const denied = currentCell === 'cn' ? 'global' : 'cn';
      await expect(
        service.listing(
          { ...admin, siteScope: denied },
          GAME_ID,
          'candidate-v2',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(read).not.toHaveBeenCalled();
      await expect(
        service.listing(
          { ...admin, siteScope: allowed },
          GAME_ID,
          'candidate-v2',
        ),
      ).resolves.toMatchObject({ contentVersion: 'candidate-v2' });
    },
  );

  it('permits an all-sites administrator in either cell', async () => {
    mockCell = 'cn';
    await expect(
      service.listing({ ...admin, siteScope: 'all' }, GAME_ID, 'candidate-v2'),
    ).resolves.toMatchObject({ contentVersion: 'candidate-v2' });
  });
});
