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
  /** Storage identifier — either an OSS path (legacy URL-fetch flow)
   *  or the Redis ref (`att_xxx`) returned by `/upload-attachment`. We
   *  detect which by looking at the prefix in `extractAttachmentText`. */
  path?: string;
  excerpt?: string;
  /** Set explicitly when the attachment was uploaded via the
   *  direct-buffer endpoint (`/upload-attachment`). Tail-fall-through:
   *  if missing, we also accept `path` when it starts with `att_`. */
  ref?: string;
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
  // OSS read-after-write isn't strongly consistent on newly uploaded objects.
  // On fizzstudio-sg's cross-region setup we observed that the FIRST GET
  // always 404s — propagation takes a few seconds minimum. So we skip the
  // immediate probe and wait 3s before the first attempt, then back off
  // more gently for the stubborn cases.
  const delays = [3000, 1500, 2500, 4000, 6000];
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

async function extractFromDocxBuffer(buf: Buffer): Promise<string> {
  // Same logic as extractFromDocx but takes the buffer directly — used
  // by the upload-attachment endpoint where the file body arrives as
  // multipart and we don't need to re-fetch it from OSS.
  const result = await mammoth.convertToHtml({ buffer: buf });
  const plain = result.value
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return plain.trim();
}

async function extractFromPdfBuffer(buf: Buffer): Promise<string> {
  const mod = (await import('pdf-parse')) as
    | { default: (b: Buffer) => Promise<{ text: string }> }
    | ((b: Buffer) => Promise<{ text: string }>);
  const fn = typeof mod === 'function' ? mod : mod.default;
  const result = await fn(buf);
  return (result.text ?? '').trim();
}

async function extractFromDocx(url: string): Promise<string> {
  const buf = await fetchBinary(url);
  // Use convertToHtml instead of extractRawText so soft line breaks (<w:br/>)
  // surface as line boundaries — extractRawText silently swallows them, which
  // collapses scripts authored as one mega-paragraph + 2000+ <br>s into a
  // single flat string. Empirically this is the difference between 1 line
  // and 1986 lines for screenplays that use soft returns between scene
  // headings (very common with film-script docx exports).
  //
  // After conversion: turn each </p> and <br> into \n, drop everything else,
  // decode the four entity escapes mammoth emits. Plain text out, paragraph
  // structure preserved — downstream parse_script's line-numbered prompt
  // gets meaningful chunks instead of one giant blob.
  const result = await mammoth.convertToHtml({ buffer: buf });
  const plain = result.value
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return plain.trim();
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
  // Direct-upload path — full text already in Redis, just read it.
  // Accept either an explicit `ref` or a `path` that looks like one
  // (the chat slice ships its ref through `path` for back-compat with
  // the existing AssistantAttachment shape).
  const directRef =
    attachment.ref ??
    (attachment.path && attachment.path.startsWith('att_')
      ? attachment.path
      : undefined);
  if (directRef) {
    try {
      const cached = await getRedis().get(`attachment:${directRef}`);
      if (cached) {
        const parsed = JSON.parse(cached) as { text?: string };
        if (typeof parsed.text === 'string' && parsed.text.length > 0) {
          return parsed.text;
        }
      }
      log.warn(
        `Attachment ref=${directRef} not found in Redis (TTL expired?); falling back to excerpt.`,
      );
    } catch (err) {
      log.warn(
        `Failed to read attachment:${directRef}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
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
    `[attachment "${ref}"] ${filename ?? 'file'}`,
    `- 总字数: ${text.length}`,
    '- 预览（节选）:',
    preview + (truncated ? '…' : ''),
    '',
    `⚠️ 完整正文已缓存（TTL 1 小时）。调用 ask_* persona 工具时, 在参数里传 textRef: "${ref}", 服务器会自动取回完整正文并作为 [Source material] 注入。如果你忘了传, 服务器也会从 requestContext.attachmentRefs 兜底注入这条 ref, 但显式传入更可靠。严禁把正文复制到 task 字段。`,
  ].join('\n');
}

/**
 * Main entry — mutates messages in place:
 *   - Strips `file` parts
 *   - For each user message with attachments, injects their text into the
 *     existing `text` part (or prepends a new one if none exists).
 */
/**
 * Direct buffer ingestion path — bypasses OSS entirely. Called by
 * the upload-attachment HTTP endpoint when web ships the raw file
 * body. Mirrors the legacy URL-fetch flow but keeps the file in
 * memory: extract → cache the text in Redis under `attachment:{ref}`
 * → return the ref + a short excerpt.
 *
 * Web embeds the returned `ref` (and the excerpt for the file card
 * preview) in the user message just like before. Downstream
 * `preprocessMessages` finds the cached text under that ref and
 * inlines it into the LLM-facing message body — no OSS round-trip,
 * no NoSuchKey races.
 */
export async function ingestAttachmentBuffer(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ ref: string; chars: number; excerpt: string }> {
  const { buffer, filename, mimeType } = input;
  let text = '';
  try {
    if (isDocx(mimeType, filename)) {
      text = await extractFromDocxBuffer(buffer);
    } else if (isPdf(mimeType, filename)) {
      text = await extractFromPdfBuffer(buffer);
    } else if (isTextLike(mimeType, filename)) {
      text = buffer.toString('utf-8').trim();
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }
  } catch (err) {
    log.warn(
      `ingestAttachmentBuffer extract failed for ${filename}: ${err instanceof Error ? err.message : err}`,
    );
    throw err;
  }
  const ref = await cacheAttachment(text, { filename, mimeType });
  log.log(
    `Ingested attachment ${filename} as ${ref} (${text.length} chars, direct buffer)`,
  );
  return {
    ref,
    chars: text.length,
    excerpt: text.slice(0, 800),
  };
}

/**
 * Walk the message history and collect every `att_xxx` ref that's
 * still resolvable. Used by the controller to seed
 * `requestContext.attachmentRefs` so that ask_* tools can fall back
 * to the latest attachment when the LLM forgets to pass `textRef`
 * explicitly. This is the server-side guarantee that the persona
 * always sees source material if the user uploaded one — no
 * dependence on supervisor diligence.
 *
 * Order: oldest → newest, so callers can `at(-1)` for the most recent.
 * Dedup'd to avoid duplicates when the same ref appears across turns.
 *
 * The walk reads two locations on every user message:
 *   1. `metadata.attachments[].ref` (and `.path` when it starts with `att_`)
 *   2. `[attachment "att_xxx"]` markers inline in text parts (covers
 *      messages whose attachments were already resolved server-side
 *      on a previous turn — the marker survives but `metadata` may not)
 */
export function collectAttachmentRefs(messages: Message[]): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  const push = (ref: string | undefined) => {
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    refs.push(ref);
  };
  const markerRegex = /\[attachment\s+"(att_[A-Za-z0-9_-]+)"\]/g;
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    for (const a of msg.metadata?.attachments ?? []) {
      push(a.ref);
      if (a.path?.startsWith('att_')) push(a.path);
    }
    for (const part of msg.parts ?? []) {
      const text = part.text;
      if (typeof text !== 'string' || text.length === 0) continue;
      for (const match of text.matchAll(markerRegex)) push(match[1]);
    }
  }
  return refs;
}

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
      // Reuse the existing cache key when the client uploaded via the
      // direct-buffer endpoint; only mint a fresh one for legacy
      // url-fetch paths. Avoids doubling the Redis footprint and
      // keeps the ref the user's chat history already references.
      const existingRef =
        attachment.ref ??
        (attachment.path && attachment.path.startsWith('att_')
          ? attachment.path
          : undefined);
      const ref =
        existingRef ??
        (await cacheAttachment(raw, {
          filename: attachment.name,
          mimeType: attachment.mimeType,
        }));
      log.log(
        `Attachment ${attachment.name ?? 'file'} → ${ref} (${raw.length} chars${existingRef ? ', reused' : ', re-cached'})`,
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
