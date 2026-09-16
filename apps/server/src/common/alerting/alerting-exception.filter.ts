import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { AlertingService } from './alerting.service';

type HeaderValue = string | string[] | undefined;
type HttpRequestLike = {
  method?: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, HeaderValue>;
};

@Catch()
export class AlertingExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  constructor(
    private readonly alerts: AlertingService,
    adapterHost: HttpAdapterHost,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      this.alertHttpException(exception, host);
    }
    super.catch(exception, host);
  }

  private alertHttpException(exception: unknown, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (statusCode < 500) return;

    const request = host.switchToHttp().getRequest<HttpRequestLike>();
    const method = request.method ?? 'UNKNOWN';
    const path = sanitizePath(request.originalUrl ?? request.url ?? '');
    const normalizedPath = normalizePath(path);
    const error = errorSnapshot(exception);
    this.alerts.notify({
      kind: 'server_http_exception',
      severity: statusCode >= 500 ? 'error' : 'warning',
      source: 'server.http',
      title: `Server HTTP ${statusCode}`,
      summary: `${method} ${path} failed with ${error.name ?? 'Exception'}: ${
        error.message ?? 'unknown error'
      }`,
      occurredAt: new Date().toISOString(),
      fingerprint: [
        'server_http_exception',
        method,
        normalizedPath,
        statusCode,
        error.code,
        error.name,
        error.message,
      ]
        .filter(Boolean)
        .join('|'),
      request: {
        method,
        path,
        statusCode,
        requestId:
          header(request, 'x-request-id') ??
          header(request, 'x-correlation-id') ??
          header(request, 'request-id'),
        userAgent: header(request, 'user-agent'),
        ip:
          header(request, 'x-forwarded-for') ??
          request.ip ??
          request.socket?.remoteAddress,
      },
      error,
      context: {
        httpStatus: statusCode,
        response:
          exception instanceof HttpException
            ? exception.getResponse()
            : undefined,
      },
      tags: ['server', 'http', '5xx'],
    });
  }
}

function errorSnapshot(exception: unknown): {
  code?: string;
  name?: string;
  message?: string;
  stack?: string;
} {
  if (exception instanceof Error) {
    const withCode = exception as Error & { code?: string };
    return {
      code: typeof withCode.code === 'string' ? withCode.code : undefined,
      name: exception.name,
      message: exception.message,
      stack: exception.stack,
    };
  }
  return {
    name: 'UnknownException',
    message:
      typeof exception === 'string'
        ? exception
        : serializeUnknownException(exception),
  };
}

function serializeUnknownException(exception: unknown): string {
  try {
    return JSON.stringify(exception ?? null) ?? 'Unknown thrown value';
  } catch {
    return 'Unserializable thrown value';
  }
}

function header(request: HttpRequestLike, name: string): string | undefined {
  const value = request.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function sanitizePath(path: string): string {
  const [withoutQuery] = path.split('?');
  return withoutQuery || '/';
}

function normalizePath(path: string): string {
  return path
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      '/:uuid',
    )
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:hex')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}
