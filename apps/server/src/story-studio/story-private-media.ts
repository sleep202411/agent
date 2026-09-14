import { BadGatewayException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';

/** Authorize every request before streaming. Paid viewers never receive a
 * permanent origin URL; Range requests still support seeking without buffering. */
export async function streamStoryPrivateMedia(
  url: string,
  response: Response,
  range?: string,
): Promise<void> {
  const controller = new AbortController();
  const disconnect = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.on('close', disconnect);
  const headerTimeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: range ? { range } : undefined,
      cache: 'no-store',
      redirect: 'error',
    });
    clearTimeout(headerTimeout);
    if (upstream.status === 416) {
      response.status(416);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) response.setHeader('content-range', contentRange);
      await upstream.body?.cancel();
      response.end();
      return;
    }
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      throw new BadGatewayException('The story media could not be loaded.');
    }
    response.status(upstream.status);
    for (const header of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
    ]) {
      const value = upstream.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    await pipeline(
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
      response,
    );
  } catch (error) {
    if (response.destroyed) return;
    if (response.headersSent)
      response.destroy(error instanceof Error ? error : undefined);
    else
      throw error instanceof BadGatewayException
        ? error
        : new BadGatewayException('The story media could not be loaded.');
  } finally {
    clearTimeout(headerTimeout);
    response.off('close', disconnect);
  }
}
