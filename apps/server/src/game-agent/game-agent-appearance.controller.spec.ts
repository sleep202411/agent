import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { AppearanceDesignRequest } from '@repo/game-agent-protocol';
import { GameAgentAppearanceController } from './game-agent-appearance.controller';

const config = { value: { studioOrigin: 'https://fizzdragon.com' } } as never;

const body: AppearanceDesignRequest = {
  requestId: '135b85a7-1c82-4b1f-8f7c-fbc174f19ea2',
  locale: 'en-US',
  prompt: 'Center choices',
  appearance: {
    version: 1,
  },
  context: { title: 'Client-supplied title', choiceLabels: ['Continue'] },
  history: [],
};
const user = { userId: 'actor' } as never;

it('checks Story generation permission before invoking the worker', async () => {
  const permissions = {
    requireProject: jest.fn().mockRejectedValue(new Error('Forbidden')),
  };
  const worker = { designAppearance: jest.fn() };
  const controller = new GameAgentAppearanceController(
    permissions as never,
    worker as never,
    config,
  );
  await expect(
    controller.design(user, 'project', body, new EventEmitter() as Response),
  ).rejects.toThrow('Forbidden');
  expect(permissions.requireProject).toHaveBeenCalledWith(
    'actor',
    'project',
    'story.generate',
  );
  expect(worker.designAppearance).not.toHaveBeenCalled();
});

it('uses the authorized project title and cancels when its browser disconnects', async () => {
  const permissions = {
    requireProject: jest
      .fn()
      .mockResolvedValue({ project: { title: 'Authorized title' } }),
  };
  let signal!: AbortSignal;
  const forwarded: AppearanceDesignRequest[] = [];
  const worker = {
    designAppearance: jest.fn(
      (_body: AppearanceDesignRequest, inputSignal: AbortSignal) => {
        forwarded.push(_body);
        signal = inputSignal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('Disconnected')),
            { once: true },
          ),
        );
      },
    ),
  };
  const controller = new GameAgentAppearanceController(
    permissions as never,
    worker as never,
    config,
  );
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
  }) as Response;
  const operation = controller.design(user, 'project', body, response);
  await new Promise((resolve) => setImmediate(resolve));
  expect(forwarded[0].context.title).toBe('Authorized title');
  response.emit('close');
  await expect(operation).rejects.toThrow('Disconnected');
  expect(signal.aborted).toBe(true);
  expect(response.listenerCount('close')).toBe(0);
});

it('does not launch inference after a disconnect during permission resolution', async () => {
  let resolvePermission!: (value: unknown) => void;
  const permissions = {
    requireProject: jest.fn(
      () =>
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
    ),
  };
  const worker = { designAppearance: jest.fn() };
  const controller = new GameAgentAppearanceController(
    permissions as never,
    worker as never,
    config,
  );
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
  }) as Response;
  const operation = controller.design(user, 'project', body, response);
  response.emit('close');
  resolvePermission({ project: { title: 'Authorized title' } });
  await expect(operation).rejects.toThrow();
  expect(worker.designAppearance).not.toHaveBeenCalled();
  expect(response.listenerCount('close')).toBe(0);
});
