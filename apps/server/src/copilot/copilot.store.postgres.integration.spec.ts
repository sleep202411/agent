import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import {
  CopilotConversationMode,
  CopilotConversationStatus,
  CopilotMessageRole,
  CopilotQuotaChargeStatus,
  type Prisma,
} from '@prisma/client';
import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { CopilotConfigService } from './copilot.config';
import { CopilotQuotaService } from './copilot-quota.service';
import type { QuotaService } from '../quota/quota.service';
import type { EntitlementService } from '../entitlements';
import {
  COPILOT_MAX_ASSISTANT_MESSAGE_BYTES,
  COPILOT_MAX_CANONICAL_MESSAGES,
  COPILOT_PROVIDER_LEASE_MS,
  CopilotStore,
  type CopilotTurnClaim,
  type CopilotUserStreamLease,
} from './copilot.store';

const INTEGRATION_ENABLED =
  Boolean(process.env.TASK01_TEST_DATABASE_URL) ||
  process.env.COPILOT_POSTGRES_INTEGRATION === '1';
const TEST_PREFIX = 'copilot-pg-it';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;

jest.setTimeout(60_000);

/**
 * Real PostgreSQL coverage for Copilot's canonical transcript, admission
 * fencing, and transaction rollback behavior. The suite is opt-in and refuses
 * every database except the explicitly named loopback fixtures. Each test deletes only
 * the exact randomly generated user IDs it registered.
 */
describePostgres('CopilotStore PostgreSQL integration', () => {
  const databaseUrl =
    process.env.TASK01_TEST_DATABASE_URL ??
    process.env.DATABASE_URL?.trim() ??
    '';
  const touchedUserIds = new Set<string>();
  let prisma: ReturnType<typeof buildPrisma>;
  let store: CopilotStore;

  beforeAll(async () => {
    assertDedicatedLocalPostgres(databaseUrl);
    prisma = buildPrisma(databaseUrl);
    await prisma.$connect();
    await assertCopilotMigrationPresent(prisma);
    store = new CopilotStore(
      prisma as unknown as PrismaService,
      new CopilotConfigService(),
    );
  });

  afterEach(async () => {
    await cleanupUsers(prisma, [...touchedUserIds]);
    touchedUserIds.clear();
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanupUsers(prisma, [...touchedUserIds]);
    await prisma.$disconnect();
  });

  it('allows exactly one concurrent claim for the same fenced lease', async () => {
    const scope = testScope('concurrent-claim');
    const lease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    const input = claimInput(scope, lease, userMessage('first'));

    const outcomes = await Promise.allSettled([
      store.claimTurn(input),
      store.claimTurn(input),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const loser = outcomes.find((outcome) => outcome.status === 'rejected');
    if (!loser || loser.status !== 'rejected') {
      throw new Error('Expected one concurrent Copilot claim to lose.');
    }
    expect(loser.reason).toMatchObject({
      code: 'COPILOT_STREAM_IN_PROGRESS',
    });
    const canonical = await store.load(scope.userId, scope.conversationId);
    expect(canonical?.messages).toHaveLength(1);
  });

  it('fences a stale completion after the same user turn is retried', async () => {
    const scope = testScope('stale-complete');
    const message = userMessage('persist me');
    const first = await acquireAndClaim(scope, message);
    await expect(
      store.terminalizeTurn({ ...scope, turn: first.turn, status: 'failed' }),
    ).resolves.toBe(true);
    const retry = await acquireAndClaim(scope, message, 'regenerate-message');

    await expect(
      store.completeTurn({
        ...scope,
        turn: first.turn,
        responseMessage: assistantMessage('stale', 'assistant-stale'),
      }),
    ).resolves.toBe(false);
    await expect(
      store.completeTurn({
        ...scope,
        turn: retry.turn,
        responseMessage: assistantMessage('current', 'assistant-current'),
      }),
    ).resolves.toBe(true);
    const canonical = await store.load(scope.userId, scope.conversationId);
    expect(canonical?.messages.map((item) => item.id)).toEqual([
      message.id,
      'assistant-current',
    ]);
  });

  it('rejects a different retry ID and ignores forged replacement content', async () => {
    const scope = testScope('retry-canonical');
    const original = userMessage('canonical text');
    const first = await acquireAndClaim(scope, original);
    await store.terminalizeTurn({
      ...scope,
      turn: first.turn,
      status: 'aborted',
    });
    await reconcileQuotaAttemptsForTest(scope);

    const rejectedLease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    await expect(
      store.claimTurn(
        claimInput(
          scope,
          rejectedLease,
          userMessage('other', 'different-id'),
          'regenerate-message',
        ),
      ),
    ).rejects.toMatchObject({ code: 'COPILOT_RETRY_NOT_ALLOWED' });
    await store.releaseUserStreamLease(
      scope.userId,
      rejectedLease.token,
      rejectedLease.fencingRevision,
    );

    const retry = await acquireAndClaim(
      scope,
      userMessage('forged replacement text', original.id),
      'regenerate-message',
    );
    expect(retry.conversation.messages).toEqual([original]);
  });

  it('replays the first canonical proposal across an aborted retry', async () => {
    const scope = testScope('proposal-replay');
    const message = userMessage('make a proposal');
    const first = await acquireAndClaim(scope, message);
    const originalProposal = {
      proposal: {
        title: 'Original title',
        summary: 'Original summary',
        operations: [{ operationId: 'op-1' }],
      },
      authoringSnapshot: {
        draftRevision: 7,
        draftContentHash: 'a'.repeat(64),
        layoutRevision: 3,
      },
    };
    await expect(
      prisma.$transaction((tx) =>
        store.canonicalizeTurnProposalInTransaction(tx, {
          ...scope,
          sessionId: first.conversation.sessionId,
          turn: first.turn,
          proposal: originalProposal,
        }),
      ),
    ).resolves.toEqual(originalProposal);
    await store.terminalizeTurn({
      ...scope,
      turn: first.turn,
      status: 'aborted',
    });

    const retry = await acquireAndClaim(scope, message, 'regenerate-message');
    await expect(
      prisma.$transaction((tx) =>
        store.canonicalizeTurnProposalInTransaction(tx, {
          ...scope,
          sessionId: retry.conversation.sessionId,
          turn: retry.turn,
          proposal: {
            proposal: {
              title: 'Forged title',
              summary: 'Forged summary',
              operations: [{ operationId: 'op-2' }],
            },
            authoringSnapshot: {
              draftRevision: 8,
              draftContentHash: 'b'.repeat(64),
              layoutRevision: 4,
            },
          },
        }),
      ),
    ).resolves.toEqual(originalProposal);
  });

  it('persists client tool outputs and merges the server continuation into the same assistant row', async () => {
    const scope = testScope('tool-continuation');
    const initial = await acquireAndClaim(
      scope,
      userMessage('Inspect the canvas'),
    );
    const pending = assistantToolMessage('assistant-tool-1');
    await expect(
      store.completeTurn({
        ...scope,
        turn: initial.turn,
        responseMessage: pending,
      }),
    ).resolves.toBe(true);

    const before = await store.load(scope.userId, scope.conversationId);
    expect(before).toMatchObject({
      status: 'ready',
      messages: [{}, { id: pending.id }],
    });
    const blockedLease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    await expect(
      store.claimTurn(
        claimInput(scope, blockedLease, userMessage('skip the tool result')),
      ),
    ).rejects.toMatchObject({ code: 'COPILOT_TOOL_CONTINUATION_REQUIRED' });
    await store.releaseUserStreamLease(
      scope.userId,
      blockedLease.token,
      blockedLease.fencingRevision,
    );

    const lease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    const resolved = resolvedAssistantToolMessage(pending.id);
    const continuation = await store.claimToolContinuation({
      ...scope,
      assistantMessage: resolved,
      admissionLease: lease,
    });
    expect(continuation.turn).toMatchObject({
      kind: 'tool-continuation',
      billingOperationId: initial.turn.billingOperationId,
      chargeAttemptId: initial.turn.chargeAttemptId,
    });
    expect(continuation.conversation.messages).toHaveLength(2);
    expect(continuation.conversation.messages[1]).toEqual(resolved);

    const finalResponse: UIMessage = {
      ...resolved,
      parts: [
        ...resolved.parts,
        { type: 'step-start' },
        { type: 'text', text: 'The canvas contains one image node.' },
      ],
    };
    await expect(
      store.completeTurn({
        ...scope,
        turn: continuation.turn,
        responseMessage: finalResponse,
      }),
    ).resolves.toBe(true);

    const canonical = await store.load(scope.userId, scope.conversationId);
    expect(canonical).toMatchObject({
      status: 'ready',
      messages: [{ role: 'user' }, { id: pending.id, role: 'assistant' }],
    });
    expect(canonical?.messages).toHaveLength(2);
    expect(canonical?.messages[1]).toEqual(finalResponse);
    const row = await prisma.copilotConversation.findUniqueOrThrow({
      where: {
        userId_conversationId: {
          userId: scope.userId,
          conversationId: scope.conversationId,
        },
      },
    });
    expect(row.messageCount).toBe(2);
    expect(row.billingOperationId).toBe(initial.turn.billingOperationId);
  });

  it('keeps a failed tool continuation retryable under the same billing operation', async () => {
    const scope = testScope('tool-retry');
    const initial = await acquireAndClaim(
      scope,
      userMessage('Inspect and continue'),
    );
    const pending = assistantToolMessage('assistant-tool-retry');
    await store.completeTurn({
      ...scope,
      turn: initial.turn,
      responseMessage: pending,
    });
    const resolved = resolvedAssistantToolMessage(pending.id, true);

    const firstLease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    const first = await store.claimToolContinuation({
      ...scope,
      assistantMessage: resolved,
      admissionLease: firstLease,
    });
    await expect(
      store.terminalizeTurn({ ...scope, turn: first.turn, status: 'failed' }),
    ).resolves.toBe(true);
    await reconcileQuotaAttemptsForTest(scope);
    expect(
      (await store.load(scope.userId, scope.conversationId))?.messages[1],
    ).toEqual(resolved);

    const retryLease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    const retry = await store.claimToolContinuation({
      ...scope,
      assistantMessage: resolvedAssistantToolMessage(pending.id),
      admissionLease: retryLease,
    });
    expect(retry.turn.billingOperationId).toBe(first.turn.billingOperationId);
    expect(retry.turn.chargeAttemptId).not.toBe(first.turn.chargeAttemptId);
    expect(retry.conversation.messages).toHaveLength(2);
    await expect(
      prisma.copilotQuotaChargeAttempt.findMany({
        where: { billingOperationId: first.turn.billingOperationId },
        orderBy: { generation: 'asc' },
        select: { id: true, generation: true, status: true },
      }),
    ).resolves.toEqual([
      {
        id: first.turn.chargeAttemptId,
        generation: 1,
        status: CopilotQuotaChargeStatus.refunded,
      },
      {
        id: retry.turn.chargeAttemptId,
        generation: 2,
        status: CopilotQuotaChargeStatus.consume_pending,
      },
    ]);
    await store.terminalizeTurn({
      ...scope,
      turn: retry.turn,
      status: 'aborted',
    });
  });

  it('expires an abandoned client-tool wait, refunds generation one, and fences its late replay from generation two', async () => {
    const scope = testScope('tool-expiry');
    const initial = await acquireAndClaim(
      scope,
      userMessage('Inspect, even if this tab disappears'),
    );
    const pending = assistantToolMessage('assistant-tool-expiry');
    await store.completeTurn({
      ...scope,
      turn: initial.turn,
      responseMessage: pending,
    });
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.copilotQuotaChargeAttempt.update({
      where: { id: initial.turn.chargeAttemptId },
      data: {
        createdAt: new Date(expiredAt.getTime() - 60_000),
        clientToolExpiresAt: expiredAt,
        dayBucket: '2026-01-31',
        monthBucket: '2026-01',
      },
    });

    const quota = {
      refundFor: jest.fn().mockResolvedValue({ ok: true, status: 'ok' }),
      finalizeIdempotencyFor: jest
        .fn()
        .mockResolvedValue({ ok: true, status: 'ok' }),
    };
    const coordinator = new CopilotQuotaService(
      quota as unknown as QuotaService,
      prisma as unknown as PrismaService,
      stubEntitlements(),
    );
    await expect(
      coordinator.reconcileChargeAttempt(initial.turn.chargeAttemptId),
    ).resolves.toBe(true);
    expect((await store.load(scope.userId, scope.conversationId))?.status).toBe(
      'failed',
    );

    const retryLease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    const retry = await store.claimToolContinuation({
      ...scope,
      assistantMessage: resolvedAssistantToolMessage(pending.id),
      admissionLease: retryLease,
    });
    expect(retry.turn.billingOperationId).toBe(initial.turn.billingOperationId);
    expect(retry.turn.chargeAttemptId).not.toBe(initial.turn.chargeAttemptId);
    await expect(
      prisma.copilotQuotaChargeAttempt.findUniqueOrThrow({
        where: { id: retry.turn.chargeAttemptId },
        select: { dayBucket: true, monthBucket: true },
      }),
    ).resolves.not.toEqual({
      dayBucket: '2026-01-31',
      monthBucket: '2026-01',
    });
    await prisma.copilotQuotaChargeAttempt.update({
      where: { id: retry.turn.chargeAttemptId },
      data: { tier: 'basic', status: CopilotQuotaChargeStatus.charged },
    });

    // A duplicate/late generation-one refund is scoped to its own Redis key
    // and must not terminalize the current generation-two conversation.
    await prisma.copilotQuotaChargeAttempt.update({
      where: { id: initial.turn.chargeAttemptId },
      data: {
        status: CopilotQuotaChargeStatus.refund_pending,
        redisFinalizedAt: null,
      },
    });
    await expect(
      coordinator.reconcileChargeAttempt(initial.turn.chargeAttemptId),
    ).resolves.toBe(true);
    expect(quota.refundFor).toHaveBeenCalledTimes(2);
    for (const [refundInput] of quota.refundFor.mock.calls as Array<
      [{ window: { dayBucket: string; monthBucket: string } }]
    >) {
      expect(refundInput.window).toEqual({
        dayBucket: '2026-01-31',
        monthBucket: '2026-01',
      });
    }
    const current = await store.load(scope.userId, scope.conversationId);
    expect(current).toMatchObject({
      status: 'streaming',
      activeTurn: { chargeAttemptId: retry.turn.chargeAttemptId },
    });
    await store.terminalizeTurn({
      ...scope,
      turn: retry.turn,
      status: 'aborted',
    });
  });

  it('rejects a server continuation that rewrites an existing client tool result', async () => {
    const scope = testScope('tool-rewrite');
    const initial = await acquireAndClaim(scope, userMessage('Inspect safely'));
    const pending = assistantToolMessage('assistant-tool-rewrite');
    await store.completeTurn({
      ...scope,
      turn: initial.turn,
      responseMessage: pending,
    });
    const lease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    const continuation = await store.claimToolContinuation({
      ...scope,
      assistantMessage: resolvedAssistantToolMessage(pending.id),
      admissionLease: lease,
    });
    const forged: UIMessage = {
      id: pending.id,
      role: 'assistant',
      parts: [
        {
          type: 'tool-query_graph',
          toolCallId: 'tool-call-1',
          state: 'output-available',
          input: {},
          output: { nodes: [{ id: 'forged', type: 'note', label: 'changed' }] },
        },
        { type: 'step-start' },
        { type: 'text', text: 'Done.' },
      ],
    } as UIMessage;
    await expect(
      store.completeTurn({
        ...scope,
        turn: continuation.turn,
        responseMessage: forged,
      }),
    ).rejects.toMatchObject({ code: 'COPILOT_TOOL_CONTINUATION_INVALID' });
  });

  it('reclaims an expired conversation and user lease with a new fence', async () => {
    const scope = testScope('expired-reclaim');
    const message = userMessage('retry after expiry');
    const first = await acquireAndClaim(scope, message);
    await expireClaimInDatabase(scope);

    const replacementLease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    expect(replacementLease.fencingRevision).toBeGreaterThan(
      first.turn.admissionFencingRevision,
    );
    await expect(
      store.claimTurn(
        claimInput(scope, replacementLease, message, 'regenerate-message'),
      ),
    ).rejects.toMatchObject({ code: 'COPILOT_QUOTA_SETTLEMENT_PENDING' });
    await store.releaseUserStreamLease(
      scope.userId,
      replacementLease.token,
      replacementLease.fencingRevision,
    );
    await reconcileQuotaAttemptsForTest(scope);
    const retry = await acquireAndClaim(scope, message, 'regenerate-message');
    expect(retry.conversation.status).toBe('streaming');
    expect(retry.turn.userMessageId).toBe(message.id);
  });

  it('uses revision plus session generation to prevent reset ABA deletion', async () => {
    const scope = testScope('reset-aba');
    const first = await acquireAndClaim(scope, userMessage('old'));
    await store.terminalizeTurn({
      ...scope,
      turn: first.turn,
      status: 'failed',
    });
    await reconcileQuotaAttemptsForTest(scope);
    const old = await store.load(scope.userId, scope.conversationId);
    expect(old).not.toBeNull();

    await expect(
      store.resetConversation(
        scope.userId,
        scope.conversationId,
        old!.revision + 1,
        old!.sessionId,
      ),
    ).rejects.toMatchObject({ code: 'COPILOT_TURN_STALE' });
    await expect(
      store.resetConversation(
        scope.userId,
        scope.conversationId,
        old!.revision,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'COPILOT_TURN_STALE' });
    await expect(
      store.resetConversation(
        scope.userId,
        scope.conversationId,
        old!.revision,
        old!.sessionId,
      ),
    ).resolves.toBe(true);

    const recreatedClaim = await acquireAndClaim(scope, userMessage('new'));
    await store.terminalizeTurn({
      ...scope,
      turn: recreatedClaim.turn,
      status: 'failed',
    });
    const recreated = await store.load(scope.userId, scope.conversationId);
    expect(recreated?.revision).toBe(old!.revision);
    expect(recreated?.sessionId).not.toBe(old!.sessionId);
    await expect(
      store.resetConversation(
        scope.userId,
        scope.conversationId,
        old!.revision,
        old!.sessionId,
      ),
    ).rejects.toMatchObject({ code: 'COPILOT_TURN_STALE' });
  });

  it('treats reset during a ready client-tool wait as an aborted refund', async () => {
    const scope = testScope('reset-tool');
    const claim = await acquireAndClaim(
      scope,
      userMessage('Ask me before changing the graph'),
    );
    await store.completeTurn({
      ...scope,
      turn: claim.turn,
      responseMessage: assistantToolMessage('assistant-reset-tool'),
    });
    const ready = await store.load(scope.userId, scope.conversationId);
    expect(ready?.status).toBe('ready');

    await expect(
      store.resetConversation(
        scope.userId,
        scope.conversationId,
        ready!.revision,
        ready!.sessionId,
      ),
    ).resolves.toBe(true);
    await expect(
      prisma.copilotConversation.findUnique({
        where: {
          userId_conversationId: {
            userId: scope.userId,
            conversationId: scope.conversationId,
          },
        },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.copilotQuotaChargeAttempt.findUniqueOrThrow({
        where: { id: claim.turn.chargeAttemptId },
        select: { status: true, refundReason: true },
      }),
    ).resolves.toEqual({
      status: CopilotQuotaChargeStatus.refund_pending,
      refundReason: 'aborted',
    });
  });

  it.each(['refund_pending', 'charged', 'consume_pending'] as const)(
    'recovery traverses a failing full page of %s attempts and wraps',
    async (status) => {
      const ids: string[] = [];
      for (let i = 0; i < 33; i += 1) {
        const scope = testScope(`recovery-page-${i}`);
        const claim = await acquireAndClaim(
          scope,
          userMessage('Recovery pagination'),
        );
        await expireClaimInDatabase(scope);
        ids.push(claim.turn.chargeAttemptId);
      }
      await prisma.copilotQuotaChargeAttempt.updateMany({
        where: { id: { in: ids } },
        data: { status },
      });
      const coordinator = new CopilotQuotaService(
        {} as QuotaService,
        prisma as unknown as PrismaService,
        stubEntitlements(),
      );
      const visited: string[] = [];
      const reconcile = jest
        .spyOn(coordinator, 'reconcileChargeAttempt')
        .mockImplementation((id) => {
          visited.push(id);
          return Promise.reject(new Error('Persistent recovery failure'));
        });
      try {
        await coordinator.drainPendingAttempts();
        expect(visited).toHaveLength(32);
        await coordinator.drainPendingAttempts();
        expect(new Set(visited)).toEqual(new Set(ids));
        const beforeRetry = visited.length;
        await coordinator.drainPendingAttempts();
        expect(visited.length).toBeGreaterThan(beforeRetry);
      } finally {
        reconcile.mockRestore();
      }
    },
  );

  it('worker refunds a charged provider attempt after its owner pod disappears', async () => {
    const scope = testScope('provider-crash');
    const claim = await acquireAndClaim(
      scope,
      userMessage('The provider pod will disappear'),
    );
    await expireClaimInDatabase(scope);
    const quota = {
      refundFor: jest.fn().mockResolvedValue({ ok: true, status: 'ok' }),
      finalizeIdempotencyFor: jest
        .fn()
        .mockResolvedValue({ ok: true, status: 'ok' }),
    };
    const coordinator = new CopilotQuotaService(
      quota as unknown as QuotaService,
      prisma as unknown as PrismaService,
      stubEntitlements(),
    );

    await coordinator.drainPendingAttempts();

    await expect(
      prisma.copilotQuotaChargeAttempt.findUniqueOrThrow({
        where: { id: claim.turn.chargeAttemptId },
        select: { status: true, refundReason: true },
      }),
    ).resolves.toEqual({
      status: CopilotQuotaChargeStatus.refunded,
      refundReason: 'failed',
    });
    expect((await store.load(scope.userId, scope.conversationId))?.status).toBe(
      'failed',
    );
    await expect(
      prisma.copilotUserStreamState.findUniqueOrThrow({
        where: { userId: scope.userId },
        select: { claimToken: true, conversationId: true },
      }),
    ).resolves.toEqual({ claimToken: null, conversationId: null });
    const refundInput = (quota.refundFor.mock.calls as unknown[][])[0]?.[0] as
      | {
          terminalFence: boolean;
          window: { dayBucket: string; monthBucket: string };
        }
      | undefined;
    expect(refundInput?.terminalFence).toBe(true);
    expect(refundInput?.window.dayBucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(refundInput?.window.monthBucket).toMatch(/^\d{4}-\d{2}$/);
  });

  it('enforces the 64-message boundary without a partial 65th append', async () => {
    const scope = testScope('message-bound');
    for (
      let index = 0;
      index < COPILOT_MAX_CANONICAL_MESSAGES / 2;
      index += 1
    ) {
      const claim = await acquireAndClaim(
        scope,
        userMessage(`turn-${index}`, `user-${index}`),
      );
      await expect(
        store.completeTurn({
          ...scope,
          turn: claim.turn,
          responseMessage: assistantMessage(
            `response-${index}`,
            `assistant-${index}`,
          ),
        }),
      ).resolves.toBe(true);
    }

    const lease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    await expect(
      store.claimTurn(
        claimInput(scope, lease, userMessage('one too many', 'user-65')),
      ),
    ).rejects.toMatchObject({ code: 'COPILOT_HISTORY_LIMIT_REACHED' });
    const canonical = await store.load(scope.userId, scope.conversationId);
    expect(canonical?.messages).toHaveLength(COPILOT_MAX_CANONICAL_MESSAGES);
    expect(canonical?.status).toBe('ready');
  });

  it('persists and reloads an assistant response near its byte limit', async () => {
    const scope = testScope('byte-bound');
    const claim = await acquireAndClaim(scope, userMessage('large response'));
    const payload = 'x'.repeat(COPILOT_MAX_ASSISTANT_MESSAGE_BYTES - 4_096);
    const response = assistantMessage(payload, 'assistant-near-limit');

    await expect(
      store.completeTurn({
        ...scope,
        turn: claim.turn,
        responseMessage: response,
      }),
    ).resolves.toBe(true);
    const canonical = await store.load(scope.userId, scope.conversationId);
    expect(canonical?.messages[1]).toEqual(response);
  });

  it('rolls back low-reported counters when actual JSONB exceeds 4 MiB', async () => {
    const scope = testScope('rollback');
    const messages = [
      userMessage('u'.repeat(480 * 1024), 'rollback-user-1'),
      assistantMessage(
        'a'.repeat(COPILOT_MAX_ASSISTANT_MESSAGE_BYTES - 4_096),
        'rollback-assistant-1',
      ),
      userMessage('u'.repeat(480 * 1024), 'rollback-user-2'),
      assistantMessage(
        'a'.repeat(COPILOT_MAX_ASSISTANT_MESSAGE_BYTES - 4_096),
        'rollback-assistant-2',
      ),
    ];

    await expect(
      prisma.$transaction(async (tx) => {
        const billingOperationId = randomUUID();
        const chargeAttemptId = randomUUID();
        const sessionId = randomUUID();
        await tx.copilotQuotaChargeAttempt.create({
          data: {
            id: chargeAttemptId,
            billingOperationId,
            generation: 1,
            userId: scope.userId,
            conversationId: scope.conversationId,
            sessionId,
            ownerTurnId: billingOperationId,
            dayBucket: '2026-07-19',
            monthBucket: '2026-07',
            status: CopilotQuotaChargeStatus.settled,
          },
        });
        const conversation = await tx.copilotConversation.create({
          data: {
            userId: scope.userId,
            conversationId: scope.conversationId,
            projectId: scope.projectId,
            mode: CopilotConversationMode.canvas,
            selectedSkillKeys: [],
            sessionId,
            billingOperationId,
            billingChargeAttemptId: chargeAttemptId,
            revision: 0,
            status: CopilotConversationStatus.ready,
            messageCount: messages.length,
            // Deliberately forged low: the deferred trigger must independently
            // sum the real persisted JSONB representation and reject commit.
            messageBytes: messages.length,
          },
        });
        for (const [ordinal, message] of messages.entries()) {
          await tx.copilotMessage.create({
            data: {
              conversationId: conversation.id,
              ordinal,
              messageId: message.id,
              role:
                message.role === 'user'
                  ? CopilotMessageRole.user
                  : CopilotMessageRole.assistant,
              // Same serialization cast the production store uses: UIMessage is
              // structurally JSON but not index-signatured for InputJsonValue.
              payload: message as unknown as Prisma.InputJsonValue,
              byteSize: 1,
            },
          });
        }
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.copilotConversation.findUnique({
        where: {
          userId_conversationId: {
            userId: scope.userId,
            conversationId: scope.conversationId,
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it('admits only one concurrent paid stream across conversations per user', async () => {
    const first = testScope('cross-conv');
    const second = additionalScope(first.userId);

    const outcomes = await Promise.allSettled([
      store.acquireUserStreamLease(first.userId, first.conversationId),
      store.acquireUserStreamLease(second.userId, second.conversationId),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    const loser = outcomes.find((outcome) => outcome.status === 'rejected');
    if (!loser || loser.status !== 'rejected') {
      throw new Error('Expected one cross-conversation admission to lose.');
    }
    expect(loser.reason).toMatchObject({
      code: 'COPILOT_STREAM_IN_PROGRESS',
    });
  });

  it('reclaims an expired admission lease and fences the old release token', async () => {
    const first = testScope('lease-fence');
    const second = additionalScope(first.userId);
    const oldLease = await store.acquireUserStreamLease(
      first.userId,
      first.conversationId,
    );
    await prisma.copilotUserStreamState.update({
      where: { userId: first.userId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const newLease = await store.acquireUserStreamLease(
      second.userId,
      second.conversationId,
    );
    expect(newLease.fencingRevision).toBe(oldLease.fencingRevision + 1);
    await expect(
      store.releaseUserStreamLease(
        first.userId,
        oldLease.token,
        oldLease.fencingRevision,
      ),
    ).resolves.toBe(false);
    await expect(
      store.releaseUserStreamLease(
        first.userId,
        newLease.token,
        newLease.fencingRevision,
      ),
    ).resolves.toBe(true);
  });

  it('fails beginProvider after lease loss before a paid call', async () => {
    const first = testScope('provider-lost');
    const second = additionalScope(first.userId);
    const claim = await acquireAndClaim(first, userMessage('prepare slowly'));
    await expireClaimInDatabase(first);
    await store.acquireUserStreamLease(second.userId, second.conversationId);

    await expect(
      store.beginProvider({ ...first, turn: claim.turn }),
    ).rejects.toMatchObject({ code: 'COPILOT_TURN_STALE' });
  });

  it('renews both authoritative leases from the database clock', async () => {
    const scope = testScope('provider-renew');
    const claim = await acquireAndClaim(scope, userMessage('start provider'));
    const shortExpiry = new Date(Date.now() + 30_000);
    await prisma.$transaction([
      prisma.copilotConversation.update({
        where: {
          userId_conversationId: {
            userId: scope.userId,
            conversationId: scope.conversationId,
          },
        },
        data: {
          activeStartedAt: new Date(Date.now() - 30_000),
          activeExpiresAt: shortExpiry,
        },
      }),
      prisma.copilotUserStreamState.update({
        where: { userId: scope.userId },
        data: { leaseExpiresAt: shortExpiry },
      }),
    ]);

    const renewed = await store.beginProvider({ ...scope, turn: claim.turn });
    const rows = await prisma.$queryRaw<
      Array<{
        now: Date;
        conversationExpiry: Date;
        userExpiry: Date;
      }>
    >`
      SELECT
        clock_timestamp() AS "now",
        c."active_expires_at" AS "conversationExpiry",
        u."lease_expires_at" AS "userExpiry"
      FROM "copilot_conversations" c
      JOIN "copilot_user_stream_states" u ON u."user_id" = c."user_id"
      WHERE c."user_id" = ${scope.userId}
        AND c."conversation_id" = ${scope.conversationId}
    `;
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row.conversationExpiry.getTime()).toBe(row.userExpiry.getTime());
    expect(renewed.expiresAt).toBe(row.conversationExpiry.getTime());
    expect(
      row.conversationExpiry.getTime() - row.now.getTime(),
    ).toBeGreaterThan(COPILOT_PROVIDER_LEASE_MS - 5_000);
  });

  function testScope(label: string): Scope {
    const safeLabel = label.replace(/[^a-z0-9]/g, '').slice(0, 12);
    const scope = additionalScope(
      `${TEST_PREFIX}-${safeLabel}-${randomUUID()}`,
    );
    touchedUserIds.add(scope.userId);
    return scope;
  }

  function additionalScope(userId: string): Scope {
    const projectId = randomUUID();
    return {
      userId,
      projectId,
      mode: 'canvas',
      conversationId: `canvas:${projectId}`,
    };
  }

  async function acquireAndClaim(
    scope: Scope,
    message: UIMessage,
    trigger: 'submit-message' | 'regenerate-message' = 'submit-message',
  ): Promise<CopilotTurnClaim> {
    await reconcileQuotaAttemptsForTest(scope);
    const lease = await store.acquireUserStreamLease(
      scope.userId,
      scope.conversationId,
    );
    const claim = await store.claimTurn(
      claimInput(scope, lease, message, trigger),
    );
    await prisma.copilotQuotaChargeAttempt.updateMany({
      where: {
        id: claim.turn.chargeAttemptId,
        status: CopilotQuotaChargeStatus.consume_pending,
      },
      data: {
        tier: 'basic',
        status: CopilotQuotaChargeStatus.charged,
      },
    });
    return claim;
  }

  async function reconcileQuotaAttemptsForTest(scope: Scope): Promise<void> {
    await prisma.copilotQuotaChargeAttempt.updateMany({
      where: {
        userId: scope.userId,
        conversationId: scope.conversationId,
        status: CopilotQuotaChargeStatus.refund_pending,
      },
      data: { status: CopilotQuotaChargeStatus.refunded },
    });
    await prisma.copilotQuotaChargeAttempt.updateMany({
      where: {
        userId: scope.userId,
        conversationId: scope.conversationId,
        status: CopilotQuotaChargeStatus.settle_pending,
      },
      data: { status: CopilotQuotaChargeStatus.settled },
    });
  }

  async function expireClaimInDatabase(scope: Scope): Promise<void> {
    const startedAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() - 30_000);
    await prisma.$transaction([
      prisma.copilotConversation.update({
        where: {
          userId_conversationId: {
            userId: scope.userId,
            conversationId: scope.conversationId,
          },
        },
        data: { activeStartedAt: startedAt, activeExpiresAt: expiresAt },
      }),
      prisma.copilotUserStreamState.update({
        where: { userId: scope.userId },
        data: { leaseExpiresAt: expiresAt },
      }),
    ]);
  }
});

interface Scope {
  userId: string;
  conversationId: string;
  projectId: string;
  mode: 'canvas';
}

/**
 * Refund reconciliation only consults entitlements for the display-only WS
 * badge snapshot (and tolerates any failure), so a fixed minimal profile is
 * enough here.
 */
function stubEntitlements(): EntitlementService {
  return {
    quotaProfileForUser: jest.fn().mockResolvedValue({
      limits: {
        queuePriority: 1,
        imageDaily: 10,
        videoDaily: 10,
        chatDaily: 200,
        workflowDaily: 10,
        uploadMB: 1_024,
        chatPerMinute: 30,
        concurrentJobs: 2,
        queuedJobs: 8,
      },
    }),
  } as unknown as EntitlementService;
}

function claimInput(
  scope: Scope,
  admissionLease: CopilotUserStreamLease,
  userMessageValue: UIMessage,
  trigger: 'submit-message' | 'regenerate-message' = 'submit-message',
) {
  return {
    ...scope,
    selectedSkillKeys: [],
    trigger,
    userMessage: userMessageValue,
    admissionLease,
  };
}

function userMessage(text: string, id = `user-${randomUUID()}`): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

function assistantMessage(text: string, id: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] };
}

function assistantToolMessage(id: string): UIMessage {
  return {
    id,
    role: 'assistant',
    metadata: { source: 'server', nested: { first: 1, second: 2 } },
    parts: [
      {
        type: 'tool-query_graph',
        toolCallId: 'tool-call-1',
        state: 'input-available',
        input: {},
      },
    ],
  } as UIMessage;
}

function resolvedAssistantToolMessage(
  id: string,
  reverseMetadataKeys = false,
): UIMessage {
  return {
    id,
    role: 'assistant',
    metadata: reverseMetadataKeys
      ? { nested: { second: 2, first: 1 }, source: 'server' }
      : { source: 'server', nested: { first: 1, second: 2 } },
    parts: [
      {
        type: 'tool-query_graph',
        toolCallId: 'tool-call-1',
        state: 'output-available',
        input: {},
        output: {
          nodes: [{ id: 'node-1', type: 'image', label: 'Reference' }],
        },
      },
    ],
  } as UIMessage;
}

function assertDedicatedLocalPostgres(rawUrl: string): void {
  const url = postgresFixtureUrl(rawUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !(
      (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
      (url.port === '55439' && url.pathname === '/task01')
    )
  ) {
    throw new Error(
      'Explicitly selected named loopback test database required.',
    );
  }
}

async function assertCopilotMigrationPresent(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{ tableName: string | null; bucketColumns: bigint }>
  >`
    SELECT
      to_regclass('public.copilot_conversations')::text AS "tableName",
      (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'copilot_quota_charge_attempts'
          AND column_name IN ('day_bucket', 'month_bucket')
      ) AS "bucketColumns"
  `;
  if (
    rows[0]?.tableName !== 'copilot_conversations' ||
    rows[0]?.bucketColumns !== 2n
  ) {
    throw new Error(
      'Local PostgreSQL is missing the Copilot migration. Run the local migration command first.',
    );
  }
}

async function cleanupUsers(
  prisma: ReturnType<typeof buildPrisma>,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.$transaction([
    prisma.copilotConversation.deleteMany({
      where: { userId: { in: userIds } },
    }),
    prisma.copilotUserStreamState.deleteMany({
      where: { userId: { in: userIds } },
    }),
    prisma.copilotQuotaChargeAttempt.deleteMany({
      where: { userId: { in: userIds } },
    }),
  ]);
}
