import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { AlertingExceptionFilter } from './alerting-exception.filter';
import type { AlertingService } from './alerting.service';
import type { AlertEvent } from './alerting.types';

describe('HTTP error snapshots', () => {
  const response = {};
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl: '/test?secret=omitted',
      }),
    }),
    getArgByIndex: () => response,
  } as unknown as ArgumentsHost;
  const reply = jest.fn();
  const notify = jest.fn<void, [AlertEvent]>();
  const filter = new AlertingExceptionFilter(
    { notify } as unknown as AlertingService,
    {
      httpAdapter: { isHeadersSent: () => false, reply },
    } as unknown as HttpAdapterHost,
  );
  beforeEach(() => {
    reply.mockClear();
    notify.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  it.each([
    circular,
    { amount: 1n },
    {
      toJSON() {
        throw new Error('snapshot failed');
      },
    },
  ])(
    'still sends the normal HTTP response when an exception cannot be serialized',
    (exception) => {
      expect(() => filter.catch(exception, host)).not.toThrow();
      expect(reply).toHaveBeenCalledWith(
        response,
        { statusCode: 500, message: 'Internal server error' },
        500,
      );
      const event = notify.mock.calls[0]?.[0] as AlertEvent;
      expect(event.request?.path).toBe('/test');
      expect(event.error?.name).toBe('UnknownException');
      expect(event.error?.message).toEqual(expect.any(String));
    },
  );
  it('preserves serializable error details and non-alerted client errors', () => {
    filter.catch({ reason: 'known' }, host);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { name: 'UnknownException', message: '{"reason":"known"}' },
      }),
    );
    notify.mockClear();
    filter.catch(new BadRequestException('bad input'), host);
    expect(notify).not.toHaveBeenCalled();
    expect(reply).toHaveBeenLastCalledWith(
      response,
      expect.objectContaining({ statusCode: 400, message: 'bad input' }),
      400,
    );
  });
});
