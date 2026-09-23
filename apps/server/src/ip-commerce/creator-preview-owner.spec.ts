import { IpCommerceService } from './ip-commerce.service';

it('returns the real owner when an editor reads the creator detail', async () => {
  const row = {
    id: 'ip',
    createdById: 'owner',
    roomNumber: '123',
    sourceLocale: 'en-US',
    localizations: [],
    taxonomyAssignments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    aclGrants: [{ userId: 'editor', permission: 'edit', revokedAt: null }],
    _count: {},
    priceRules: [],
    episodes: [],
    campaigns: [],
    contributors: [],
    assets: [],
  };
  const service = Object.assign(Object.create(IpCommerceService.prototype), {
    prisma: { ip: { findFirst: jest.fn().mockResolvedValue(row) } },
  }) as IpCommerceService;
  const result = await service.getCreatorIp(
    { userId: 'editor' } as Parameters<IpCommerceService['getCreatorIp']>[0],
    'ip',
  );
  expect(result.ip.viewerAccess.owner).toBe(false);
  expect(result.ip.viewerAccess.canEdit).toBe(true);
  expect(result.ip.createdById).toBe('owner');
});
