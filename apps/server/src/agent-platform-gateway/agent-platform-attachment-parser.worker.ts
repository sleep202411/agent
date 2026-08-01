import { parentPort, workerData } from 'node:worker_threads';

import { HttpException } from '@nestjs/common';

import { inspectAgentAttachmentDocument } from './agent-platform-attachment-document';

if (!parentPort) {
  throw new Error('Agent attachment parser requires a worker port.');
}
const port = parentPort;

const input = workerData as {
  fileName: string;
  declaredMediaType: string;
  bytes: ArrayBuffer;
};

void inspectAgentAttachmentDocument({
  fileName: input.fileName,
  declaredMediaType: input.declaredMediaType,
  bytes: Buffer.from(input.bytes),
}).then(
  (projection) => port.postMessage({ ok: true, projection }),
  (error: unknown) => {
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const response =
      error instanceof HttpException
        ? error.getResponse()
        : {
            code: 'AGENT_ATTACHMENT_DOCUMENT_PARSER_CRASHED',
            message: 'The isolated document parser failed.',
          };
    port.postMessage({ ok: false, error: { status, response } });
  },
);
