/**
 * Preprocess user messages before forwarding to Mastra.
 *
 * Problem: the web client emits `file` parts with URLs pointing at OSS / Java
 * storage. Mastra's chatRoute tries to download those URLs and pass them to
 * the model, but OSS returns 404 (signed-URL quirks) and Java returns 401
 * (cookie-auth). Either way the LLM call fails.
 *
 * Fix: run a server-side preprocess pass that
 *   1. extracts text from every attachment (txt/md/docx/pdf)
 *   2. strips `file` parts out of the message so Mastra never tries to fetch
 *   3. injects the extracted text into the user's text part, capped at
 *      MAX_EXCERPT_CHARS to match the "限 6000 字" UI hint
 *
 * Keeps Mastra's request shape simple — just text in, text/tool-calls out.
 */
import { randomBytes } from 'crypto';
import mammoth from 'mammoth';
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';

const log = new Logger('MessagePreprocess');

/** Preview length embedded in the user message (enough for the agent to route). */
const PREVIEW_CHARS = 800;
/** Cached attachment TTL — plenty for one chat turn + a slow workflow. */
const ATTACHMENT_TTL_SEC = 3600;

let redisClient: Redis | null = null;
function getRedis(): Redis {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  redisClient = url ? new Redis(url) : new Redis();
  redisClient.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[message-preprocess redis]', err?.message ?? err);
  });
  return redisClient;
}

function newAttachmentRef(): string {
  return `att_${randomBytes(6).toString('hex')}`;
}

type Attachment = {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
  excerpt?: string;
};

type MessagePart = {
  type?: string;
  text?: string;
  state?: string;
  mediaType?: string;
  filename?: string;
  url?: string;
  [k: string]: unknown;
};

type Message = {
  role?: string;
  metadata?: { attachments?: Attachment[] };
  parts?: MessagePart[];
  [k: string]: unknown;
};

function isDocx(mime?: string, name?: string): boolean {
  if (mime?.includes('wordprocessingml.document')) return true;
  return !!name && /\.docx$/i.test(name);
}

function isPdf(mime?: string, name?: string): boolean {
  if (mime === 'application/pdf') return true;
  return !!name && /\.pdf$/i.test(name);
}

function isTextLike(mime?: string, name?: string): boolean {
  if (mime?.startsWith('text/')) return true;
  return !!name && /\.(txt|md|markdown|json|csv|tsv)$/i.test(name);
}

async function fetchBinary(url: string): Promise<Buffer> {
  // OSS read-after-write isn't strongly consistent on newly uploaded objects —
  // a file the client just finished PUTting can 404 for a few hundred ms, and
  // in practice we've seen the window stretch past 3s on cross-region buckets.
  const delays = [0, 500, 1000, 2000, 3000, 5000];
  let lastStatus = 0;
  let lastBody = '';
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i];
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 storyos-preprocess' },
    });
    if (res.ok) {
      if (i > 0) {
        const elapsed = delays.slice(0, i + 1).reduce((a, b) => a + b, 0);
        log.log(`Fetch succeeded on attempt ${i + 1} after ~${elapsed}ms`);
      }
      const arr = new Uint8Array(await res.arrayBuffer());
      return Buffer.from(arr);
    }
    lastStatus = res.status;
    lastBody = await res.text().catch(() => '');
    log.warn(
      `Attempt ${i + 1}/${delays.length} HTTP ${res.status} for ${url} body=${lastBody.slice(0, 300)}`,
    );
    if (res.status !== 404 && res.status !== 403 && res.status < 500) {
      break;
    }
  }
  throw new Error(
    `HTTP ${lastStatus} after retries: ${url} body=${lastBody.slice(0, 200)}`,
  );
}

async function extractFromDocx(url: string): Promise<string> {
  const buf = await fetchBinary(url);
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value.trim();
}

async function extractFromPdf(url: string): Promise<string> {
  const buf = await fetchBinary(url);
  // pdf-parse is CommonJS; dynamic import works in ESM contexts.
  const mod = (await import('pdf-parse')) as
    | { default: (b: Buffer) => Promise<{ text: string }> }
    | ((b: Buffer) => Promise<{ text: string }>);
  const fn = typeof mod === 'function' ? mod : mod.default;
  const result = await fn(buf);
  return (result.text ?? '').trim();
}

async function extractFromText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 storyos-preprocess' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return (await res.text()).trim();
}

async function extractAttachmentText(attachment: Attachment): Promise<string> {
  // Prefer client-provided excerpt when available (txt/md are read client-side).
  if (attachment.excerpt && attachment.excerpt.length > 0) {
    return attachment.excerpt;
  }
  if (!attachment.url) return '';

  log.log(
    `Extracting ${attachment.name ?? 'file'} (${attachment.mimeType ?? '?'}) url=${attachment.url}`,
  );

  try {
    if (isDocx(attachment.mimeType, attachment.name)) {
      return await extractFromDocx(attachment.url);
    }
    if (isPdf(attachment.mimeType, attachment.name)) {
      return await extractFromPdf(attachment.url);
    }
    if (isTextLike(attachment.mimeType, attachment.name)) {
      return await extractFromText(attachment.url);
    }
  } catch (err) {
    log.warn(
      `Failed to extract text from ${attachment.name ?? 'file'}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return '';
}

async function cacheAttachment(
  text: string,
  meta: { filename?: string; mimeType?: string },
): Promise<string> {
  const ref = newAttachmentRef();
  const payload = JSON.stringify({
    text,
    filename: meta.filename,
    mimeType: meta.mimeType,
    chars: text.length,
    cachedAt: Date.now(),
  });
  await getRedis().set(`attachment:${ref}`, payload, 'EX', ATTACHMENT_TTL_SEC);
  return ref;
}

function buildAttachmentBlock(
  text: string,
  ref: string,
  filename: string | undefined,
): string {
  const preview = text.slice(0, PREVIEW_CHARS);
  const truncated = text.length > PREVIEW_CHARS;
  return [
    `[附件「${filename ?? 'file'}」]`,
    `- 引用标识: ${ref}`,
    `- 总字数: ${text.length}`,
    '- 预览（节选）:',
    preview + (truncated ? '…' : ''),
    '',
    `⚠️ 完整正文已缓存（TTL 1 小时）。调用 invoke_workflow 时, 在 inputData 中传 {"textRef": "${ref}"} 即可, 服务器会自动取回完整正文并填入 text 字段。严禁复制正文到 inputData, 否则 JSON 会过大解析失败。`,
  ].join('\n');
}

/**
 * Main entry — mutates messages in place:
 *   - Strips `file` parts
 *   - For each user message with attachments, injects their text into the
 *     existing `text` part (or prepends a new one if none exists).
 */
export async function preprocessMessages(messages: Message[]): Promise<void> {
  for (const msg of messages) {
    if (msg.role !== 'user') continue;

    const parts = msg.parts ?? [];
    const attachments = msg.metadata?.attachments ?? [];

    // Strip file parts — Mastra shouldn't try to download them.
    const nonFileParts = parts.filter((p) => p.type !== 'file');

    if (attachments.length === 0) {
      msg.parts = nonFileParts;
      continue;
    }

    const extractedBlocks: string[] = [];
    for (const attachment of attachments) {
      const raw = await extractAttachmentText(attachment);
      if (!raw) continue;
      const ref = await cacheAttachment(raw, {
        filename: attachment.name,
        mimeType: attachment.mimeType,
      });
      log.log(
        `Cached attachment ${attachment.name ?? 'file'} as ${ref} (${raw.length} chars)`,
      );
      extractedBlocks.push(buildAttachmentBlock(raw, ref, attachment.name));
    }

    if (extractedBlocks.length === 0) {
      msg.parts = nonFileParts;
      continue;
    }

    // Find existing text part to merge into; otherwise create one up front.
    const existingTextIdx = nonFileParts.findIndex((p) => p.type === 'text');
    const mergedText = [
      existingTextIdx >= 0 ? (nonFileParts[existingTextIdx].text ?? '') : '',
      ...extractedBlocks,
    ]
      .filter((s) => s.length > 0)
      .join('\n\n');

    if (existingTextIdx >= 0) {
      nonFileParts[existingTextIdx] = {
        ...nonFileParts[existingTextIdx],
        text: mergedText,
      };
      msg.parts = nonFileParts;
    } else {
      msg.parts = [
        { type: 'text', text: mergedText, state: 'done' },
        ...nonFileParts,
      ];
    }
  }
}
