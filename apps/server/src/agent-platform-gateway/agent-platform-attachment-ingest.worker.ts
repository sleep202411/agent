import { parentPort, workerData } from 'node:worker_threads';

import {
  HttpException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { buildStorySourceMaterialIndex } from '../agent-domain-gateway/story-source-material-index';
import {
  AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES,
  inspectAgentAttachmentDocument,
} from './agent-platform-attachment-document';

if (!parentPort) {
  throw new Error('Agent attachment ingest requires a worker port.');
}
const port = parentPort;

const input = workerData as {
  fileName: string;
  declaredMediaType: string;
  downloadUrl: string;
  expectedSizeBytes: number;
};

void ingest().then(
  (result) => port.postMessage({ ok: true, result }),
  (error: unknown) => {
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const response =
      error instanceof HttpException
        ? error.getResponse()
        : {
            code: 'AGENT_ATTACHMENT_DOCUMENT_INGEST_CRASHED',
            message: 'The isolated document ingest worker failed.',
            retryable: true,
          };
    port.postMessage({ ok: false, error: { status, response } });
  },
);

async function ingest() {
  const bytes = await download();
  const projection = await inspectAgentAttachmentDocument({
    fileName: input.fileName,
    declaredMediaType: input.declaredMediaType,
    bytes,
  });
  if (projection.kind !== 'document_text') {
    throw new ServiceUnavailableException({
      code: 'AGENT_ATTACHMENT_PROJECTION_KIND_MISMATCH',
      message: 'The document ingest worker produced a non-text projection.',
      retryable: true,
    });
  }
  return {
    projection,
    sourceIndex: buildStorySourceMaterialIndex({
      text: projection.text,
      fileName: input.fileName,
      contentHash: projection.contentHash,
    }),
  };
}

async function download(): Promise<Buffer> {
  if (
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes <= 0 ||
    input.expectedSizeBytes > AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES
  ) {
    throw tooLarge(input.expectedSizeBytes);
  }
  const url = new URL(input.downloadUrl);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    )
  ) {
    throw storageUnavailable();
  }

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'error' });
  } catch {
    throw storageUnavailable();
  }
  if (!response.ok || !response.body) throw storageUnavailable();
  const declaredLengthHeader = response.headers.get('content-length');
  if (declaredLengthHeader !== null) {
    const declaredLength = Number(declaredLengthHeader);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength !== input.expectedSizeBytes
    ) {
      await response.body.cancel();
      throw sizeMismatch(
        Number.isSafeInteger(declaredLength) ? declaredLength : -1,
      );
    }
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      total += chunk.length;
      if (
        total > input.expectedSizeBytes ||
        total > AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES
      ) {
        await reader.cancel();
        throw tooLarge(total);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw storageUnavailable();
  }
  if (total !== input.expectedSizeBytes) throw sizeMismatch(total);
  return Buffer.concat(chunks, total);
}

function tooLarge(actualBytes: number): PayloadTooLargeException {
  return new PayloadTooLargeException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_FILE_TOO_LARGE',
    message: 'Document files must be 10MB or smaller.',
    maximumBytes: AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES,
    actualBytes,
    retryable: false,
  });
}

function sizeMismatch(actualBytes: number): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_SIZE_MISMATCH',
    message: 'The stored document size changed before it could be parsed.',
    expectedBytes: input.expectedSizeBytes,
    actualBytes,
    retryable: false,
  });
}

function storageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'AGENT_ATTACHMENT_STORAGE_UNAVAILABLE',
    message: 'The uploaded attachment could not be read from media storage.',
    retryable: true,
  });
}
