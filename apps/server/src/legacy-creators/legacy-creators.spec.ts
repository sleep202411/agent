import { BadRequestException } from '@nestjs/common';
import { LegacyCreatorsController } from './legacy-creators.controller';
import { LegacyCreatorsService } from './legacy-creators.service';

jest.mock('../users/avatar', () => ({
  resolveUserAvatar: jest
    .fn()
    .mockResolvedValue('https://example.com/avatar.png'),
}));

function fixture(total = 75) {
  const legacy = {
    queryOne: jest.fn().mockResolvedValue({ total }),
    query: jest.fn().mockResolvedValue([
      {
        id: '9007199254740993',
        nick_name: 'Creator',
        avatar: null,
        jobseeking: 1,
      },
    ]),
  };
  const service = new LegacyCreatorsService(legacy as never);
  return { legacy, service, controller: new LegacyCreatorsController(service) };
}

describe('Public creator availability filter', () => {
  it('traverses public identities with bound lexical cursors and bounded pages', async () => {
    const { legacy, service } = fixture();
    await service.publicCreatorPage(null);
    expect(legacy.query).toHaveBeenLastCalledWith(
      expect.stringContaining('LIMIT 500'),
      [],
    );
    await service.publicCreatorPage('9007199254740993');
    expect(legacy.query).toHaveBeenLastCalledWith(
      expect.stringContaining('COLLATE utf8mb4_bin > ?'),
      ['9007199254740993'],
    );
    await expect(service.publicCreatorPage("1' OR 1=1")).rejects.toThrow(
      'cursor',
    );
    expect(legacy.query).toHaveBeenCalledTimes(2);
  });

  it('binds creator-batch identifiers and rejects coerced or unrequested IDs', async () => {
    const { legacy, service } = fixture();
    legacy.query.mockResolvedValueOnce([
      { id: '0', nick_name: 'Wrong identity', avatar: null, jobseeking: 0 },
      {
        id: '9007199254740993',
        nick_name: 'Creator',
        avatar: null,
        jobseeking: 1,
      },
    ]);
    const ids = ['not-a-number', '9007199254740993', "1') OR 1=1 --"];
    const result = await service.publicCreatorBatch(ids);
    expect(result.map((row) => row.id)).toEqual(['9007199254740993']);
    expect(legacy.query).toHaveBeenCalledWith(
      expect.stringContaining('id IN (?,?,?)'),
      ids,
    );
    const calls = legacy.query.mock.calls as unknown as [string, string[]][];
    expect(calls[0][0]).not.toContain(ids[2]);
  });

  it('bounds lookup batches and skips empty lookups', async () => {
    const { legacy, service } = fixture();
    expect(await service.publicCreatorBatch([])).toEqual([]);
    await expect(
      service.publicCreatorBatch(Array.from({ length: 501 }, () => '1')),
    ).rejects.toThrow('500');
    expect(legacy.query).not.toHaveBeenCalled();
  });
  it('filters count and rows before pagination, preserving string IDs', async () => {
    const { legacy, controller } = fixture();
    const result = await controller.list(undefined, '20', '40', 'true');
    expect(legacy.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('AND jobseeking = 1'),
    );
    expect(legacy.query).toHaveBeenCalledWith(
      expect.stringContaining('AND jobseeking = 1'),
    );
    expect(legacy.query).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT 10 OFFSET 40'),
    );
    expect(result.data.items[0]).toMatchObject({
      id: '9007199254740993',
      openToWork: true,
    });
  });

  it.each([undefined, 'false'])(
    'preserves unfiltered browsing for %s',
    async (filter) => {
      const { legacy, controller } = fixture();
      await controller.list(undefined, '20', '0', filter);
      expect(legacy.queryOne).not.toHaveBeenCalledWith(
        expect.stringContaining('AND jobseeking'),
      );
      expect(legacy.query).not.toHaveBeenCalledWith(
        expect.stringContaining('AND jobseeking'),
      );
    },
  );

  it('retains the guest cap with the filtered total', async () => {
    const { legacy, controller } = fixture(70);
    const result = await controller.list(undefined, '20', '50', 'true');
    expect(result.data).toEqual({ items: [], total: 70, requiresLogin: true });
    expect(legacy.query).not.toHaveBeenCalled();
  });

  it('allows authenticated pagination beyond the guest cap', async () => {
    const { legacy, service } = fixture();
    await service.listCreators({
      limit: 20,
      offset: 50,
      authenticated: true,
      availableForWork: true,
    });
    expect(legacy.query).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT 20 OFFSET 50'),
    );
  });

  it.each(['1', 'yes', '', 'true OR 1=1'])(
    'rejects invalid filter %s before querying',
    async (filter) => {
      const { legacy, controller } = fixture();
      await expect(
        controller.list(undefined, '20', '0', filter),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(legacy.queryOne).not.toHaveBeenCalled();
      expect(legacy.query).not.toHaveBeenCalled();
    },
  );
});
