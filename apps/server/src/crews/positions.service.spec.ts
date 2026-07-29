import { BadRequestException } from '@nestjs/common';
import {
  ListCrewPositionsQuerySchema,
  ListPublicPositionsQuerySchema,
} from './dto';
import { PositionsService } from './positions.service';

const CREATED_AT = new Date('2026-07-29T12:00:00.000Z');

function position(id: string) {
  return {
    id,
    crewId: 'crew-1',
    positionType: 'storyboard',
    description: 'Design the storyboard.',
    targetCount: 2,
    recruitedCount: 0,
    status: 'open',
    workMode: 'remote',
    location: null,
    employmentType: 'project_based',
    experienceLevel: 'mid',
    requiredSkills: ['storyboard'],
    salaryPeriod: 'project',
    salaryCurrency: 'USD',
    salaryMinAmount: 10_000n,
    salaryMaxAmount: 20_000n,
    salaryNegotiable: false,
    durationMonths: 2,
    revenueShareBp: null,
    closeDate: null,
    createdAt: CREATED_AT,
    deletedAt: null,
    crew: {
      id: 'crew-1',
      name: 'North Star',
      logo: null,
      tagline: null,
      genres: [],
      styles: [],
    },
  };
}

interface PositionFindManyInput {
  where: Record<string, unknown>;
  orderBy: Array<Record<string, string>>;
  take: number;
  cursor?: { id: string };
  skip?: number;
  include: unknown;
}

function build() {
  const crewPosition = {
    findFirst: jest.fn<Promise<{ id: string } | null>, [unknown]>(),
    findMany: jest.fn<
      Promise<ReturnType<typeof position>[]>,
      [PositionFindManyInput]
    >(),
    count: jest.fn<Promise<number>, [{ where: Record<string, unknown> }]>(),
  };
  const crew = {
    findFirst: jest.fn().mockResolvedValue({
      founderId: 'owner-1',
      listingStatus: 'listed',
    }),
  };
  const crewMember = {
    count: jest.fn().mockResolvedValue(0),
  };
  const crewApplication = {
    groupBy: jest.fn().mockResolvedValue([]),
  };
  return {
    crewPosition,
    crew,
    crewMember,
    crewApplication,
    service: new PositionsService({
      crewPosition,
      crew,
      crewMember,
      crewApplication,
    } as never),
  };
}

describe('ListPublicPositionsQuerySchema', () => {
  it('normalizes unique facet values and applies production defaults', () => {
    expect(
      ListPublicPositionsQuerySchema.parse({
        employment: 'freelance,contract,freelance',
        seniority: 'mid,senior',
        workMode: 'remote',
      }),
    ).toEqual({
      limit: 36,
      employment: ['freelance', 'contract'],
      seniority: ['mid', 'senior'],
      workMode: ['remote'],
      sort: 'newest',
    });
  });

  it('rejects unknown facet values instead of silently widening results', () => {
    const parsed = ListPublicPositionsQuerySchema.safeParse({
      workMode: 'remote,spaceship',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected query validation to fail');
    expect(parsed.error.issues[0]?.message).toBe(
      'workMode contains unsupported value "spaceship"',
    );
  });
});

describe('PositionsService.listPublic', () => {
  it('filters and cursor-paginates in the database with a stable order', async () => {
    const t = build();
    t.crewPosition.findMany.mockResolvedValue([
      position('position-1'),
      position('position-2'),
    ]);
    t.crewPosition.count.mockResolvedValue(8);

    const result = await t.service.listPublic({
      limit: 1,
      employment: ['freelance'],
      seniority: ['mid'],
      workMode: ['remote'],
      sort: 'oldest',
    });

    const listInput = t.crewPosition.findMany.mock.calls[0]?.[0];
    expect(listInput.where).toMatchObject({
      employmentType: { in: ['freelance'] },
      experienceLevel: { in: ['mid'] },
      workMode: { in: ['remote'] },
    });
    expect(listInput.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(listInput.take).toBe(2);
    const countInput = t.crewPosition.count.mock.calls[0]?.[0];
    expect(countInput.where).toMatchObject({
      employmentType: { in: ['freelance'] },
    });
    expect(result).toMatchObject({
      total: 8,
      nextCursor: 'position-1',
      items: [{ position: { id: 'position-1' } }],
    });
  });

  it('rejects a cursor that is outside the active filter set', async () => {
    const t = build();
    t.crewPosition.findFirst.mockResolvedValue(null);

    await expect(
      t.service.listPublic({
        limit: 36,
        cursor: 'position-other-filter',
        employment: [],
        seniority: [],
        workMode: ['remote'],
        sort: 'newest',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(t.crewPosition.findMany).not.toHaveBeenCalled();
    expect(t.crewPosition.count).not.toHaveBeenCalled();
  });
});

describe('PositionsService.list', () => {
  it('validates a bounded crew-position page', () => {
    expect(ListCrewPositionsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      ListCrewPositionsQuerySchema.parse({
        limit: '100',
        cursor: 'position-1',
      }),
    ).toEqual({ limit: 100, cursor: 'position-1' });
    expect(ListCrewPositionsQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
  });

  it('pages positions and only groups application totals for the returned page', async () => {
    const t = build();
    t.crewPosition.findMany.mockResolvedValue([
      position('position-1'),
      position('position-lookahead'),
    ]);
    t.crewPosition.count.mockResolvedValue(4);
    t.crewApplication.groupBy.mockResolvedValue([
      {
        positionId: 'position-1',
        status: 'pending',
        _count: { _all: 3 },
      },
    ]);

    await expect(
      t.service.list('crew-1', 'owner-1', { limit: 1 }),
    ).resolves.toMatchObject({
      items: [
        {
          id: 'position-1',
          applicationStats: {
            total: 3,
            pending: 3,
            approved: 0,
            rejected: 0,
          },
        },
      ],
      nextCursor: 'position-1',
      total: 4,
    });
    expect(t.crewPosition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
      }),
    );
    expect(t.crewApplication.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          crewId: 'crew-1',
          positionId: { in: ['position-1'] },
        },
      }),
    );
  });
});
