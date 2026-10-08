import { Injectable } from '@nestjs/common';

export function gameAgentEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.GAME_AGENT_ENABLED?.trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('GAME_AGENT_ENABLED must be true or false.');
}

@Injectable()
export class GameAgentConfigService {
  readonly value: {
    workerBaseUrl: string;
    internalToken: string;
    studioOrigin: string;
  };

  constructor() {
    const raw = process.env.GAME_AGENT_WORKER_URL?.trim();
    let url: URL;
    try {
      url = new URL(raw ?? '');
    } catch {
      throw new Error(
        'GAME_AGENT_WORKER_URL is required when Game Agent is enabled.',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error(
        'GAME_AGENT_WORKER_URL must be an HTTP(S) service origin without credentials.',
      );
    const internalToken = process.env.GAME_AGENT_INTERNAL_TOKEN?.trim();
    if (
      !internalToken ||
      internalToken.length < 16 ||
      internalToken.length > 256 ||
      /change-me|dev-only/i.test(internalToken)
    )
      throw new Error(
        'GAME_AGENT_INTERNAL_TOKEN must be a real secret of 16–256 characters.',
      );
    const studioOrigin = process.env.GAME_AGENT_STUDIO_ORIGIN?.trim();
    let studio: URL;
    try {
      studio = new URL(studioOrigin ?? '');
    } catch {
      throw new Error(
        'GAME_AGENT_STUDIO_ORIGIN is required when Game Agent is enabled.',
      );
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
      studio.hostname,
    );
    if (
      studio.origin !== studioOrigin ||
      studio.username ||
      studio.password ||
      !(
        studio.protocol === 'https:' ||
        (studio.protocol === 'http:' && loopback)
      )
    )
      throw new Error(
        'GAME_AGENT_STUDIO_ORIGIN must be an exact HTTPS origin (HTTP loopback is allowed for local development).',
      );
    this.value = {
      workerBaseUrl: url.origin,
      internalToken,
      studioOrigin: studio.origin,
    };
  }
}
