import { backgroundTasksEnabled } from '../common/background-tasks';
/**
 * ProviderAccountReconciler
 *
 * On boot, seeds one AiProviderAccount control-plane row per provider in
 * AI_PROVIDER_KEYS (the canonical onboarding list) so the operator always has an
 * account to view/edit in the admin UI (status, throttle/quota policy) without
 * hand-creating it.
 *
 * Create-if-missing only: the upsert leaves `update: {}` empty, so an operator's
 * edits (status promotions away from 'draft', policy tweaks) are never clobbered
 * on the next boot. A key may exist in AI_PROVIDER_KEYS BEFORE its server adapter
 * does — that account is a draft placeholder: visible/editable, but generation
 * through it fails the ProviderRegistry guard until the adapter ships and the
 * account is activated.
 *
 * Provider credentials are NOT part of this layer — each adapter reads its own
 * provider key from the environment. This reconciler only owns the
 * operator-facing account metadata.
 */
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { AI_PROVIDER_KEYS } from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';

@Injectable()
export class ProviderAccountReconciler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProviderAccountReconciler.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    const reconciled: string[] = [];
    for (const provider of AI_PROVIDER_KEYS) {
      try {
        // create-if-missing, never overwrite operator edits.
        await this.prisma.aiProviderAccount.upsert({
          where: { provider },
          create: { provider, status: 'draft' },
          update: {},
        });
        reconciled.push(provider);
      } catch (err) {
        // Never crash boot on a seeding failure — the next deploy retries.
        this.logger.warn(
          `Failed to reconcile AiProviderAccount for "${provider}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.logger.log(
      `Reconciled ${reconciled.length} provider account(s): ${
        reconciled.join(', ') || '(none)'
      }`,
    );
  }
}
