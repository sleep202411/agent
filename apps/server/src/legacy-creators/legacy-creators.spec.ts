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
