import type { Response as ExpressResponse } from 'express';
import { Readable } from 'stream';

/**
 * Pipe a Web API Response (from AI SDK) to an Express response.
 */
export async function pipeWebResponseToExpress(
  webResponse: globalThis.Response,
  expressRes: ExpressResponse,
) {
  webResponse.headers.forEach((value, key) => {
    expressRes.setHeader(key, value);
  });

  if (!webResponse.body) {
    expressRes.end();
    return;
  }

  const nodeStream = Readable.fromWeb(
    webResponse.body as import('stream/web').ReadableStream,
  );
  nodeStream.pipe(expressRes);
}
