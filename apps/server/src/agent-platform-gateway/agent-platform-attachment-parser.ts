import {
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { join } from 'node:path';
import { Worker, type ResourceLimits } from 'node:worker_threads';

import { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';
import type { AgentAttachmentDocumentProjection } from './agent-platform-attachment-document';
import type { StorySourceMaterialIndex } from '../agent-domain-gateway/story-source-material-index';

type ParserInput = Readonly<{
  fileName: string;
  declaredMediaType: string;
  bytes: Buffer;
}>;

type ParserWorkerResult =
  | Readonly<{ ok: true; projection: AgentAttachmentDocumentProjection }>
  | Readonly<{
      ok: false;
      error: { status: number; response: string | Record<string, unknown> };
    }>;

export type AgentAttachmentIngestResult = Readonly<{
  projection: Extract<
    AgentAttachmentDocumentProjection,
    { kind: 'document_text' }
  >;
  sourceIndex: StorySourceMaterialIndex;
}>;

type IngestWorkerResult =
  | Readonly<{ ok: true; result: AgentAttachmentIngestResult }>
  | Readonly<{
      ok: false;
      error: { status: number; response: string | Record<string, unknown> };
    }>;

export interface AgentAttachmentParserOptions {
  timeoutMs: number;
  resourceLimits: ResourceLimits;
  workerFile?: string;
  createWorker?: (
    filename: string,
    options: ConstructorParameters<typeof Worker>[1],
  ) => Pick<Worker, 'once' | 'removeAllListeners' | 'terminate'>;
}

@Injectable()
export class AgentPlatformAttachmentParser {
  readonly #config: AgentPlatformGatewayConfigService['values'];
  readonly #waiting: Array<() => void> = [];
  #activeWorkers = 0;

  constructor(config: AgentPlatformGatewayConfigService) {
    this.#config = config.values;
  }

  parse(input: ParserInput): Promise<AgentAttachmentDocumentProjection> {
    return this.withWorkerSlot(() =>
      runAgentAttachmentParser(input, this.#config.attachmentParser),
    );
  }

  ingest(input: {
    fileName: string;
    declaredMediaType: string;
    downloadUrl: string;
    expectedSizeBytes: number;
  }): Promise<AgentAttachmentIngestResult> {
    return this.withWorkerSlot(() =>
      runAgentAttachmentIngest(input, {
        ...this.#config.attachmentParser,
        timeoutMs: this.#config.attachmentIngestTimeoutMs,
      }),
    );
  }

  /**
   * Bound how many parser Workers exist in this pod at once.
   *
   * Each Worker may grow to `maxOldGenerationSizeMb` of heap inside the
   * product API process, so the memory ceiling has to be enforced where the
   * Workers are spawned. The ingest batch size bounds claimed jobs, not
   * concurrent extraction, and every claimed job is processed in parallel.
   */
  private async withWorkerSlot<T>(run: () => Promise<T>): Promise<T> {
    if (this.#activeWorkers >= this.#config.attachmentParserConcurrency) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#activeWorkers += 1;
    }
    try {
      return await run();
    } finally {
      // The slot is handed straight to the next waiter; releasing it first
      // would let a fresh caller overtake the queue and exceed the ceiling.
      const next = this.#waiting.shift();
      if (next) next();
      else this.#activeWorkers -= 1;
    }
  }
}

export function runAgentAttachmentIngest(
  input: {
    fileName: string;
    declaredMediaType: string;
    downloadUrl: string;
    expectedSizeBytes: number;
  },
  options: AgentAttachmentParserOptions,
): Promise<AgentAttachmentIngestResult> {
  const workerFile =
    options.workerFile ??
    join(__dirname, 'agent-platform-attachment-ingest.worker.js');
  const createWorker =
    options.createWorker ??
    ((filename, workerOptions) => new Worker(filename, workerOptions));

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = createWorker(workerFile, {
      workerData: input,
      resourceLimits: options.resourceLimits,
    });
    const finish = (
      result:
        | { ok: true; value: AgentAttachmentIngestResult }
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
          code: 'AGENT_ATTACHMENT_INGEST_TIMEOUT',
          message:
            'Document download, extraction, and indexing exceeded the execution time limit.',
          retryable: true,
        }),
      });
    }, options.timeoutMs);
    timeout.unref?.();

    worker.once('message', (message: IngestWorkerResult) => {
      if (message?.ok === true) {
        finish({ ok: true, value: message.result });
      } else if (message?.ok === false) {
        finish({
          ok: false,
          error: new HttpException(
            message.error.response,
            message.error.status,
          ),
        });
      } else {
        finish({
          ok: false,
          error: parserUnavailable(
            'The document ingest worker returned an invalid result.',
          ),
        });
      }
    });
    worker.once('error', (error: Error) => {
      finish({ ok: false, error: parserUnavailable(error.message) });
    });
    worker.once('exit', (code: number) => {
      if (!settled) {
        finish({
          ok: false,
          error: parserUnavailable(
            `The document ingest worker stopped before returning a result (exit ${code}).`,
          ),
        });
      }
    });
  });
}

export function runAgentAttachmentParser(
  input: ParserInput,
  options: AgentAttachmentParserOptions,
): Promise<AgentAttachmentDocumentProjection> {
  const exactBytes = Uint8Array.from(input.bytes);
  const workerFile =
    options.workerFile ??
    join(__dirname, 'agent-platform-attachment-parser.worker.js');
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
        | { ok: true; value: AgentAttachmentDocumentProjection }
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
          code: 'AGENT_ATTACHMENT_DOCUMENT_PARSER_TIMEOUT',
          message: 'The document parser exceeded its execution time limit.',
        }),
      });
    }, options.timeoutMs);
    timeout.unref?.();

    worker.once('message', (message: ParserWorkerResult) => {
      if (message?.ok === true) {
        finish({ ok: true, value: message.projection });
      } else if (message?.ok === false) {
        finish({
          ok: false,
          error: new HttpException(
            message.error.response,
            message.error.status,
          ),
        });
      } else {
        finish({
          ok: false,
          error: parserUnavailable(
            'The document parser returned an invalid result.',
          ),
        });
      }
    });
    worker.once('error', (error: Error) => {
      finish({ ok: false, error: parserUnavailable(error.message) });
    });
    worker.once('exit', (code: number) => {
      if (!settled) {
        finish({
          ok: false,
          error: parserUnavailable(
            `The document parser stopped before returning a result (exit ${code}).`,
          ),
        });
      }
    });
  });
}

function parserUnavailable(detail: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_PARSER_CRASHED',
    message: 'The isolated document parser stopped unexpectedly.',
    detail: detail.slice(0, 1_000),
  });
}
