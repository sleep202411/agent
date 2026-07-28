import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Write gate for the enum-expanding crew-chat release.
 *
 * `conversation_context_type.crew` and
 * `conversation_participant_role.member` cannot be decoded by a
 * Prisma Client generated before those enum values existed. During a
 * normal rolling deployment, a new pod must therefore not write the
 * first crew conversation while an old pod can still receive reads.
 *
 * Production is fail-closed by default:
 *
 *   release A: deploy migration + compatible code, flag false
 *   release B: after every old pod is gone, set flag true
 *
 * Development and tests default on so local product work remains
 * frictionless. Invalid explicit values fail loudly.
 */
export function crewChatWritesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.CREW_CHAT_WRITES_ENABLED?.trim().toLowerCase();
  if (!raw) return env.NODE_ENV !== 'production';
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error('CREW_CHAT_WRITES_ENABLED must be one of: true, false, 1, 0');
}

export function requireCrewChatWritesEnabled(): void {
  if (crewChatWritesEnabled()) return;
  throw new ServiceUnavailableException({
    message:
      'Crew chat is temporarily unavailable while the collaboration release finishes rolling out',
    code: 'CREW_CHAT_ROLLOUT_PENDING',
  });
}
