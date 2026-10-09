import {
  UpdatePositionSchema,
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
    service: new PositionsService(
      {
        crewPosition,
        crew,
        crewMember,
        crewApplication,
      } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue({ permissions: ['openings.manage'] }),
      } as never,
    ),
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
    ).rejects.toMatchObject({
      response: { code: 'CREW_POSITION_CURSOR_INVALID' },
      status: 400,
    });

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

describe('PositionsService.update recruitment status', () => {
  function editor(status: 'open' | 'frozen' | 'full', recruitedCount: number) {
    const before = { ...position('position-1'), status, recruitedCount };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      crewPosition: {
        findFirst: jest.fn().mockResolvedValue(before),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Partial<typeof before> }) =>
            Promise.resolve({ ...before, ...data }),
          ),
      },
    };
    const db = {
      $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx),
    };
    const service = new PositionsService(
      db as never,
      { require: jest.fn().mockResolvedValue({}) } as never,
    );
    return { service, tx };
  }

  it.each([
    'monthly',
    'half_upfront',
    'on_completion',
    'demo_promise',
    null,
  ] as const)(
    'persists and exposes payment timing %s without changing fee basis',
    async (paymentTerms) => {
      const { service } = editor('open', 0);
      const result = await service.update(
        'crew-1',
        'position-1',
        'owner-1',
        UpdatePositionSchema.parse({ paymentTerms }),
      );
      expect(result.paymentTerms).toBe(paymentTerms);
      expect(result.salary.period).toBe('project');
    },
  );

  it('keeps a full closed position hidden when editing its description', async () => {
    const { service } = editor('frozen', 2);
    const result = await service.update('crew-1', 'position-1', 'owner-1', {
      description: 'Updated description',
      targetCount: 2,
    });
    expect(result.status).toBe('frozen');
    expect(result.description).toBe('Updated description');
  });

  it('honors an explicit close while increasing capacity on a full position', async () => {
    const { service } = editor('full', 2);
    const result = await service.update('crew-1', 'position-1', 'owner-1', {
      status: 'frozen',
      targetCount: 3,
    });
    expect(result.status).toBe('frozen');
  });

  it.each([
    ['full', 2, 3, 'open'],
    ['open', 2, 2, 'full'],
    ['frozen', 1, 3, 'frozen'],
  ] as const)(
    'derives capacity without losing closed intent (%s)',
    async (status, recruitedCount, targetCount, expected) => {
      const { service } = editor(status, recruitedCount);
      const result = await service.update('crew-1', 'position-1', 'owner-1', {
        targetCount,
      });
      expect(result.status).toBe(expected);
    },
  );
});

describe('position discovery search', () => {
  it('combines search and skill/crew filters with all publication and deadline guards', async () => {
    const f = build();
    f.crewPosition.findMany.mockResolvedValue([]);
    f.crewPosition.count.mockResolvedValue(0);
    await f.service.listPublic(
      ListPublicPositionsQuerySchema.parse({
        q: 'North',
        crewId: 'crew-1',
        skill: 'storyboard',
      }),
    );
    const { where } = f.crewPosition.findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      crewId: 'crew-1',
      requiredSkills: { hasSome: ['storyboard'] },
      status: 'open',
      moderationStatus: 'ok',
      crew: {
        listingStatus: 'listed',
        deletedAt: null,
        moderationStatus: 'ok',
      },
    });
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: expect.arrayContaining([
            { crew: { name: { contains: 'North', mode: 'insensitive' } } },
          ]) as unknown,
        },
      ]),
    );
    expect(where.OR).toEqual(expect.arrayContaining([{ closeDate: null }]));
    expect(f.crewPosition.count).toHaveBeenCalledWith({ where });
  });
  it('rejects blank or unbounded search input', () => {
    expect(ListPublicPositionsQuerySchema.safeParse({ q: '   ' }).success).toBe(
      false,
    );
    expect(
      ListPublicPositionsQuerySchema.safeParse({ q: 'x'.repeat(121) }).success,
    ).toBe(false);
  });
});

describe('Salary discovery units', () => {
  it('requires explicit currency and pay period and rejects reversed bounds', () => {
    expect(
      ListPublicPositionsQuerySchema.safeParse({ salaryMinMinor: '100' })
        .success,
    ).toBe(false);
    expect(
      ListPublicPositionsQuerySchema.safeParse({
        salaryMinMinor: '200',
        salaryMaxMinor: '100',
        salaryCurrency: 'USD',
        salaryPeriod: 'project',
      }).success,
    ).toBe(false);
  });
  it('matches overlapping ranges only within the selected currency and pay period', async () => {
    const t = build();
    t.crewPosition.findMany.mockResolvedValue([]);
    t.crewPosition.count.mockResolvedValue(0);
    await t.service.listPublic(
      ListPublicPositionsQuerySchema.parse({
        salaryMinMinor: '10000',
        salaryMaxMinor: '20000',
        salaryCurrency: 'USD',
        salaryPeriod: 'project',
        positionType: 'editor',
        genre: 'commercial',
      }),
    );
    const call = t.crewPosition.findMany.mock.calls[0]?.[0] as {
      where: unknown;
    };
    expect(call.where).toMatchObject({
      salaryMinAmount: { lte: 20000n },
      salaryMaxAmount: { gte: 10000n },
      salaryCurrency: 'USD',
      salaryPeriod: 'project',
      salaryNegotiable: false,
      positionType: 'editor',
      crew: { genres: { has: 'commercial' } },
    });
  });
});

it('validates multiple capability names without splitting names on commas', () => {
  expect(
    ListPublicPositionsQuerySchema.parse({
      skills: '["AI Producer","Editing, sound"]',
    }).skills,
  ).toEqual(['AI Producer', 'Editing, sound']);
  expect(
    ListPublicPositionsQuerySchema.safeParse({ skills: 'AI Producer' }).success,
  ).toBe(false);
  expect(
    ListPublicPositionsQuerySchema.safeParse({
      skills: JSON.stringify(Array(21).fill('Editing')),
    }).success,
  ).toBe(false);
});

it('applies every selected capability to both count and paginated search', async () => {
  const f = build();
  f.crewPosition.findMany.mockResolvedValue([]);
  f.crewPosition.count.mockResolvedValue(0);
  await f.service.listPublic(
    ListPublicPositionsQuerySchema.parse({
      skills: JSON.stringify(['AI Producer', 'Editor']),
    }),
  );
  expect(f.crewPosition.findMany.mock.calls[0][0].where.requiredSkills).toEqual(
    { hasSome: ['AI Producer', 'Editor'] },
  );
  expect(f.crewPosition.count.mock.calls[0][0].where.requiredSkills).toEqual({
    hasSome: ['AI Producer', 'Editor'],
  });
});

describe('public recruitment producer qualification', () => {
  function writes(status = 'frozen', visibility = 'public') {
    const row = {
      ...position('p1'),
      status,
      recruitmentVisibility: visibility,
    };
    const tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      crewTask: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ workflowState: { semantic: 'open' } }),
      },
      crewTaskAssignee: { count: jest.fn().mockResolvedValue(0) },
      crewPosition: {
        findFirst: jest.fn().mockResolvedValue(row),
        create: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue(row),
      },
    };
    const service = new PositionsService(
      { $transaction: (fn: (db: unknown) => unknown) => fn(tx) } as never,
      { require: jest.fn().mockResolvedValue({}) } as never,
    );
    return { service, tx };
  }
  it('rejects public creation without a producer qualification', async () => {
    const t = writes();
    await expect(
      t.service.create('crew-1', 'owner', {} as never),
    ).rejects.toMatchObject({ response: { code: 'CREW_PRODUCER_REQUIRED' } });
    expect(t.tx.crewPosition.create).not.toHaveBeenCalled();
  });
  it('allows private task invitations without producer qualification', async () => {
    const t = writes();
    await t.service.create('crew-1', 'owner', {
      taskId: 'task-1',
      recruitmentVisibility: 'private',
      positionType: 'storyboard',
      targetCount: 1,
    } as never);
    expect(t.tx.crewPosition.create).toHaveBeenCalled();
  });
  it('rejects a stale batch recruitment snapshot under the task lock', async () => {
    const t = writes();
    t.tx.crewTask.findFirst.mockResolvedValue({
      workflowState: { semantic: 'open' },
      version: 3,
    });
    await expect(
      t.service.create(
        'crew-1',
        'owner',
        { taskId: 'task-1', expectedTaskVersion: 2 } as never,
        [13],
      ),
    ).rejects.toThrow('Task changed');
    expect(t.tx.crewPosition.create).not.toHaveBeenCalled();
  });
  it('does not publish a second position when retrying a batch', async () => {
    const t = writes();
    t.tx.crewTask.findFirst.mockResolvedValue({
      workflowState: { semantic: 'open' },
      version: 2,
    });
    await expect(
      t.service.create(
        'crew-1',
        'owner',
        { taskId: 'task-1', expectedTaskVersion: 2 } as never,
        [13],
      ),
    ).rejects.toThrow('already has recruitment');
    expect(t.tx.crewPosition.create).not.toHaveBeenCalled();
  });
  it('allows qualified public creation', async () => {
    const t = writes();
    await t.service.create(
      'crew-1',
      'owner',
      { positionType: 'storyboard', targetCount: 1 } as never,
      [13],
    );
    expect(t.tx.crewPosition.create).toHaveBeenCalled();
  });
  it('cannot reopen a frozen public posting without qualification', async () => {
    const t = writes();
    await expect(
      t.service.update('crew-1', 'p1', 'owner', { status: 'open' } as never),
    ).rejects.toMatchObject({ response: { code: 'CREW_PRODUCER_REQUIRED' } });
    expect(t.tx.crewPosition.update).not.toHaveBeenCalled();
  });
  it('can close public recruitment without qualification', async () => {
    const t = writes('open');
    await t.service.update('crew-1', 'p1', 'owner', {
      status: 'frozen',
    } as never);
    expect(t.tx.crewPosition.update).toHaveBeenCalled();
  });
  it('can reopen private recruitment without qualification', async () => {
    const t = writes('frozen', 'private');
    await t.service.update('crew-1', 'p1', 'owner', {
      status: 'open',
    } as never);
    expect(t.tx.crewPosition.update).toHaveBeenCalled();
  });
});
