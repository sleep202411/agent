/**
 * Wire-contract tests for chat attachment consumption.
 *
 * The web client uploads files via `/aurora/assistant/upload-attachment`
 * and embeds ONLY the returned `ref` (`att_xxx`) in the user message's
 * `metadata.attachments`. These tests pin the server side of that
 * contract: a ref-only attachment must be collected into
 * `requestContext.attachmentRefs` and its cached text must be inlined
 * into the LLM-facing message. A regression here (or a web-side filter
 * that drops the attachment before send) means uploaded files are
 * silently never consumed by the agent.
 */
const mockRedisStore = new Map<string, string>();

jest.mock('ioredis', () => {
  return class MockRedis {
    on() {
      return this;
    }
    async get(key: string) {
      return mockRedisStore.get(key) ?? null;
    }
    async set(key: string, value: string) {
      mockRedisStore.set(key, value);
      return 'OK';
    }
  };
});

import {
  collectAttachmentRefs,
  preprocessMessages,
} from './message-preprocess';

beforeEach(() => {
  mockRedisStore.clear();
});

describe('collectAttachmentRefs', () => {
  it('collects ref-only attachments (current web wire shape)', () => {
    const refs = collectAttachmentRefs([
      {
        role: 'user',
        metadata: {
          attachments: [
            {
              id: '1',
              name: 'script.docx',
              mimeType:
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ref: 'att_abc123',
            },
          ],
        },
        parts: [{ type: 'text', text: 'analyze this' }],
      },
    ]);
    expect(refs).toEqual(['att_abc123']);
  });

  it('still accepts legacy path-carried refs and inline markers, deduped oldest→newest', () => {
    const refs = collectAttachmentRefs([
      {
        role: 'user',
        metadata: { attachments: [{ path: 'att_legacy1' }] },
        parts: [],
      },
      {
        role: 'assistant',
        metadata: { attachments: [{ ref: 'att_from_assistant' }] },
        parts: [],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'earlier turn said [attachment "att_marker2"] here',
          },
        ],
      },
      {
        role: 'user',
        metadata: { attachments: [{ ref: 'att_legacy1' }] },
        parts: [],
      },
    ]);
    // assistant messages are ignored; duplicates collapse to first sighting
    expect(refs).toEqual(['att_legacy1', 'att_marker2']);
  });
});

describe('preprocessMessages', () => {
  it('inlines the cached text for a ref-only attachment and reuses its ref', async () => {
    mockRedisStore.set(
      'attachment:att_abc123',
      JSON.stringify({ text: 'FULL SCRIPT BODY', filename: 'script.docx' }),
    );

    const messages = [
      {
        role: 'user',
        metadata: {
          attachments: [
            {
              id: '1',
              name: 'script.docx',
              mimeType:
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ref: 'att_abc123',
            },
          ],
        },
        parts: [{ type: 'text', text: '帮我分析这个剧本', state: 'done' }],
      },
    ];

    await preprocessMessages(messages);

    const textPart = messages[0].parts.find((p) => p.type === 'text');
    expect(textPart?.text).toContain('帮我分析这个剧本');
    expect(textPart?.text).toContain('[attachment "att_abc123"]');
    expect(textPart?.text).toContain('FULL SCRIPT BODY');
    // Ref is reused, not re-minted — the cache must not grow.
    expect(mockRedisStore.size).toBe(1);
  });

  it('falls back to the client excerpt when the cached ref has expired', async () => {
    const messages = [
      {
        role: 'user',
        metadata: {
          attachments: [
            {
              id: '1',
              name: 'notes.txt',
              mimeType: 'text/plain',
              ref: 'att_expired',
              excerpt: 'EXCERPT ONLY',
            },
          ],
        },
        parts: [{ type: 'text', text: 'continue', state: 'done' }],
      },
    ];

    await preprocessMessages(messages);

    const textPart = messages[0].parts.find((p) => p.type === 'text');
    expect(textPart?.text).toContain('EXCERPT ONLY');
  });

  it('strips file parts so Mastra never tries to download them', async () => {
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'file',
            url: 'https://oss.example/x.docx',
            mediaType: 'application/pdf',
          },
          { type: 'text', text: 'hello', state: 'done' },
        ],
      },
    ];

    await preprocessMessages(messages);

    expect(messages[0].parts.map((p) => p.type)).toEqual(['text']);
  });
});
