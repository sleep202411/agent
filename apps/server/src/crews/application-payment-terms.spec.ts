import {
  CrewApplicationTermsService,
  ApplicationTermsInput,
} from './application-terms';
import { AmendmentInput } from './application-amendments';
function fixture() {
  const app = {
    id: 'app',
    crewId: 'crew',
    applicantId: 'recipient',
    positionId: 'role',
    status: 'pending',
    termsVersion: 0,
    crew: { deletedAt: null },
  };
  const rows = new Map<number, Record<string, unknown>>();
  const tx = {
    $queryRaw: jest.fn(),
    crewApplication: {
      findUnique: jest.fn(() => Promise.resolve(app)),
      update: jest.fn(({ data }: { data: Partial<typeof app> }) =>
        Promise.resolve(Object.assign(app, data)),
      ),
    },
    crewPosition: {
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ taskId: 'task' })),
    },
    crewApplicationTerms: {
      create: jest.fn(
        ({ data }: { data: Record<string, unknown> & { version: number } }) => {
          const row = { ...data, createdAt: new Date(), confirmedAt: null };
          rows.set(data.version, row);
          return Promise.resolve(row);
        },
      ),
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { applicationId_version: { version: number } };
        }) => Promise.resolve(rows.get(where.applicationId_version.version)),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = [...rows.values()].find((item) => item.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
  };
  const db = {
    $transaction: (fn: (value: typeof tx) => unknown) =>
      Promise.resolve(fn(tx)),
  };
  const service = new CrewApplicationTermsService(
    db as never,
    { require: jest.fn() } as never,
  );
  const input = {
    expectedVersion: 0,
    scope: 'One edited film',
    feeAmount: '10000',
    currency: 'USD' as const,
    feePeriod: 'project' as const,
    revenueShareBp: 0,
    shareBasis: null,
  };
  return { service, input, app, tx };
}
it.each(['monthly', 'half_upfront', 'on_completion', 'demo_promise'] as const)(
  'persists %s separately from the project fee basis and confirms that version',
  async (paymentTerms) => {
    const { service, input, tx } = fixture();
    const terms = await service.propose('app', 'owner', {
      ...input,
      paymentTerms,
    });
    expect(terms).toMatchObject({
      paymentTerms,
      feePeriod: 'project',
      version: 1,
      confirmedAt: null,
    });
    const confirmed = await service.confirm('app', 'recipient', 1);
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(
      await service.propose('app', 'owner', { ...input, paymentTerms }),
    ).toEqual(confirmed);
    expect(tx.crewApplicationTerms.create).toHaveBeenCalledTimes(1);
    await expect(
      service.propose('app', 'owner', {
        ...input,
        paymentTerms: paymentTerms === 'monthly' ? 'half_upfront' : 'monthly',
      }),
    ).rejects.toThrow('Terms changed');
  },
);
it('requires fresh confirmation for a changed timing version', async () => {
  const { service, input } = fixture();
  await service.propose('app', 'owner', { ...input, paymentTerms: 'monthly' });
  await service.confirm('app', 'recipient', 1);
  const next = await service.propose('app', 'owner', {
    ...input,
    expectedVersion: 1,
    paymentTerms: 'half_upfront',
  });
  expect(next).toMatchObject({
    version: 2,
    paymentTerms: 'half_upfront',
    confirmedAt: null,
  });
  await expect(service.confirm('app', 'recipient', 1)).rejects.toThrow(
    'Terms changed',
  );
});
it('keeps omitted timing unspecified and rejects unknown timing at both write boundaries', async () => {
  const { service, input } = fixture();
  expect(await service.propose('app', 'owner', input)).toMatchObject({
    paymentTerms: null,
  });
  expect(
    ApplicationTermsInput.safeParse({ ...input, paymentTerms: 'eventually' })
      .success,
  ).toBe(false);
  expect(
    AmendmentInput.safeParse({
      ...input,
      id: '378630e4-1fc5-45c9-85fb-2a18b22339a7',
      expectedTaskVersion: 1,
      reason: 'Timing change',
      paymentTerms: 'eventually',
    }).success,
  ).toBe(false);
});
