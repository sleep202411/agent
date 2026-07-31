import { HttpException } from '@nestjs/common';
import { EventEmitter } from 'node:events';

import {
  AgentPlatformAttachmentParser,
  runAgentAttachmentParser,
} from './agent-platform-attachment-parser';

class SilentWorker extends EventEmitter {
  readonly terminate = jest.fn(() => Promise.resolve(0));
}

describe('Agent Platform isolated attachment parser', () => {
  it('terminates a parser that exceeds its hard execution deadline', async () => {
    const worker = new SilentWorker();

    const error = await runAgentAttachmentParser(
      {
        fileName: 'story.txt',
        declaredMediaType: 'text/plain',
        bytes: Buffer.from('story', 'utf8'),
      },
      {
        timeoutMs: 5,
        resourceLimits: {
          maxOldGenerationSizeMb: 32,
          maxYoungGenerationSizeMb: 8,
          codeRangeSizeMb: 8,
          stackSizeMb: 1,
        },
        workerFile: '/test/parser.worker.js',
        createWorker: () => worker as never,
      },
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'AGENT_ATTACHMENT_DOCUMENT_PARSER_TIMEOUT',
    });

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.eventNames()).toHaveLength(0);
  });

  it('never runs more worker threads than the declared parser concurrency', async () => {
    const workers: SilentWorker[] = [];
    const parser = new AgentPlatformAttachmentParser({
      values: {
        attachmentParserConcurrency: 2,
        attachmentIngestTimeoutMs: 60_000,
        attachmentParser: {
          timeoutMs: 60_000,
          resourceLimits: {
            maxOldGenerationSizeMb: 192,
            maxYoungGenerationSizeMb: 32,
            codeRangeSizeMb: 32,
            stackSizeMb: 4,
          },
          workerFile: '/test/ingest.worker.js',
          createWorker: () => {
            const worker = new SilentWorker();
            workers.push(worker);
            return worker as never;
          },
        },
      },
    } as never);

    const ingests = Array.from({ length: 3 }, (_, index) =>
      parser
        .ingest({
          fileName: `story-${index}.md`,
          declaredMediaType: 'text/markdown',
          downloadUrl: `https://media.example.com/${index}`,
          expectedSizeBytes: 16,
        })
        .catch(() => undefined),
    );
    await Promise.resolve();
    expect(workers).toHaveLength(2);

    workers[0].emit('message', {
      ok: false,
      error: { status: 503, response: {} },
    });
    await ingests[0];
    expect(workers).toHaveLength(3);

    for (const worker of workers.slice(1)) {
      worker.emit('message', {
        ok: false,
        error: { status: 503, response: {} },
      });
    }
    await Promise.all(ingests);
    expect(workers).toHaveLength(3);
  });
});
