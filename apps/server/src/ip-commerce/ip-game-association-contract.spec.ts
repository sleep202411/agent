import { ForbiddenException } from '@nestjs/common';
import {
  IpGameAssociationController,
  IpGameAssociationService,
} from './ip-game-associations';
import {
  IpStageApplicationsController,
  IpStageApplicationsService,
} from './ip-stage-applications';

const gameId = '11111111-1111-4111-8111-111111111111';
const ipId = '22222222-2222-4222-8222-222222222222';
const user = { userId: 'editor' } as never;

it('returns stage state and history in the raw editor success contract', async () => {
  const data = { state: { stage: 'story_testing', version: 2 }, items: [] };
  const list = jest.fn().mockResolvedValue(data);
  const controller = new IpStageApplicationsController({
    list,
  } as unknown as IpStageApplicationsService);
  await expect(controller.list({ ipId }, user)).resolves.toEqual({
    code: 200,
    ...data,
  });
  expect(list).toHaveBeenCalledWith(ipId, user);
});

it('acknowledges an existing stage application without changing its identity or policy', async () => {
  const input = {
    id: gameId,
    expectedVersion: 2,
    stage: 'production' as const,
    reason: 'Ready',
  };
  const data = {
    id: gameId,
    stage: 'production',
    status: 'pending',
    reason: 'Ready',
  };
  const submit = jest
    .fn()
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new ForbiddenException('Not an editor'));
  const controller = new IpStageApplicationsController({
    submit,
  } as unknown as IpStageApplicationsService);
  await expect(controller.submit({ ipId }, user, input)).resolves.toEqual({
    code: 200,
    ...data,
  });
  expect(submit).toHaveBeenCalledWith(ipId, user, input);
  await expect(controller.submit({ ipId }, user, input)).rejects.toThrow(
    'Not an editor',
  );
});

it('retains candidate fields and cursor in the raw Web success contract', async () => {
  const data = {
    items: [
      {
        gameId,
        title: 'Owned film',
        version: 2,
        linked: true,
        linkedElsewhere: false,
      },
    ],
    nextCursor: gameId,
  };
  const candidates = jest.fn().mockResolvedValue(data);
  const controller = new IpGameAssociationController({
    candidates,
  } as unknown as IpGameAssociationService);
  await expect(
    controller.candidates(user, ipId, { cursor: gameId }),
  ).resolves.toEqual({ code: 200, ...data });
  expect(candidates).toHaveBeenCalledWith(ipId, user, gameId);
});

it('acknowledges saves without losing the version or retry identity', async () => {
  const input = { requestId: gameId, expectedVersion: 2, active: true };
  const data = { version: 3, active: true };
  const save = jest.fn().mockResolvedValue(data);
  const controller = new IpGameAssociationController({
    save,
  } as unknown as IpGameAssociationService);
  await expect(controller.save(user, ipId, gameId, input)).resolves.toEqual({
    code: 200,
    ...data,
  });
  expect(save).toHaveBeenCalledWith(ipId, gameId, user, input);
});

it.each([null, ipId])(
  'preserves resolved IP %s in the raw TV success contract',
  async (resolvedIp) => {
    const resolve = jest.fn().mockResolvedValue({ ipId: resolvedIp });
    const controller = new IpGameAssociationController({
      resolve,
    } as unknown as IpGameAssociationService);
    await expect(controller.resolve(gameId, user)).resolves.toEqual({
      code: 200,
      ipId: resolvedIp,
    });
    expect(resolve).toHaveBeenCalledWith(gameId, user);
  },
);

it('preserves authorization errors on all three routes', async () => {
  const error = new ForbiddenException('Not an eligible owner');
  const controller = new IpGameAssociationController({
    candidates: jest.fn().mockRejectedValue(error),
    save: jest.fn().mockRejectedValue(error),
    resolve: jest.fn().mockRejectedValue(error),
  } as unknown as IpGameAssociationService);
  await expect(controller.candidates(user, ipId, {})).rejects.toBe(error);
  await expect(
    controller.save(user, ipId, gameId, {
      requestId: gameId,
      expectedVersion: 0,
      active: true,
    }),
  ).rejects.toBe(error);
  await expect(controller.resolve(gameId, user)).rejects.toBe(error);
});
