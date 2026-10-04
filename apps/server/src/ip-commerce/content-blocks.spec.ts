import { IpCommerceService } from './ip-commerce.service';
import { ListMyContentBlocksSchema } from './dto';

function setup() {
  const blocks = {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };
  const ips = { findMany: jest.fn().mockResolvedValue([]) };
  const svc = new IpCommerceService(
    {
      ipUserContentBlock: blocks,
      ip: ips,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, blocks, ips };
}
it('lists only the signed-in user active blocks without content visibility checks', async () => {
  const { svc, blocks } = setup();
  await expect(
    svc.listMyContentBlocks({ userId: 'alice' }, { limit: 20 }),
  ).resolves.toEqual({ items: [], nextCursor: null });
  expect(blocks.findMany).toHaveBeenCalledWith({
    where: { userId: 'alice', unblockedAt: null },
    orderBy: { id: 'desc' },
    take: 21,
    select: { id: true, targetType: true, targetId: true, createdAt: true },
  });
});
it('rejects another user cursor before listing', async () => {
  const { svc, blocks } = setup();
  blocks.findFirst.mockResolvedValue(null);
  await expect(
    svc.listMyContentBlocks(
      { userId: 'alice' },
      { limit: 20, cursor: 'foreign' },
    ),
  ).rejects.toMatchObject({
    response: { code: 'CONTENT_BLOCK_CURSOR_INVALID' },
  });
  expect(blocks.findFirst).toHaveBeenCalledWith({
    where: { id: 'foreign', userId: 'alice' },
    select: { id: true },
  });
  expect(blocks.findMany).not.toHaveBeenCalled();
});
it('paginates past a previously unblocked cursor without duplicating it', async () => {
  const { svc, blocks } = setup();
  blocks.findFirst.mockResolvedValue({ id: 'cursor' });
  blocks.findMany.mockResolvedValue([{ id: 'b' }, { id: 'a' }]);
  await expect(
    svc.listMyContentBlocks(
      { userId: 'alice' },
      { limit: 1, cursor: 'cursor' },
    ),
  ).resolves.toEqual({ items: [{ id: 'b', title: null }], nextCursor: 'b' });
  expect(blocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'alice', unblockedAt: null, id: { lt: 'cursor' } },
      take: 2,
    }),
  );
});
it('validates page bounds and cursor shape at the route boundary', () => {
  expect(ListMyContentBlocksSchema.parse({})).toEqual({ limit: 20 });
  for (const query of [
    { limit: 0 },
    { limit: 51 },
    { cursor: 'bad' },
    { userId: 'other' },
  ])
    expect(ListMyContentBlocksSchema.safeParse(query).success).toBe(false);
});

it('does not expose private titles when showing a recoverable blocked IP', async () => {
  const { svc, blocks, ips } = setup();
  blocks.findMany.mockResolvedValue([
    { id: 'block', targetType: 'ip', targetId: 'private-ip' },
  ]);
  const result = await svc.listMyContentBlocks(
    { userId: 'alice' },
    { limit: 20 },
  );
  expect(result.items[0]).toMatchObject({
    targetId: 'private-ip',
    title: null,
  });
  expect(ips.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: { in: ['private-ip'] },
        deletedAt: null,
        status: { in: ['scheduled', 'published'] },
        listingVisibility: { in: ['public', 'unlisted'] },
      },
    }),
  );
});
