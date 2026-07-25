import {
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { join } from 'node:path';
import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { StudioAgentDocumentProjection } from './studio-agent-document.service';
import { StudioAgentConfigService } from './studio-agent.config';

export interface StudioAgentDocumentParserInput {
  fileName: string;
  declaredMediaType: string;
  bytes: Buffer;
}

interface ParserWorkerSuccess {
  ok: true;
  projection: StudioAgentDocumentProjection;
}

interface ParserWorkerFailure {
  ok: false;
  error: {
    status: number;
    response: string | Record<string, any>;
  };
}

type ParserWorkerResult = ParserWorkerSuccess | ParserWorkerFailure;

export interface StudioAgentDocumentParserRunnerOptions {
  timeoutMs: number;
  resourceLimits: ResourceLimits;
  workerFile?: string;
  createWorker?: (
    filename: string,
    options: ConstructorParameters<typeof Worker>[1],
  ) => Pick<Worker, 'once' | 'removeAllListeners' | 'terminate'>;
}

/**
 * Hard process boundary around untrusted PDF/DOCX parser implementations.
 *
 * The byte buffer is copied into an exact-sized transferable ArrayBuffer.
 * Parser packages therefore never execute on Nest's event loop, and a stuck,
 * crashing, or memory-exhausted parser is reduced to a bounded job failure.
 */
@Injectable()
export class StudioAgentDocumentParserRunner {
  constructor(private readonly config: StudioAgentConfigService) {}

  parse(
    input: StudioAgentDocumentParserInput,
  ): Promise<StudioAgentDocumentProjection> {
    const parser = this.config.value.documentIngest.parser;
    return runStudioAgentDocumentParserWorker(input, {
      timeoutMs: parser.timeoutMs,
      resourceLimits: {
        maxOldGenerationSizeMb: parser.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: parser.maxYoungGenerationSizeMb,
        codeRangeSizeMb: parser.codeRangeSizeMb,
        stackSizeMb: parser.stackSizeMb,
      },
    });
  }
}

export function runStudioAgentDocumentParserWorker(
  input: StudioAgentDocumentParserInput,
  options: StudioAgentDocumentParserRunnerOptions,
): Promise<StudioAgentDocumentProjection> {
  const exactBytes = Uint8Array.from(input.bytes);
  const workerFile =
    options.workerFile ??
    join(__dirname, 'studio-agent-document-parser.worker.js');
  const createWorker =
    options.createWorker ??
    ((filename, workerOptions) => new Worker(filename, workerOptions));

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = createWorker(workerFile, {
      workerData: {
        fileName: input.fileName,
        declaredMediaType: input.declaredMediaType,
        bytes: exactBytes.buffer,
      },
      transferList: [exactBytes.buffer],
      resourceLimits: options.resourceLimits,
    });

    const finish = (
      result:
        | { ok: true; value: StudioAgentDocumentProjection }
        | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeAllListeners();
      void worker.terminate().catch(() => undefined);
      if (result.ok) resolve(result.value);
      else reject(result.error);
    };

    const timeout = setTimeout(() => {
      finish({
        ok: false,
        error: new GatewayTimeoutException({
          code: 'STUDIO_AGENT_DOCUMENT_PARSER_TIMEOUT',
          message: 'The document parser exceeded its execution time limit.',
        }),
      });
    }, options.timeoutMs);
    timeout.unref?.();

    worker.once('message', (message: ParserWorkerResult) => {
      if (message?.ok === true) {
        finish({ ok: true, value: message.projection });
        return;
      }
      if (message?.ok === false) {
        finish({
          ok: false,
          error: new HttpException(
            message.error.response,
            message.error.status,
          ),
        });
        return;
      }
      finish({
        ok: false,
        error: parserWorkerUnavailable(
          'The document parser returned an invalid result.',
        ),
      });
    });
    worker.once('error', (cause: Error) => {
      finish({
        ok: false,
        error: parserWorkerUnavailable(cause.message),
      });
    });
    worker.once('exit', (code: number) => {
      if (settled) return;
      finish({
        ok: false,
        error: parserWorkerUnavailable(
          `The document parser stopped before returning a result (exit ${code}).`,
        ),
      });
    });
  });
}

function parserWorkerUnavailable(detail: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'STUDIO_AGENT_DOCUMENT_PARSER_CRASHED',
    message: 'The isolated document parser stopped unexpectedly.',
    detail: detail.slice(0, 1_000),
  });
}
