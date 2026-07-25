import { HttpException } from '@nestjs/common';
import { parentPort, workerData } from 'node:worker_threads';
import { extractStudioAgentDocument } from './studio-agent-document.service';

interface ParserWorkerData {
  fileName: string;
  declaredMediaType: string;
  bytes: ArrayBuffer;
}

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error('Studio Agent document parser requires a worker port.');
  }
  const input = workerData as ParserWorkerData;
  try {
    const projection = await extractStudioAgentDocument({
      fileName: input.fileName,
      declaredMediaType: input.declaredMediaType,
      bytes: Buffer.from(input.bytes),
    });
    parentPort.postMessage({ ok: true, projection });
  } catch (cause: unknown) {
    const status = cause instanceof HttpException ? cause.getStatus() : 500;
    const response =
      cause instanceof HttpException
        ? cause.getResponse()
        : {
            code: 'STUDIO_AGENT_DOCUMENT_PARSER_CRASHED',
            message:
              cause instanceof Error
                ? cause.message
                : 'The isolated document parser failed.',
          };
    parentPort.postMessage({
      ok: false,
      error: { status, response },
    });
  }
}

void main();
