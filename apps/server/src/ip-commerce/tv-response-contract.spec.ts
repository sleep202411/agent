import { ForbiddenException } from '@nestjs/common';
import { IpCommentsController } from './ip-comments.controller';
import { IpCrewOriginController } from './ip-crew-origin';

const ipId = '11111111-1111-4111-8111-111111111111';
const user = { userId: 'viewer' } as never;

it.each([{ crew: null }, { crew: { id: 'crew', name: 'Crew' } }])(
  'wraps public crew results in the Web success contract: %j',
  async (data) => {
    const service = { publicOrigin: jest.fn().mockResolvedValue(data) };
    const controller = new IpCrewOriginController(service as never);
    await expect(controller.publicOrigin({ ipId })).resolves.toEqual({
      code: 200,
      data,
    });
    expect(service.publicOrigin).toHaveBeenCalledWith(ipId, undefined);
  },
);
it('wraps owner reads and saves without losing version or selection', async () => {
  const data = { crewId: 'crew', version: 2, choices: [] };
  const service = {
    own: jest.fn().mockResolvedValue(data),
    save: jest.fn().mockResolvedValue(data),
  };
  const controller = new IpCrewOriginController(service as never);
  await expect(controller.own({ ipId }, user)).resolves.toEqual({
    code: 200,
    data,
  });
  await expect(
    controller.save({ ipId }, user, { crewId: null, expectedVersion: 1 }),
  ).resolves.toEqual({ code: 200, data });
});
it('wraps comment pagination, creation and removal', async () => {
  const page = { items: [], nextCursor: 'next' };
  const comment = { id: 'comment', body: 'Hello' };
  const removed = { ok: true };
  const service = {
    list: jest.fn().mockResolvedValue(page),
    create: jest.fn().mockResolvedValue(comment),
    remove: jest.fn().mockResolvedValue(removed),
  };
  const controller = new IpCommentsController(service as never);
  await expect(
    controller.list({ ipId }, undefined, { cursor: 'cursor' }),
  ).resolves.toEqual({ code: 200, data: page });
  expect(service.list).toHaveBeenCalledWith(ipId, undefined, 'cursor');
  await expect(
    controller.create({ ipId }, user, { body: 'Hello', requestId: ipId }),
  ).resolves.toEqual({ code: 200, data: comment });
  await expect(
    controller.remove({ ipId, id: 'comment' }, user),
  ).resolves.toEqual({ code: 200, data: removed });
});
it('preserves service authorization failures instead of returning success', async () => {
  const failure = new ForbiddenException('Access denied');
  const comments = new IpCommentsController({
    list: jest.fn().mockRejectedValue(failure),
  } as never);
  const origins = new IpCrewOriginController({
    publicOrigin: jest.fn().mockRejectedValue(failure),
  } as never);
  await expect(comments.list({ ipId }, undefined, {})).rejects.toBe(failure);
  await expect(origins.publicOrigin({ ipId })).rejects.toBe(failure);
});
