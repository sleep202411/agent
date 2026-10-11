import { NotFoundException } from '@nestjs/common';
import { CrewApplicationStatus } from '@prisma/client';
import { ListCrewApplicationsQuerySchema } from './dto';
import { ApplicationsService } from './applications.service';

const CREW_ID = 'crew-1';
const OWNER_ID = 'owner-1';
const POSITION_ID = 'position-1';

function application(id: string, status: CrewApplicationStatus) {
  return {
    id,
    crewId: CREW_ID,
    positionId: POSITION_ID,
    applicantId: `user-${id}`,
    message: null,
    portfolioUrl: null,
    expectedCompensationAmount: null,
    expectedCompensationCurrency: null,
    expectedCompensationPeriod: null,
    availableStartDate: null,
    yearsExperience: null,
    status,
    createdAt: new Date('2026-07-29T12:00:00.000Z'),
    reviewedAt: null,
    reviewerId: null,
  };
}

function build() {
  const crewApplication = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  };
  const crew = {
    findFirst: jest.fn().mockResolvedValue({ id: CREW_ID }),
  };
  const service = new ApplicationsService(
    { crew, crewApplication } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      require: jest.fn().mockResolvedValue({ memberId: 'member-owner' }),
    } as never,
  );
  return { service, crew, crewApplication };
}

describe('ListCrewApplicationsQuerySchema', () => {
  it('applies a bounded page size and validates filters', () => {
    expect(ListCrewApplicationsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      ListCrewApplicationsQuerySchema.parse({
        limit: '100',
        positionId: POSITION_ID,
        status: 'pending',
      }),
    ).toEqual({
      limit: 100,
      positionId: POSITION_ID,
      status: 'pending',
    });
    expect(
      ListCrewApplicationsQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });
});

describe('ApplicationsService owner inbox', () => {
  it('cursor-paginates with stable ordering and returns authoritative counts', async () => {
    const t = build();
    t.crewApplication.findMany.mockResolvedValue([
      application('application-2', CrewApplicationStatus.pending),
      application('application-1', CrewApplicationStatus.pending),
    ]);
    t.crewApplication.groupBy.mockResolvedValue([
      {
        positionId: POSITION_ID,
        status: CrewApplicationStatus.pending,
        _count: { _all: 2 },
      },
      {
        positionId: POSITION_ID,
        status: CrewApplicationStatus.approved,
        _count: { _all: 3 },
      },
    ]);

    const page = await t.service.listForOwner(CREW_ID, OWNER_ID, {
      limit: 1,
      positionId: POSITION_ID,
    });

    expect(t.crewApplication.findMany).toHaveBeenCalledWith({
      include: {
        interviewEvents: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { state: true, version: true, scheduledAt: true },
        },
      },
      where: { crewId: CREW_ID, positionId: POSITION_ID },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });
    expect(page.items.map((item) => item.id)).toEqual(['application-2']);
    expect(page.nextCursor).toBe('application-2');
    expect(page.total).toBe(5);
    expect(page.summary).toEqual({
      total: 5,
      pending: 2,
      approved: 3,
      rejected: 0,
      byPosition: {
        [POSITION_ID]: {
          total: 5,
          pending: 2,
          approved: 3,
          rejected: 0,
        },
      },
    });
  });

  it('rejects a cursor that does not belong to the active filter', async () => {
    const t = build();
    t.crewApplication.findFirst.mockResolvedValue(null);

    await expect(
      t.service.listForOwner(CREW_ID, OWNER_ID, {
        limit: 50,
        cursor: 'application-other',
        positionId: POSITION_ID,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_APPLICATION_CURSOR_INVALID' },
      status: 400,
    });
    expect(t.crewApplication.findMany).not.toHaveBeenCalled();
  });

  it('loads notification deeplinks by exact crew-scoped application id', async () => {
    const t = build();
    t.crewApplication.findFirst.mockResolvedValue(null);

    await expect(
      t.service.getForOwner(CREW_ID, 'application-missing', OWNER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(t.crewApplication.findFirst).toHaveBeenCalledWith({
      include: {
        interviewEvents: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { state: true, version: true, scheduledAt: true },
        },
      },
      where: { id: 'application-missing', crewId: CREW_ID },
    });
  });
});

describe('applicant-owned application history', () => {
  const fixture = () => {
    const db = {
      crewApplication: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
      },
    };
    return {
      db,
      service: new ApplicationsService(
        db as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  };
  it('scopes results and counts to the authenticated applicant, with bounded pages', async () => {
    const f = fixture();
    f.db.crewApplication.findMany.mockResolvedValue([
      {
        ...application('a', 'rejected'),
        crew: { name: 'Crew' },
        position: { positionType: 'Writer', taskId: 'task' },
      },
      {
        ...application('b', 'rejected'),
        crew: { name: 'Crew' },
        position: { positionType: 'Writer', taskId: 'task' },
      },
    ]);
    const result = await f.service.listMine('applicant', {
      limit: 1,
      status: 'rejected',
    });
    expect(f.db.crewApplication.findMany).toHaveBeenCalledWith({
      include: {
        crew: {
          select: {
            name: true,
            ownership: { select: { member: { select: { userId: true } } } },
          },
        },
        position: {
          select: {
            positionType: true,
            taskId: true,
            groupedTasks: { select: { id: true } },
            task: { select: { title: true, dueAt: true } },
          },
        },
        interviewEvents: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { state: true, version: true, scheduledAt: true },
        },
      },
      where: { applicantId: 'applicant', status: 'rejected' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });
    expect(f.db.crewApplication.count).toHaveBeenCalledWith({
      where: { applicantId: 'applicant', status: 'rejected' },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      crewName: 'Crew',
      positionType: 'Writer',
      taskId: 'task',
    });
    expect(result.nextCursor).toBe('a');
  });
  it('rejects another applicant’s cursor without reading any application page', async () => {
    const f = fixture();
    f.db.crewApplication.findFirst.mockResolvedValue(null);
    await expect(
      f.service.listMine('applicant', { limit: 20, cursor: 'foreign' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.db.crewApplication.findFirst).toHaveBeenCalledWith({
      where: { applicantId: 'applicant', id: 'foreign' },
      select: { id: true },
    });
    expect(f.db.crewApplication.findMany).not.toHaveBeenCalled();
  });
  it('scopes the received inbox to current active ownership, including cursor validation', async () => {
    const f = fixture();
    f.db.crewApplication.findMany.mockResolvedValue([]);
    f.db.crewApplication.findFirst.mockResolvedValue({ id: 'cursor' });
    await f.service.listMine('owner', {
      limit: 20,
      scope: 'received',
      cursor: 'cursor',
    });
    const ownership = {
      crew: {
        deletedAt: null,
        ownership: {
          member: { userId: 'owner', status: 'active', removedAt: null },
        },
      },
    };
    expect(f.db.crewApplication.findFirst).toHaveBeenCalledWith({
      where: { ...ownership, id: 'cursor' },
      select: { id: true },
    });
    expect(f.db.crewApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: ownership }),
    );
    expect(f.db.crewApplication.count).toHaveBeenCalledWith({
      where: ownership,
    });
  });
  it('rejects another owner’s received cursor before loading private applications', async () => {
    const f = fixture();
    f.db.crewApplication.findFirst.mockResolvedValue(null);
    await expect(
      f.service.listMine('owner', {
        limit: 20,
        scope: 'received',
        cursor: 'foreign',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.db.crewApplication.findMany).not.toHaveBeenCalled();
  });
});
