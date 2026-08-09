import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';

type StoryWriteTransaction = Pick<Prisma.TransactionClient, '$queryRaw'>;

interface LockedWriteStateRow {
  activeAgentRunId: string | null;
  fencingToken: bigint;
  lockedAt: Date | null;
  lockExpiresAt: Date | null;
  isLocked: boolean;
}

export interface ActiveStoryExternalCommand {
  commandKind: 'draft_release' | 'public_release';
  commandId: string;
  leaseExpiresAt: Date;
}

/**
 * Authoritative Story-project write serialization.
 *
 * Every human mutation must call `assertHumanWriteAllowed` from the same
 * database transaction that performs the write. `FOR UPDATE` makes the
 * permanent write-state row the ordering point shared with Agent OS
 * claims, while `transaction_timestamp()` keeps lease decisions on the
 * database clock.
 */
@Injectable()
export class StoryProjectWriteGuardService {
  constructor(private readonly prisma: PrismaService) {}

  async assertHumanWriteAllowed(
    tx: StoryWriteTransaction,
    storyProjectId: string,
  ): Promise<void> {
    const state = await this.lockWriteState(tx, storyProjectId);
    if (!this.hasAgentWriteReservation(state)) return;

    throw new HttpException(
      {
        code: 'STORY_AGENT_APPLYING',
        message:
          'The Story Agent owns the project write boundary while its run is applying or awaiting recovery.',
        storyProjectId,
        runId: state.activeAgentRunId,
        // An expired worker lease is a recovery boundary, not permission for a
        // second writer. There is no honest retry timestamp until a worker
        // finishes or explicitly stales the durable run.
        retryAfter: state.isLocked ? state.lockExpiresAt.toISOString() : null,
        recoveryPending: !state.isLocked,
      },
      HttpStatus.LOCKED,
    );
  }

  /**
   * Serialize a deferrable system reconciliation with Agent OS apply.
   *
   * Unlike a human mutation, polling reconciliation should not turn an active
   * Agent OS lease into a 423 response. It locks the same permanent write-state
   * row and returns `false` while Agent OS apply owns the project. The caller must
   * then commit without project-visible writes and return its current read
   * model. A later poll can retry after the Agent lease is released.
   *
   * Invariant failures still throw: a missing or corrupt write state is not a
   * recoverable reason to bypass project serialization.
   */
  async tryAcquireDeferredWriteFence(
    tx: StoryWriteTransaction,
    storyProjectId: string,
  ): Promise<boolean> {
    const state = await this.lockWriteState(tx, storyProjectId);
    return !this.hasAgentWriteReservation(state);
  }

  private async lockWriteState(
    tx: StoryWriteTransaction,
    storyProjectId: string,
  ): Promise<LockedWriteStateRow> {
    const rows = await tx.$queryRaw<LockedWriteStateRow[]>`
      SELECT
        "active_agent_run_id" AS "activeAgentRunId",
        "fencing_token" AS "fencingToken",
        "locked_at" AS "lockedAt",
        "lock_expires_at" AS "lockExpiresAt",
        (
          "active_agent_run_id" IS NOT NULL
          AND "lock_expires_at" > transaction_timestamp()
        ) AS "isLocked"
      FROM "story_project_write_states"
      WHERE "story_project_id" = ${storyProjectId}::uuid
      FOR UPDATE
    `;
    const state = rows[0];
    if (!state) {
      throw new InternalServerErrorException({
        code: 'STORY_PROJECT_WRITE_STATE_MISSING',
        message: 'The story project has no authoritative write state.',
        storyProjectId,
      });
    }

    const hasActiveRun = state.activeAgentRunId !== null;
    const hasCompleteLeaseWindow =
      state.lockedAt !== null && state.lockExpiresAt !== null;
    if (hasActiveRun !== hasCompleteLeaseWindow) {
      throw new InternalServerErrorException({
        code: 'STORY_PROJECT_WRITE_STATE_CORRUPT',
        message: 'The story project write lock has an invalid shape.',
        storyProjectId,
      });
    }

    return state;
  }

  /**
   * Acquire the short, transaction-scoped mutation boundary used by Agent OS.
   *
   * Model inference and approval never run while this lock is held. A prepared
   * action enters here only for its bounded canonical database mutation. That
   * keeps the canvas responsive while still giving human writes, recovery,
   * external release commands, and Agent OS one total order.
   */
  async acquireAgentOsMutationFence(
    tx: Prisma.TransactionClient,
    storyProjectId: string,
  ): Promise<{ fencingToken: bigint }> {
    const state = await this.lockWriteState(tx, storyProjectId);
    if (this.hasAgentWriteReservation(state)) {
      throw new HttpException(
        {
          code: 'STORY_AGENT_APPLYING',
          message:
            'Another Story Agent mutation owns the project write boundary.',
          storyProjectId,
          runId: state.activeAgentRunId,
          retryAfter: state.isLocked ? state.lockExpiresAt.toISOString() : null,
          recoveryPending: !state.isLocked,
        },
        HttpStatus.LOCKED,
      );
    }
    await this.assertAgentClaimAllowed(tx, storyProjectId);
    return { fencingToken: state.fencingToken };
  }

  private hasAgentWriteReservation(
    state: LockedWriteStateRow,
  ): state is LockedWriteStateRow & {
    activeAgentRunId: string;
    lockExpiresAt: Date;
  } {
    return state.activeAgentRunId !== null && state.lockExpiresAt !== null;
  }

  /**
   * Fast permission-boundary feedback only. The row lock is released when this
   * short transaction finishes, so every mutation must still call the method
   * above inside its own write transaction to close the TOCTOU window.
   */
  async assertHumanWriteAllowedEarly(storyProjectId: string): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.assertHumanWriteAllowed(tx, storyProjectId),
    );
  }

  /**
   * Prevent an Agent OS apply from overtaking an accepted external write.
   *
   * The caller MUST already hold the permanent project write-state row
   * `FOR UPDATE`. Release claims take that same row lock before creating their
   * durable receipt, so the receipt query below and a new Agent claim have one
   * total order without holding a database transaction across HTTP I/O.
   *
   * Only leases whose external POST can still be in flight are blockers.
   * Confirmed/rejected receipts and expired leases are immutable history, not
   * active project writers.
   */
  async assertAgentClaimAllowed(
    tx: StoryWriteTransaction,
    storyProjectId: string,
  ): Promise<void> {
    const active = await this.findActiveExternalCommand(tx, storyProjectId);
    if (!active) return;

    throw new HttpException(
      {
        code: 'STORY_EXTERNAL_COMMAND_IN_FLIGHT',
        message:
          'An accepted external Story command is still in flight. Retry after it settles.',
        storyProjectId,
        commandKind: active.commandKind,
        commandId: active.commandId,
        retryAfter: active.leaseExpiresAt.toISOString(),
      },
      HttpStatus.LOCKED,
    );
  }

  /**
   * Inspect the durable external-write fence while the caller owns the project
   * write-state row. Agent recovery calls this again immediately before it
   * mutates canonical authoring state; an intent accepted during an older
   * deployment or crash window must stale that run instead of being overtaken.
   */
  async findActiveExternalCommand(
    tx: StoryWriteTransaction,
    storyProjectId: string,
  ): Promise<ActiveStoryExternalCommand | null> {
    const rows = await tx.$queryRaw<ActiveStoryExternalCommand[]>`
      SELECT
        command_kind AS "commandKind",
        command_id AS "commandId",
        lease_expires_at AS "leaseExpiresAt"
      FROM (
        SELECT
          'public_release'::text AS command_kind,
          "id" AS command_id,
          "lease_expires_at"
        FROM "story_experience_publications"
        WHERE "story_project_id" = ${storyProjectId}::uuid
          AND "status" IN ('pending', 'uncertain')
          AND "lease_expires_at" > transaction_timestamp()

        UNION ALL

        SELECT
          'draft_release'::text AS command_kind,
          "id" AS command_id,
          "lease_expires_at"
        FROM "story_experience_draft_releases"
        WHERE "story_project_id" = ${storyProjectId}::uuid
          AND "status" IN ('pending', 'uncertain')
          AND "lease_expires_at" > transaction_timestamp()
      ) AS active_external_commands
      ORDER BY lease_expires_at DESC, command_id ASC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
