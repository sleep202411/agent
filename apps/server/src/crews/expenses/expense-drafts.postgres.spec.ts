import { randomUUID } from 'node:crypto';
import { buildPrisma, type PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewExpenseDraftService, SaveExpenseDraft } from './expense-drafts';
const suite =
  process.env.DATABASE_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;
suite('private expense drafts in PostgreSQL', () => {
  let db: ReturnType<typeof buildPrisma>, service: CrewExpenseDraftService;
  const crew = randomUUID(),
    user = randomUUID(),
    member = randomUUID(),
    id = randomUUID();
  const input = SaveExpenseDraft.parse({
    expectedVersion: 0,
    definition: {
      category: 'Travel',
      purpose: 'Client meeting',
      occurredOn: '2026-09-13',
      currency: 'USD',
      amountMinor: '1234',
      evidenceNote: 'Receipt held by claimant',
    },
  });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '5433' ||
      url.pathname !== '/fizzdragon_outbox_test'
    )
      throw Error('Owned local DB required');
    db = buildPrisma();
    await db.$connect();
    service = new CrewExpenseDraftService(
      db as PrismaService,
      new CrewAuthorizationService(db as PrismaService),
    );
    await db.crew.create({
      data: {
        id: crew,
        name: 'Expense fixture',
        description: '',
        logo: 'fixture',
        createdByUserId: user,
      },
    });
    await db.crewMember.create({
      data: { id: member, crewId: crew, userId: user, joinedVia: 'creation' },
    });
  });
  afterAll(async () => {
    await db.$executeRaw`DELETE FROM crew_expense_draft_revisions WHERE crew_id = ${crew}`;
    await db.crew.delete({ where: { id: crew } });
    await db.$disconnect();
  });
  it('preserves one revision on replay, conflicts on changed stale content, and isolates owners', async () => {
    const [first, replay] = await Promise.all([
      service.save(crew, id, user, input),
      service.save(crew, id, user, input),
    ]);
    expect(first.version).toBe(1);
    expect(replay.version).toBe(1);
    await expect(
      service.save(crew, id, user, {
        ...input,
        definition: { ...input.definition, purpose: 'Changed' },
      }),
    ).rejects.toThrow('Refresh');
    expect(
      (await service.list(crew, randomUUID(), { limit: 30 })).items,
    ).toEqual([]);
    expect(
      (await service.list(crew, user, { limit: 30 })).items[0].definition
        .amountMinor,
    ).toBe('1234');
  });
  it('retains personal reads after departure and rejects further writes', async () => {
    await db.crewMember.update({
      where: { id: member },
      data: { status: 'removed', removedAt: new Date() },
    });
    expect((await service.list(crew, user, { limit: 30 })).items).toHaveLength(
      1,
    );
    await expect(
      service.save(crew, id, user, { ...input, expectedVersion: 1 }),
    ).rejects.toThrow('Active crew membership');
  });
});
it('rejects authority/payment fields and invalid amounts or dates in a draft', () => {
  const definition = {
    category: '',
    purpose: '',
    occurredOn: null,
    currency: 'USD',
    amountMinor: null,
    evidenceNote: '',
  };
  expect(
    SaveExpenseDraft.safeParse({ expectedVersion: 0, definition }).success,
  ).toBe(true);
  for (const extra of [
    { amountMinor: '1.2' },
    { occurredOn: '2026-02-30' },
    { approved: true },
    { payer: 'platform' },
  ])
    expect(
      SaveExpenseDraft.safeParse({
        expectedVersion: 0,
        definition: { ...definition, ...extra },
      }).success,
    ).toBe(false);
});
