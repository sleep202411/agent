import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { StudioAgentConfigService } from './studio-agent.config';

/**
 * Dedicated runtime identity. This token intentionally cannot authorize any
 * other `/internal/*` API and the broad internal-service token cannot authorize
 * Studio Agent execution.
 */
@Injectable()
export class StudioAgentRuntimeTokenGuard implements CanActivate {
  constructor(private readonly config: StudioAgentConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const raw = request.headers['x-studio-agent-runtime-token'];
    const provided = (Array.isArray(raw) ? raw[0] : raw) ?? '';
    if (!safeEqual(provided, this.config.value.runtimeToken)) {
      throw new UnauthorizedException({
        code: 'STUDIO_AGENT_RUNTIME_UNAUTHORIZED',
        message: 'Invalid or missing Studio Agent runtime credential.',
      });
    }
    return true;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
