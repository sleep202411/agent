import { Injectable } from '@nestjs/common';

export const COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS_ENV =
  'COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS';
export const DEFAULT_COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS = 24;

const MIN_CLIENT_TOOL_WAIT_TTL_HOURS = 1;
const MAX_CLIENT_TOOL_WAIT_TTL_HOURS = 168;

/**
 * Operational Copilot timings validated once, at module construction.
 *
 * Client-executed tool calls cannot retain a paid charge forever. A completed
 * assistant tail gets this business deadline; after it elapses the durable
 * quota worker fails the conversation and refunds that physical attempt.
 */
@Injectable()
export class CopilotConfigService {
  readonly clientToolWaitTtlMs: number;

  constructor() {
    this.clientToolWaitTtlMs =
      resolveClientToolWaitTtlHours(process.env) * 60 * 60 * 1_000;
  }
}

export function resolveClientToolWaitTtlHours(env: NodeJS.ProcessEnv): number {
  const configured = env[COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS_ENV];
  if (configured === undefined) {
    return DEFAULT_COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS;
  }
  const raw = configured.trim();
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw invalidClientToolWaitTtl();
  }
  const hours = Number(raw);
  if (
    !Number.isSafeInteger(hours) ||
    hours < MIN_CLIENT_TOOL_WAIT_TTL_HOURS ||
    hours > MAX_CLIENT_TOOL_WAIT_TTL_HOURS
  ) {
    throw invalidClientToolWaitTtl();
  }
  return hours;
}

function invalidClientToolWaitTtl(): Error {
  return new Error(
    `${COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS_ENV} must be a whole number from ${MIN_CLIENT_TOOL_WAIT_TTL_HOURS} to ${MAX_CLIENT_TOOL_WAIT_TTL_HOURS}.`,
  );
}
