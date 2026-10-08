import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';
import type { AlertEvent, AlertSeverity } from './alerting.types';
import { backgroundTasksEnabled } from '../background-tasks';

interface AlertingConfig {
  enabled: boolean;
  webhookUrl: string | null;
  secret: string | null;
  environment: string;
  dedupeTtlSeconds: number;
  timeoutMs: number;
}

const DEFAULT_DEDUPE_TTL_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_CARD_CHARS = 14_000;
const MAX_DETAIL_CHARS = 7_000;
const MAX_STRING_CHARS = 700;
const MAX_STACK_LINES = 12;
const LOCAL_DEDUPE_MAX_KEYS = 1_000;
const REDIS_DEDUPE_TIMEOUT_MS = 1_000;

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);
  private readonly localDedupe = new Map<string, number>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  notify(event: AlertEvent): void {
    if (!backgroundTasksEnabled()) return;
    void this.dispatch(event).catch((err) => {
      this.logger.warn(
        `Alert dispatch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  async dispatch(event: AlertEvent): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const config = this.readConfig();
    if (!config.enabled || !config.webhookUrl) return;

    const fingerprint = this.fingerprintFor(event);
    const shouldSend = await this.claimDedupe(
      fingerprint,
      config.dedupeTtlSeconds,
    );
    if (!shouldSend) return;

    const payload = this.buildFeishuPayload(event, config);
    await this.post(config.webhookUrl, payload, config.timeoutMs);
  }

  private readConfig(): AlertingConfig {
    const webhookUrl =
      cleanEnv(process.env.FEISHU_ALERT_WEBHOOK_URL) ??
      cleanEnv(process.env.FEISHU_BOT_WEBHOOK_URL);
    return {
      enabled: boolEnv(process.env.FEISHU_ALERT_ENABLED, true),
      webhookUrl,
      secret:
        cleanEnv(process.env.FEISHU_ALERT_SECRET) ??
        cleanEnv(process.env.FEISHU_BOT_SECRET),
      environment:
        cleanEnv(process.env.FEISHU_ALERT_ENV) ??
        cleanEnv(process.env.DEPLOYMENT_CELL) ??
        cleanEnv(process.env.NODE_ENV) ??
        'development',
      dedupeTtlSeconds: numberEnv(
        process.env.FEISHU_ALERT_DEDUP_TTL_SECONDS,
        DEFAULT_DEDUPE_TTL_SECONDS,
        30,
      ),
      timeoutMs: numberEnv(
        process.env.FEISHU_ALERT_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
        1_000,
      ),
    };
  }

  private fingerprintFor(event: AlertEvent): string {
    const raw =
      event.fingerprint ??
      [
        event.kind,
        event.source,
        event.severity,
        event.request?.method,
        event.request?.path,
        event.request?.statusCode,
        event.error?.code,
        event.error?.name,
        truncate(event.error?.message ?? event.summary ?? event.title, 180),
      ]
        .filter(Boolean)
        .join('|');
    return createHash('sha256').update(raw).digest('hex');
  }

  private async claimDedupe(
    fingerprint: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const key = `server-alert:dedupe:${fingerprint}`;
    // Alert delivery must survive a Redis outage without flooding this process.
    const now = Date.now();
    if ((this.localDedupe.get(key) ?? 0) > now) return false;
    this.localDedupe.delete(key);
    this.localDedupe.set(key, now + ttlSeconds * 1_000);
    if (this.localDedupe.size > LOCAL_DEDUPE_MAX_KEYS) {
      const oldestKey = this.localDedupe.keys().next().value as
        | string
        | undefined;
      if (oldestKey !== undefined) this.localDedupe.delete(oldestKey);
    }

    // The shared Redis client queues offline commands indefinitely.
    if (this.redis.status !== 'ready') return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.redis.set(key, '1', 'EX', ttlSeconds, 'NX'),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Redis alert deduplication timed out')),
            REDIS_DEDUPE_TIMEOUT_MS,
          );
        }),
      ]);
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        `Redis alert deduplication unavailable; using process deduplication: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildFeishuPayload(
    event: AlertEvent,
    config: AlertingConfig,
  ): Record<string, unknown> {
    const safeEvent = sanitizeAlertEvent(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const card = {
      config: { wide_screen_mode: true },
      header: {
        template: templateFor(event.severity),
        title: {
          tag: 'plain_text',
          content: truncate(`[${config.environment}] ${event.title}`, 120),
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: truncate(this.summaryMarkdown(safeEvent), MAX_CARD_CHARS),
          },
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**Details**\n\`\`\`json\n${truncate(
              stableJson(safeEvent),
              MAX_DETAIL_CHARS,
            )}\n\`\`\``,
          },
        },
      ],
    };
    const payload: Record<string, unknown> = {
      msg_type: 'interactive',
      card,
    };
    if (config.secret) {
      payload.timestamp = timestamp;
      payload.sign = signFeishu(timestamp, config.secret);
    }
    return payload;
  }

  private summaryMarkdown(event: AlertEvent): string {
    const lines = [
      `**Severity:** ${event.severity}`,
      `**Source:** ${event.source}`,
      `**Kind:** ${event.kind}`,
      `**Occurred:** ${event.occurredAt ?? new Date().toISOString()}`,
    ];
    if (event.summary) lines.push(`**Summary:** ${event.summary}`);
    if (event.request) {
      lines.push(
        `**Request:** ${event.request.method ?? '-'} ${event.request.path ?? '-'} -> ${
          event.request.statusCode ?? '-'
        }`,
      );
      if (event.request.requestId) {
        lines.push(`**Request ID:** ${event.request.requestId}`);
      }
    }
    if (event.error) {
      lines.push(
        `**Error:** ${[event.error.code, event.error.name, event.error.message]
          .filter(Boolean)
          .join(' ')}`,
      );
    }
    if (event.tags?.length) lines.push(`**Tags:** ${event.tags.join(', ')}`);
    return lines.join('\n');
  }

  private async post(
    webhookUrl: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Feishu webhook HTTP ${response.status}: ${truncate(text, 300)}`,
        );
      }
      const parsed = parseJsonObject(text);
      if (parsed && typeof parsed.code === 'number' && parsed.code !== 0) {
        throw new Error(
          `Feishu webhook code ${parsed.code}: ${truncate(
            stringifyUnknown(parsed.msg ?? ''),
            300,
          )}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  return fallback;
}

function numberEnv(
  value: string | undefined,
  fallback: number,
  min: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function signFeishu(timestamp: string, secret: string): string {
  return createHmac('sha256', `${timestamp}\n${secret}`)
    .update('')
    .digest('base64');
}

function templateFor(severity: AlertSeverity): string {
  switch (severity) {
    case 'critical':
      return 'red';
    case 'error':
      return 'orange';
    case 'warning':
      return 'yellow';
    case 'info':
      return 'blue';
  }
}

function sanitizeAlertEvent(event: AlertEvent): AlertEvent {
  return sanitizeValue(event) as AlertEvent;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return redactString(truncate(value));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const stack = truncateStack(value.stack);
    return {
      name: value.name,
      message: redactString(truncate(value.message)),
      stack: stack ? redactString(stack) : undefined,
    };
  }
  if (depth >= 6) return '[MaxDepth]';
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key)
        ? '[REDACTED]'
        : sanitizeValue(inner, depth + 1);
    }
    return out;
  }
  return redactString(truncate(stringifyUnknown(value)));
}

function isSensitiveKey(key: string): boolean {
  return /authorization|bearer|cookie|credential|password|passwd|secret|signature|token|api[_-]?key|access[_-]?key|webhook|session/i.test(
    key,
  );
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]')
    .replace(/AKIA[A-Za-z0-9]{16}/g, '[REDACTED_ACCESS_KEY]');
}

function truncate(value: string, max = MAX_STRING_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...<truncated:${value.length - max}>`;
}

function truncateStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return stack.split('\n').slice(0, MAX_STACK_LINES).join('\n');
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortObject(value), null, 2);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString();
  }
  if (value == null) return '';
  try {
    return JSON.stringify(value) ?? '[Unserializable]';
  } catch {
    return '[Unserializable]';
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, sortObject(inner)]),
  );
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
