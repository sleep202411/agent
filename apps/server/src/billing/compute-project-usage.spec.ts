import { ListAdminComputeProjectUsageQuerySchema } from './dto';
import { BillingService } from './billing.service';

it('defaults project usage filters to the last 30 days across every workspace', () => {
  expect(ListAdminComputeProjectUsageQuerySchema.parse({})).toEqual({
    days: 30,
    workspaceKind: 'all',
    sort: 'credits',
    limit: 100,
  });
});

it('returns an empty workspace rollup when the compute ledger has no spend', async () => {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    workspace: { findMany: jest.fn() },
    platformProject: { findMany: jest.fn() },
  };
  const service = new BillingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    service.listAdminComputeProjectUsage({
      days: 7,
      workspaceKind: 'shared',
      sort: 'recent',
      limit: 20,
    }),
  ).resolves.toEqual({
    rangeDays: 7,
    workspaceKind: 'shared',
    sort: 'recent',
    workspaceId: null,
    totalCredits: '0',
    workspaceCount: 0,
    projectCount: 0,
    workspaces: [],
  });
  expect(prisma.workspace.findMany).not.toHaveBeenCalled();
});
