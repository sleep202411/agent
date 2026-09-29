import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { ConflictException, Logger } from '@nestjs/common';
import { AgentOsExternalHandoffReconcilerService } from './agent-os-external-handoff-reconciler.service';
import { Prisma } from '@prisma/client';
import type { AgentEventEnvelope, AgentRunStatus } from '@repo/agent-protocol';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED,
  agentOsCheckpointExecutionLockKey,
} from '@repo/shared';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { AgentOsRunStartDispatcherService } from '../agent-os-gateway/agent-os-run-start-dispatcher.service';
import { AgentOsRunContinuationDispatcherService } from '../agent-os-gateway/agent-os-run-continuation-dispatcher.service';
import {
  AgentOsRunJournalService,
  type AgentOsStartDispatchClaim,
} from './agent-os-run-journal.service';

const INTEGRATION_ENABLED =
  Boolean(process.env.TASK01_TEST_DATABASE_URL) ||
  process.env.AGENT_OS_START_POSTGRES_INTEGRATION === '1';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;
const { Client } = pg;

type JestMatcherConstructor =
  | DateConstructor
  | ObjectConstructor
  | StringConstructor;

function expectAny<T>(constructor: JestMatcherConstructor): T {
  return expect.any(constructor) as unknown as T;
}

function expectObjectContaining<T extends object>(expected: T): T {
  return expect.objectContaining(expected) as unknown as T;
}

describePostgres(
  'AgentOsRunJournalService start fence PostgreSQL integration',
  () => {
    const databaseUrl =
      process.env.TASK01_TEST_DATABASE_URL ??
      process.env.DATABASE_URL?.trim() ??
      '';
    let prisma: ReturnType<typeof buildPrisma>;
    const runIds = new Set<string>();

    beforeAll(async () => {
      assertDedicatedLocalPostgres(databaseUrl);
      prisma = buildPrisma(databaseUrl);
      await prisma.$connect();
      await assertStartFenceMigrationPresent(prisma);
    });

    afterEach(async () => {
      if (runIds.size === 0) return;
      await prisma.agentOsRun.deleteMany({
        where: { id: { in: [...runIds] } },
      });
      runIds.clear();
    });

    afterAll(async () => {
      if (!prisma) return;
      if (runIds.size > 0) {
        await prisma.agentOsRun.deleteMany({
          where: { id: { in: [...runIds] } },
        });
      }
      await prisma.$disconnect();
    });

    it('preserves Date instants even when the connection URL requests Asia/Shanghai', async () => {
      const original = process.env.DATABASE_URL;
      const url = postgresFixtureUrl(databaseUrl);
      url.searchParams.set('options', '-c timezone=Asia/Shanghai');
      const client = buildPrisma(url.toString());
      expect(process.env.DATABASE_URL).toBe(original);
      try {
        const instant = new Date('2026-09-12T14:10:31.895Z');
        const [row] = await client.$queryRaw<
          Array<{ instant: Date; zone: string }>
        >(
          Prisma.sql`SELECT ${instant}::timestamptz AS instant, current_setting('TimeZone') AS zone`,
        );
        expect(row.zone).toBe('UTC');
        expect(row.instant.toISOString()).toBe(instant.toISOString());
      } finally {
        await client.$disconnect();
      }
    });

    it('runs the recovery candidate query against PostgreSQL without timezone or UUID comparison errors', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        const reconciler = new AgentOsExternalHandoffReconcilerService(
          prisma as PrismaService,
          {
            reconcileExternalHandoff: jest.fn().mockResolvedValue({}),
          } as unknown as AgentOsRunJournalService,
        );
        await reconciler.drainOnce();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('reaches later handoffs past a full failing recovery page and retries failures', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        // Transaction-local tables exercise the real discovery SQL without
        // constructing unrelated domain jobs or bypassing production constraints.
        await prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`CREATE TEMP TABLE agent_os_runs (
            id uuid, status text, updated_at timestamptz,
            start_execution_lease_expires_at timestamptz,
            continuation_execution_lease_expires_at timestamptz
          ) ON COMMIT DROP`);
            await tx.$executeRawUnsafe(`CREATE TEMP TABLE agent_os_external_handoff_registrations (
            external_job_id uuid, source_agent_run_id uuid, created_at timestamptz
          ) ON COMMIT DROP`);
            await tx.$executeRawUnsafe(`CREATE TEMP TABLE agent_os_run_events (
            run_id uuid, type text, data jsonb
          ) ON COMMIT DROP`);
            const runId = randomUUID();
            await tx.$executeRaw`INSERT INTO agent_os_runs (id,status,updated_at)
            VALUES (${runId}::uuid, 'running', NOW() - INTERVAL '1 minute')`;
            const ids = Array.from({ length: 26 }, () => randomUUID()).sort();
            for (const id of ids) {
              await tx.$executeRaw`INSERT INTO agent_os_external_handoff_registrations
              VALUES (${id}::uuid, ${runId}::uuid, NOW() - INTERVAL '1 minute')`;
            }
            const visited: string[] = [];
            const reconcile = jest.fn(async (id: string) => {
              visited.push(id);
              if (id !== ids[25]) throw new Error('Persistent handoff failure');
              await tx.$executeRaw`DELETE FROM agent_os_external_handoff_registrations
              WHERE external_job_id = ${id}::uuid`;
            });
            const reconciler = new AgentOsExternalHandoffReconcilerService(
              tx as unknown as PrismaService,
              {
                reconcileExternalHandoff: reconcile,
              } as unknown as AgentOsRunJournalService,
            );
            await reconciler.drainOnce();
            expect(visited).toEqual(ids.slice(0, 25));
            await reconciler.drainOnce();
            expect(visited).toEqual(ids);
            await reconciler.drainOnce();
            expect(visited.slice(26)).toEqual(ids.slice(0, 25));
          },
          { timeout: 15000 },
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('serializes two pods and replays the first durable admission after response loss', async () => {
      const firstRunId = randomUUID();
      const retryRunId = randomUUID();
      runIds.add(firstRunId);
      runIds.add(retryRunId);
      const command = startCommand({ runId: firstRunId });
      const firstPod = service(prisma);
      const secondPod = service(prisma);

      const [left, right] = await Promise.all([
        firstPod.reserveRunStart(command),
        secondPod.reserveRunStart({ ...command, runId: retryRunId }),
      ]);

      expect([left.kind, right.kind].sort()).toEqual(['created', 'replay']);
      expect(left.runId).toBe(firstRunId);
      expect(right.runId).toBe(firstRunId);
      expect(
        await prisma.agentOsRun.count({ where: { id: { in: [...runIds] } } }),
      ).toBe(1);
      expect(
        await prisma.agentOsRunEvent.count({
          where: { runId: firstRunId, type: 'UserMessage' },
        }),
      ).toBe(1);
    });

    it('recovers grant-before-schedule crashes with a new epoch and fences the stale owner', async () => {
      const runId = randomUUID();
      runIds.add(runId);
      const journal = service(prisma);
      const reservation = await journal.reserveRunStart(
        startCommand({ runId }),
      );
      const first = requireClaim(await journal.claimRunStartDispatch(runId));

      // A second pod cannot infer whether the Worker accepted a response-lost
      // dispatch, so the live database lease is the only scheduling authority.
      expect(await journal.claimRunStartDispatch(runId)).toMatchObject({
        kind: 'in_flight',
      });
      await journal.completeRunStartDispatch(
        runId,
        first.executionAttemptId,
        first.executionEpoch,
      );
      expect(await journal.claimRunStartDispatch(runId)).toMatchObject({
        kind: 'in_flight',
      });

      // Simulate a pod crash after grant but before runGraphTurn. The command is
      // still present, so lease expiry grants a monotonically newer epoch.
      await prisma.agentOsRun.update({
        where: { id: runId },
        data: {
          startExecutionLeaseExpiresAt: new Date(Date.now() - 1_000),
          startDispatchNextAttemptAt: new Date(Date.now() - 1_000),
        },
      });
      const second = requireClaim(await journal.claimRunStartDispatch(runId));
      expect(second.executionEpoch).toBe(first.executionEpoch + 1);

      const running = executionEvents(reservation.events[0]);
      await expect(
        journal.upsertSnapshot(
          snapshotInput(runId, 'running', running, first, 'checkpoint-stale'),
        ),
      ).rejects.toMatchObject({
        response: expectObjectContaining({
          code: 'AGENT_OS_START_EXECUTION_FENCED',
        }),
      });

      const releaseCheckpointLock = await acquireCheckpointExecutionLock(
        databaseUrl,
        CONVERSATION_ID,
      );
      try {
        const accepted = await journal.upsertSnapshot(
          snapshotInput(runId, 'running', running, second, 'checkpoint-input'),
        );
        expect(accepted.startExecutionDisposition).toBe('granted');

        await expect(
          prisma.$transaction((tx) =>
            journal.assertToolExecutionFenceInTx(tx, {
              runId,
              projectId: PROJECT_ID,
              conversationId: CONVERSATION_ID,
              actorId: ACTOR_ID,
              startExecution: proof(first),
            }),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          prisma.$transaction((tx) =>
            journal.assertToolExecutionFenceInTx(tx, {
              runId,
              projectId: PROJECT_ID,
              conversationId: CONVERSATION_ID,
              actorId: ACTOR_ID,
              startExecution: proof(second),
            }),
          ),
        ).resolves.toBeUndefined();

        const completed = [
          ...running,
          executionEvent(running[0], 4, 'RunCompleted', {
            turnId: TURN_ID,
            status: 'completed',
          }),
        ];
        const terminal = await journal.upsertSnapshot(
          snapshotInput(
            runId,
            'completed',
            completed,
            second,
            'checkpoint-terminal',
          ),
        );
        expect(terminal.startExecutionDisposition).toBe('accepted');
        expect(
          await prisma.agentOsRun.findUniqueOrThrow({
            where: { id: runId },
            select: {
              status: true,
              startCommand: true,
              startExecutionFinishedAt: true,
              startExecutionCheckpointId: true,
            },
          }),
        ).toEqual({
          status: 'completed',
          startCommand: null,
          startExecutionFinishedAt: expectAny<Date>(Date),
          startExecutionCheckpointId: 'checkpoint-terminal',
        });
      } finally {
        await releaseCheckpointLock();
      }
    });

    it('does not grant a newer start epoch while the prior Worker still owns the checkpoint thread', async () => {
      const runId = randomUUID();
      runIds.add(runId);
      const journal = service(prisma);
      await journal.reserveRunStart(startCommand({ runId }));
      const first = requireClaim(await journal.claimRunStartDispatch(runId));
      const releaseCheckpointLock = await acquireCheckpointExecutionLock(
        databaseUrl,
        CONVERSATION_ID,
      );
      try {
        await expireStartLease(prisma, runId);
        await expect(
          journal.claimRunStartDispatch(runId),
        ).resolves.toMatchObject({ kind: 'in_flight' });
        expect(
          await prisma.agentOsRun.findUniqueOrThrow({
            where: { id: runId },
            select: {
              startExecutionAttemptId: true,
              startExecutionEpoch: true,
            },
          }),
        ).toEqual({
          startExecutionAttemptId: first.executionAttemptId,
          startExecutionEpoch: first.executionEpoch,
        });
      } finally {
        await releaseCheckpointLock();
      }

      const second = requireClaim(await journal.claimRunStartDispatch(runId));
      expect(second.executionEpoch).toBe(first.executionEpoch + 1);
      expect(second.executionAttemptId).not.toBe(first.executionAttemptId);
    });

    it('uses the real dispatcher to recover a Worker journal commit whose HTTP response was lost', async () => {
      const runId = randomUUID();
      runIds.add(runId);
      const journal = service(prisma);
      const reservation = await journal.reserveRunStart(
        startCommand({ runId }),
      );
      const events = executionEvents(reservation.events[0]);
      let workerCalls = 0;
      const worker = {
        startRun: jest.fn(async (request: Record<string, unknown>) => {
          workerCalls += 1;
          const claim = workerClaim(request);
          if (workerCalls === 1) {
            await withCheckpointExecutionLock(
              databaseUrl,
              CONVERSATION_ID,
              () =>
                journal.upsertSnapshot(
                  snapshotInput(runId, 'running', events, claim),
                ),
            );
            throw new Error('simulated Worker HTTP response loss');
          }
          const completed = [
            ...events,
            executionEvent(events[0], 4, 'RunCompleted', {
              turnId: TURN_ID,
              status: 'completed',
            }),
          ];
          await withCheckpointExecutionLock(databaseUrl, CONVERSATION_ID, () =>
            journal.upsertSnapshot(
              snapshotInput(
                runId,
                'completed',
                completed,
                claim,
                'checkpoint-dispatcher-recovery',
              ),
            ),
          );
          return {
            runId,
            status: 'completed',
            events: completed,
          };
        }),
      };
      const dispatcher = new AgentOsRunStartDispatcherService(
        journal,
        worker as never,
      );

      await expect(dispatcher.dispatch(runId)).rejects.toThrow(
        'simulated Worker HTTP response loss',
      );
      expect(worker.startRun).toHaveBeenCalledTimes(1);
      expect(await dispatcher.dispatch(runId)).toMatchObject({
        runId,
        status: 'running',
      });
      expect(worker.startRun).toHaveBeenCalledTimes(1);
      await expireStartLease(prisma, runId);

      await expect(dispatcher.dispatch(runId)).resolves.toMatchObject({
        runId,
        status: 'completed',
      });
      expect(worker.startRun).toHaveBeenCalledTimes(2);
      expect(
        await prisma.agentOsRunEvent.count({
          where: { runId, type: 'UserMessage' },
        }),
      ).toBe(1);
      expect(
        await prisma.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
          select: {
            status: true,
            startExecutionEpoch: true,
            startCommand: true,
            startExecutionFinishedAt: true,
          },
        }),
      ).toEqual({
        status: 'completed',
        startExecutionEpoch: 2,
        startCommand: null,
        startExecutionFinishedAt: expectAny<Date>(Date),
      });
    });

    it('uses the dispatcher sweep to recover a crash after grant but before scheduling', async () => {
      const runId = randomUUID();
      runIds.add(runId);
      const journal = service(prisma);
      const reservation = await journal.reserveRunStart(
        startCommand({ runId }),
      );
      const events = executionEvents(reservation.events[0]);
      let scheduledTurns = 0;
      const worker = {
        startRun: jest.fn(async (request: Record<string, unknown>) => {
          if (worker.startRun.mock.calls.length === 1) {
            throw new Error('simulated crash before runGraphTurn');
          }
          scheduledTurns += 1;
          const claim = workerClaim(request);
          const completed = [
            ...events,
            executionEvent(events[0], 4, 'RunCompleted', {
              turnId: TURN_ID,
              status: 'completed',
            }),
          ];
          await withCheckpointExecutionLock(databaseUrl, CONVERSATION_ID, () =>
            journal.upsertSnapshot(
              snapshotInput(
                runId,
                'completed',
                completed,
                claim,
                'checkpoint-after-preschedule-crash',
              ),
            ),
          );
          return { runId, status: 'completed', events: completed };
        }),
      };
      const dispatcher = new AgentOsRunStartDispatcherService(
        journal,
        worker as never,
      );
      const drainOnce = () =>
        (dispatcher as unknown as { drainOnce(): Promise<void> }).drainOnce();

      await drainOnce();
      expect(worker.startRun).toHaveBeenCalledTimes(1);
      expect(scheduledTurns).toBe(0);
      expect(
        await prisma.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
          select: { status: true, startCommand: true },
        }),
      ).toMatchObject({
        status: 'queued',
        startCommand: expectAny<Record<string, unknown>>(Object),
      });

      await expireStartLease(prisma, runId);
      await drainOnce();

      expect(worker.startRun).toHaveBeenCalledTimes(2);
      expect(scheduledTurns).toBe(1);
      expect(
        await prisma.agentOsRunEvent.count({
          where: { runId, type: 'UserMessage' },
        }),
      ).toBe(1);
      expect(
        await prisma.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
          select: { status: true, startExecutionEpoch: true },
        }),
      ).toEqual({ status: 'completed', startExecutionEpoch: 2 });
    });

    it('rejects cross-conversation reuse of one actor/project submission identity', async () => {
      const runId = randomUUID();
      runIds.add(runId);
      const journal = service(prisma);
      const command = startCommand({ runId });
      await journal.reserveRunStart(command);

      await expect(
        journal.findRunStartSubmission({
          actorId: command.actorId,
          projectId: command.projectId,
          clientSubmissionId: command.clientSubmissionId,
          conversationId: randomUUID(),
          submissionFingerprint: command.submissionFingerprint,
        }),
      ).rejects.toMatchObject({
        response: expectObjectContaining({
          code: 'AGENT_OS_START_SUBMISSION_CONFLICT',
        }),
      });
    });

    it('keeps conversation checkpoint ownership immutable after a foreign run terminalizes', async () => {
      const ownerRunId = randomUUID();
      const foreignRunId = randomUUID();
      runIds.add(ownerRunId);
      runIds.add(foreignRunId);
      const journal = service(prisma);
      await journal.reserveRunStart(startCommand({ runId: ownerRunId }));
      await prisma.agentOsRun.update({
        where: { id: ownerRunId },
        data: {
          status: 'completed',
          startCommand: Prisma.JsonNull,
          startExecutionFinishedAt: new Date(),
          startDispatchNextAttemptAt: null,
        },
      });

      const foreignProjectId = randomUUID();
      const foreign = {
        ...startCommand({ runId: foreignRunId }),
        clientSubmissionId: randomUUID(),
        turnId: randomUUID(),
        messageId: randomUUID(),
        actorId: 'foreign-agent-os-owner',
        projectId: foreignProjectId,
        skillMountSnapshot: {
          ...startCommand({ runId: foreignRunId }).skillMountSnapshot,
          projectId: foreignProjectId,
        },
      };
      await expect(journal.reserveRunStart(foreign)).rejects.toMatchObject({
        response: expectObjectContaining({
          code: 'AGENT_OS_CONVERSATION_OWNERSHIP_CONFLICT',
        }),
      });
      expect(
        await prisma.agentOsRun.count({ where: { id: foreignRunId } }),
      ).toBe(0);
    });

    it('fences late input response A after expired-lease takeover B and accepts only B', async () => {
      const runId = randomUUID();
      const requestId = randomUUID();
      const responseA = randomUUID();
      const responseB = randomUUID();
      runIds.add(runId);
      const journal = service(prisma);
      const waiting = await seedWaitingInputRun(
        prisma,
        journal,
        runId,
        requestId,
      );

      await expect(
        journal.claimUserInputResponse({
          runId,
          requestId,
          responseId: responseA,
          answers: { aspect_ratio: 'portrait_9_16' },
          leaseDurationMs: 5_000,
        }),
      ).resolves.toMatchObject({ kind: 'claimed' });
      await prisma.agentOsRun.update({
        where: { id: runId },
        data: { inputResponseLeaseExpiresAt: new Date(Date.now() - 1_000) },
      });
      await expect(
        journal.claimUserInputResponse({
          runId,
          requestId,
          responseId: responseB,
          answers: { aspect_ratio: 'landscape_16_9' },
          leaseDurationMs: 5_000,
        }),
      ).resolves.toMatchObject({ kind: 'claimed' });

      const lateA = inputContinuationEvents(waiting, requestId, responseA, {
        aspect_ratio: 'portrait_9_16',
      });
      await expect(
        journal.upsertSnapshot(
          continuationSnapshotInput(
            runId,
            'running',
            lateA,
            userInputContinuationCommand(
              runId,
              lateA.at(-1)!.data.turnId as string,
              requestId,
              responseA,
              { aspect_ratio: 'portrait_9_16' },
            ),
          ),
        ),
      ).rejects.toMatchObject({
        response: expectObjectContaining({
          code: 'AGENT_OS_INPUT_RESPONSE_NOT_CLAIMED',
        }),
      });
      expect(await prisma.agentOsRunEvent.count({ where: { runId } })).toBe(
        waiting.length,
      );
      expect(
        await prisma.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
          select: { inputResponseId: true, continuationCommand: true },
        }),
      ).toEqual({ inputResponseId: responseB, continuationCommand: null });

      const acceptedB = inputContinuationEvents(waiting, requestId, responseB, {
        aspect_ratio: 'landscape_16_9',
      });
      await expect(
        journal.upsertSnapshot(
          continuationSnapshotInput(
            runId,
            'running',
            acceptedB,
            userInputContinuationCommand(
              runId,
              acceptedB.at(-1)!.data.turnId as string,
              requestId,
              responseB,
              { aspect_ratio: 'landscape_16_9' },
            ),
          ),
        ),
      ).resolves.toMatchObject({ status: 'running' });
      expect(
        await prisma.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
          select: {
            inputResponseId: true,
            continuationCommand: true,
            continuationExecutionToken: true,
          },
        }),
      ).toEqual({
        inputResponseId: null,
        continuationCommand: expectAny<Record<string, unknown>>(Object),
        continuationExecutionToken: expectAny<string>(String),
      });
    });

    it.each(['approval', 'user_input'] as const)(
      'recovers a durably admitted %s continuation after commit-before-schedule crash',
      async (kind) => {
        const runId = randomUUID();
        const interactionId = randomUUID();
        const responseId = randomUUID();
        runIds.add(runId);
        const journal = service(prisma);
        const waiting =
          kind === 'approval'
            ? await seedWaitingApprovalRun(
                prisma,
                journal,
                runId,
                interactionId,
              )
            : await seedWaitingInputRun(prisma, journal, runId, interactionId);
        const admitted =
          kind === 'approval'
            ? approvalContinuationEvents(waiting, interactionId, responseId)
            : inputContinuationEvents(waiting, interactionId, responseId, {
                aspect_ratio: 'landscape_16_9',
              });
        const command =
          kind === 'approval'
            ? approvalContinuationCommand(
                runId,
                String(admitted.at(-1)!.data.turnId),
                interactionId,
                responseId,
              )
            : userInputContinuationCommand(
                runId,
                String(admitted.at(-1)!.data.turnId),
                interactionId,
                responseId,
                { aspect_ratio: 'landscape_16_9' },
              );
        if (kind === 'approval') {
          await journal.claimApprovalResponse({
            runId,
            approvalId: interactionId,
            responseId,
            decision: 'approve',
            responseText: 'Approved',
            locale: 'en-US',
          });
        } else {
          await journal.claimUserInputResponse({
            runId,
            requestId: interactionId,
            responseId,
            answers: { aspect_ratio: 'landscape_16_9' },
          });
        }
        await journal.upsertSnapshot(
          continuationSnapshotInput(runId, 'running', admitted, command),
        );

        // The request worker has returned (or the pod has crashed) without
        // ever scheduling LangGraph. A fresh dispatcher instance must recover
        // solely from PostgreSQL.
        const worker = {
          resumeContinuation: jest.fn(
            async (request: Record<string, unknown>) => {
              const completed = [
                ...admitted,
                continuationEvent(runId, admitted.length + 1, 'RunCompleted', {
                  turnId: command.turnId,
                  status: 'completed',
                }),
              ];
              await withCheckpointExecutionLock(
                databaseUrl,
                CONVERSATION_ID,
                () =>
                  journal.upsertSnapshot(
                    continuationSnapshotInput(
                      runId,
                      'completed',
                      completed,
                      command,
                      continuationProof(request, runId),
                    ),
                  ),
              );
              return { runId, status: 'completed', events: completed };
            },
          ),
        };
        const restarted = new AgentOsRunContinuationDispatcherService(
          journal,
          worker as never,
        );
        await (
          restarted as unknown as { drainOnce(): Promise<void> }
        ).drainOnce();

        expect(worker.resumeContinuation).toHaveBeenCalledTimes(1);
        expect(
          await prisma.agentOsRun.findUniqueOrThrow({
            where: { id: runId },
            select: {
              status: true,
              continuationCommand: true,
              continuationExecutionFinishedAt: true,
              continuationExecutionEpoch: true,
            },
          }),
        ).toEqual({
          status: 'completed',
          continuationCommand: null,
          continuationExecutionFinishedAt: expectAny<Date>(Date),
          continuationExecutionEpoch: 1,
        });
      },
    );

    it('turns an applied Story result into one recoverable external-result continuation', async () => {
      const runId = randomUUID();
      const turnId = randomUUID();
      const externalJobId = randomUUID();
      const toolCallId = 'story-apply-proposal-pg-it';
      runIds.add(runId);
      const journal = service(prisma);

      await prisma.agentOsRun.create({
        data: {
          id: runId,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          actorId: ACTOR_ID,
          modelProfileId: 'integration-test',
          permissionMode: 'smart',
          status: 'queued',
          projectKind: 'story',
          workbenchMode: 'story-canvas',
          workbenchContext: { chapterId: randomUUID() },
          skillSnapshot: startCommand({ runId })
            .skillMountSnapshot as unknown as object,
        },
      });
      const waiting = [
        continuationEvent(runId, 1, 'RunStarted', {
          turnId,
          status: 'running',
          workspaceType: 'project_canvas',
          modelProfileId: 'integration-test',
          projectKind: 'story',
          workbenchMode: 'story-canvas',
        }),
        continuationEvent(runId, 2, 'ToolCompleted', {
          turnId,
          toolCallId,
          toolId: 'story.applyProposal',
          agentHandoff: {
            kind: 'external_job',
            jobId: externalJobId,
            startedMessage: 'Applying the approved Plot proposal.',
          },
        }),
        continuationEvent(runId, 3, 'RunPaused', {
          turnId,
          status: 'waiting_for_external',
          externalJobId,
          toolCallId,
          toolId: 'story.applyProposal',
        }),
      ];
      await journal.upsertSnapshot(
        continuationSnapshotInput(runId, 'waiting_for_external', waiting),
      );

      const applied = await journal.appendExternalResult({
        runId,
        turnId,
        toolCallId,
        toolId: 'story.applyProposal',
        externalJobId,
        phase: 'apply',
        text: 'The approved Plot proposal was applied.',
        outcome: 'completed',
      });

      expect(applied.events.map((event) => event.type)).toEqual([
        'RunResumed',
        'ArtifactUpdated',
        'MessageStarted',
        'MessageDelta',
        'MessageCompleted',
      ]);
      expect(
        applied.events.some((event) => event.type === 'RunCompleted'),
      ).toBe(false);
      expect(
        await prisma.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
          select: {
            status: true,
            permissionMode: true,
            pendingExternal: true,
            continuationCommand: true,
            continuationExecutionToken: true,
            continuationDispatchNextAttemptAt: true,
          },
        }),
      ).toMatchObject({
        status: 'running',
        permissionMode: 'smart',
        pendingExternal: null,
        continuationCommand: expectObjectContaining({
          kind: 'external_result',
          externalJobId,
          toolCallId,
          toolId: 'story.applyProposal',
          phase: 'apply',
          outcome: 'completed',
        }),
        continuationExecutionToken: expectAny<string>(String),
        continuationDispatchNextAttemptAt: expectAny<Date>(Date),
      });

      const claim = await journal.claimRunContinuationDispatch(runId);
      expect(claim).toMatchObject({
        kind: 'claimed',
        executionEpoch: 1,
        command: expectObjectContaining({
          kind: 'external_result',
          externalJobId,
          toolCallId,
        }),
      });
    });

    it('serializes two continuation dispatchers across response loss and recovers with epoch 2', async () => {
      const runId = randomUUID();
      const requestId = randomUUID();
      const responseId = randomUUID();
      runIds.add(runId);
      const journal = service(prisma);
      const waiting = await seedWaitingInputRun(
        prisma,
        journal,
        runId,
        requestId,
      );
      await journal.claimUserInputResponse({
        runId,
        requestId,
        responseId,
        answers: { aspect_ratio: 'landscape_16_9' },
      });
      const admitted = inputContinuationEvents(waiting, requestId, responseId, {
        aspect_ratio: 'landscape_16_9',
      });
      const command = userInputContinuationCommand(
        runId,
        String(admitted.at(-1)!.data.turnId),
        requestId,
        responseId,
        { aspect_ratio: 'landscape_16_9' },
      );
      await journal.upsertSnapshot(
        continuationSnapshotInput(runId, 'running', admitted, command),
      );

      let calls = 0;
      const worker = {
        resumeContinuation: jest.fn(
          async (request: Record<string, unknown>) => {
            calls += 1;
            const proof = continuationProof(request, runId);
            if (calls === 1) {
              // Worker accepted and claimed its journal owner, but the HTTP
              // response disappeared before the dispatcher saw it.
              const withoutCheckpoint: ContinuationExecutionReport = {
                ...proof,
              };
              delete withoutCheckpoint.checkpointId;
              delete withoutCheckpoint.checkpointNamespace;
              delete withoutCheckpoint.checkpointThreadId;
              await withCheckpointExecutionLock(
                databaseUrl,
                CONVERSATION_ID,
                () =>
                  journal.upsertSnapshot(
                    continuationSnapshotInput(
                      runId,
                      'running',
                      admitted,
                      command,
                      withoutCheckpoint,
                    ),
                  ),
              );
              throw new Error('simulated continuation response loss');
            }
            const completed = [
              ...admitted,
              continuationEvent(runId, admitted.length + 1, 'RunCompleted', {
                turnId: command.turnId,
                status: 'completed',
              }),
            ];
            await withCheckpointExecutionLock(
              databaseUrl,
              CONVERSATION_ID,
              () =>
                journal.upsertSnapshot(
                  continuationSnapshotInput(
                    runId,
                    'completed',
                    completed,
                    command,
                    proof,
                  ),
                ),
            );
            return { runId, status: 'completed', events: completed };
          },
        ),
      };
      const podA = new AgentOsRunContinuationDispatcherService(
        journal,
        worker as never,
      );
      const podB = new AgentOsRunContinuationDispatcherService(
        journal,
        worker as never,
      );
      const firstWave = await Promise.allSettled([
        podA.dispatch(runId),
        podB.dispatch(runId),
      ]);
      expect(firstWave.some((result) => result.status === 'rejected')).toBe(
        true,
      );
      expect(worker.resumeContinuation).toHaveBeenCalledTimes(1);

      await prisma.agentOsRun.update({
        where: { id: runId },
        data: {
          continuationExecutionLeaseExpiresAt: new Date(Date.now() - 1_000),
          continuationDispatchNextAttemptAt: new Date(Date.now() - 1_000),
        },
      });
      await expect(podB.dispatch(runId)).resolves.toMatchObject({
        status: 'completed',
      });
      expect(worker.resumeContinuation).toHaveBeenCalledTimes(2);
      expect(
        await prisma.agentOsRun.findUniqueOrThrow({
          where: { id: runId },
          select: {
            status: true,
            continuationExecutionEpoch: true,
            continuationCommand: true,
          },
        }),
      ).toEqual({
        status: 'completed',
        continuationExecutionEpoch: 2,
        continuationCommand: null,
      });
    });

    it('fails the migration guard closed while any durable start command is pending', async () => {
      const runId = randomUUID();
      runIds.add(runId);
      await service(prisma).reserveRunStart(startCommand({ runId }));

      await expect(
        prisma.$executeRawUnsafe(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM "agent_os_runs"
              WHERE "start_command" IS NOT NULL
            ) THEN
              RAISE EXCEPTION USING
                MESSAGE = 'Cannot enable Agent OS start admission fencing with pending legacy starts',
                DETAIL = 'Drain or explicitly cancel every agent_os_runs row whose start_command is non-null, then retry the migration.';
            END IF;
          END $$;
        `),
      ).rejects.toThrow(
        'Cannot enable Agent OS start admission fencing with pending legacy starts',
      );
    });
  },
);

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '66666666-6666-4666-8666-666666666666';
const SUBMISSION_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR_ID = 'agent-os-start-pg-it';
const SKILL_RESOLUTION_ID = '77777777-7777-4777-8777-777777777777';

function service(prisma: ReturnType<typeof buildPrisma>) {
  return new AgentOsRunJournalService(
    prisma as unknown as PrismaService,
    { schedule: jest.fn() } as never,
  );
}

function startCommand(input: { runId: string }) {
  return {
    runId: input.runId,
    clientSubmissionId: SUBMISSION_ID,
    submissionFingerprint: 'a'.repeat(64),
    turnId: TURN_ID,
    messageId: MESSAGE_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: ACTOR_ID,
    message: 'Build a PostgreSQL-fenced interactive film.',
    modelProfileId: 'integration-test',
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    permissionMode: 'smart' as const,
    skillMountSnapshot: {
      schemaVersion: 'project-skill-resolution/v1' as const,
      resolutionId: SKILL_RESOLUTION_ID,
      ownerKind: 'story' as const,
      projectId: PROJECT_ID,
      projectRevision: 0,
      scope: 'agent_prompt' as const,
      workbenchMode: 'story-canvas',
      sourceSurface: 'agent_os:story-canvas',
      resolvedAt: '2026-08-21T00:00:00.000Z',
      skills: [],
      checksum: '0'.repeat(64),
    },
  };
}

function requireClaim(
  claim: AgentOsStartDispatchClaim,
): Extract<AgentOsStartDispatchClaim, { kind: 'claimed' }> {
  if (claim.kind !== 'claimed') {
    throw new Error(`Expected a claimed start, got ${claim.kind}.`);
  }
  return claim;
}

function proof(claim: Extract<AgentOsStartDispatchClaim, { kind: 'claimed' }>) {
  return {
    executionToken: claim.executionToken,
    executionAttemptId: claim.executionAttemptId,
    executionEpoch: claim.executionEpoch,
    executionOwnerId:
      claim.executionEpoch === 1
        ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
        : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  };
}

function snapshotInput(
  runId: string,
  status: AgentRunStatus,
  events: AgentEventEnvelope[],
  claim: Extract<AgentOsStartDispatchClaim, { kind: 'claimed' }>,
  checkpointId?: string,
) {
  return {
    runId,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: ACTOR_ID,
    modelProfileId: 'integration-test',
    status,
    reportedLastSequence: events.at(-1)?.sequence ?? 0,
    events,
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    skillMountSnapshot: startCommand({ runId }).skillMountSnapshot,
    startExecution: {
      ...proof(claim),
      ...(checkpointId
        ? {
            checkpointId,
            checkpointNamespace: '',
            checkpointThreadId: CONVERSATION_ID,
            checkpointMessageId: MESSAGE_ID,
          }
        : {}),
    },
  };
}

function workerClaim(
  request: Record<string, unknown>,
): Extract<AgentOsStartDispatchClaim, { kind: 'claimed' }> {
  return {
    kind: 'claimed',
    executionToken: String(request.startExecutionToken),
    executionAttemptId: String(request.startExecutionAttemptId),
    executionEpoch: Number(request.startExecutionEpoch),
    leaseExpiresAt: new Date(Date.now() + 90_000),
    command: startCommand({ runId: String(request.runId) }),
  };
}

async function expireStartLease(
  prisma: ReturnType<typeof buildPrisma>,
  runId: string,
) {
  await prisma.agentOsRun.update({
    where: { id: runId },
    data: {
      startExecutionLeaseExpiresAt: new Date(Date.now() - 1_000),
      startDispatchNextAttemptAt: new Date(Date.now() - 1_000),
    },
  });
}

async function seedWaitingInputRun(
  prisma: ReturnType<typeof buildPrisma>,
  journal: AgentOsRunJournalService,
  runId: string,
  requestId: string,
): Promise<AgentEventEnvelope[]> {
  await prisma.agentOsRun.create({
    data: {
      id: runId,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      actorId: ACTOR_ID,
      modelProfileId: 'integration-test',
      status: 'queued',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
      skillSnapshot: startCommand({ runId })
        .skillMountSnapshot as unknown as object,
    },
  });
  const events = waitingInputEvents(runId, requestId);
  await journal.upsertSnapshot(
    continuationSnapshotInput(runId, 'waiting_for_input', events),
  );
  return events;
}

async function seedWaitingApprovalRun(
  prisma: ReturnType<typeof buildPrisma>,
  journal: AgentOsRunJournalService,
  runId: string,
  approvalId: string,
): Promise<AgentEventEnvelope[]> {
  await prisma.agentOsRun.create({
    data: {
      id: runId,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      actorId: ACTOR_ID,
      modelProfileId: 'integration-test',
      status: 'queued',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
      skillSnapshot: startCommand({ runId })
        .skillMountSnapshot as unknown as object,
    },
  });
  const events = waitingApprovalEvents(runId, approvalId);
  await journal.upsertSnapshot(
    continuationSnapshotInput(runId, 'waiting_for_approval', events),
  );
  return events;
}

function waitingInputEvents(
  runId: string,
  requestId: string,
): AgentEventEnvelope[] {
  const turnId = randomUUID();
  return [
    continuationEvent(runId, 1, 'RunStarted', {
      turnId,
      status: 'running',
      workspaceType: 'project_canvas',
      modelProfileId: 'integration-test',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
    }),
    continuationEvent(runId, 2, 'UserInputRequired', {
      turnId,
      requestId,
      toolCallId: 'request-frame',
      resumeAcknowledgement: 'Thanks — I have your frame.',
      questions: [
        {
          id: 'aspect_ratio',
          header: 'Aspect ratio',
          question: 'Which frame?',
          options: [
            { value: 'portrait_9_16', label: '9:16 portrait' },
            { value: 'landscape_16_9', label: '16:9 landscape' },
          ],
        },
      ],
    }),
    continuationEvent(runId, 3, 'RunPaused', {
      turnId,
      status: 'waiting_for_input',
    }),
  ];
}

function waitingApprovalEvents(
  runId: string,
  approvalId: string,
): AgentEventEnvelope[] {
  const turnId = randomUUID();
  const toolCallId = 'write-characters';
  return [
    continuationEvent(runId, 1, 'RunStarted', {
      turnId,
      status: 'running',
      workspaceType: 'project_canvas',
      modelProfileId: 'integration-test',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
    }),
    continuationEvent(runId, 2, 'ToolProposed', {
      turnId,
      toolCallId,
      toolId: 'characters.upsert',
      arguments: { characterId: 'hero' },
      risk: 'sensitive',
    }),
    continuationEvent(runId, 3, 'ApprovalRequired', {
      turnId,
      approvalId,
      toolCallId,
      title: 'Apply character change',
      description: 'Write the reviewed character change.',
      reversible: false,
      actions: ['approve', 'reject'],
    }),
    continuationEvent(runId, 4, 'RunPaused', {
      turnId,
      status: 'waiting_for_approval',
    }),
  ];
}

function inputContinuationEvents(
  prefix: AgentEventEnvelope[],
  requestId: string,
  responseId: string,
  answers: Record<string, string>,
): AgentEventEnvelope[] {
  const runId = prefix[0].runId;
  const turnId = randomUUID();
  const messageId = randomUUID();
  const acknowledgementId = randomUUID();
  const base = prefix.length;
  const acknowledgement = 'Thanks — I have your frame.';
  return [
    ...prefix,
    continuationEvent(runId, base + 1, 'UserMessage', {
      turnId,
      messageId,
      text: `Aspect ratio: ${answers.aspect_ratio ?? ''}`,
      interaction: {
        kind: 'user_input',
        requestId,
        responseId,
        answers,
      },
    }),
    continuationEvent(runId, base + 2, 'UserInputResolved', {
      turnId,
      requestId,
      responseId,
      answers,
    }),
    continuationEvent(runId, base + 3, 'RunResumed', {
      turnId,
      reason: 'user_input_resolved',
      requestId,
    }),
    continuationEvent(runId, base + 4, 'MessageStarted', {
      turnId,
      messageId: acknowledgementId,
      segmentKind: 'acknowledgement',
    }),
    continuationEvent(runId, base + 5, 'MessageDelta', {
      turnId,
      messageId: acknowledgementId,
      delta: acknowledgement,
    }),
    continuationEvent(runId, base + 6, 'MessageCompleted', {
      turnId,
      messageId: acknowledgementId,
      text: acknowledgement,
      finishReason: 'stop',
    }),
  ];
}

function approvalContinuationEvents(
  prefix: AgentEventEnvelope[],
  approvalId: string,
  responseId: string,
): AgentEventEnvelope[] {
  const runId = prefix[0].runId;
  const turnId = randomUUID();
  const messageId = randomUUID();
  const acknowledgementId = randomUUID();
  const base = prefix.length;
  const acknowledgement = 'I received your approval and will continue.';
  return [
    ...prefix,
    continuationEvent(runId, base + 1, 'UserMessage', {
      turnId,
      messageId,
      text: 'Approved',
      interaction: {
        kind: 'approval',
        approvalId,
        responseId,
        decision: 'approve',
        locale: 'en-US',
      },
    }),
    continuationEvent(runId, base + 2, 'ApprovalResolved', {
      turnId,
      approvalId,
      responseId,
      decision: 'approve',
    }),
    continuationEvent(runId, base + 3, 'RunResumed', {
      turnId,
      reason: 'approval_resolved',
      approvalId,
    }),
    continuationEvent(runId, base + 4, 'MessageStarted', {
      turnId,
      messageId: acknowledgementId,
      segmentKind: 'acknowledgement',
    }),
    continuationEvent(runId, base + 5, 'MessageDelta', {
      turnId,
      messageId: acknowledgementId,
      delta: acknowledgement,
    }),
    continuationEvent(runId, base + 6, 'MessageCompleted', {
      turnId,
      messageId: acknowledgementId,
      text: acknowledgement,
      finishReason: 'stop',
    }),
  ];
}

function userInputContinuationCommand(
  runId: string,
  turnId: string,
  requestId: string,
  responseId: string,
  answers: Record<string, string>,
) {
  return {
    kind: 'user_input' as const,
    runId,
    turnId,
    responseId,
    requestId,
    answers,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: ACTOR_ID,
    modelProfileId: 'integration-test',
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    permissionMode: 'smart' as const,
    skillMountSnapshot: startCommand({ runId }).skillMountSnapshot,
  };
}

function approvalContinuationCommand(
  runId: string,
  turnId: string,
  approvalId: string,
  responseId: string,
) {
  return {
    kind: 'approval' as const,
    runId,
    turnId,
    responseId,
    approvalId,
    decision: 'approve' as const,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: ACTOR_ID,
    modelProfileId: 'integration-test',
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    permissionMode: 'smart' as const,
    skillMountSnapshot: startCommand({ runId }).skillMountSnapshot,
  };
}

function continuationSnapshotInput(
  runId: string,
  status: AgentRunStatus,
  events: AgentEventEnvelope[],
  continuationCommand?:
    | ReturnType<typeof userInputContinuationCommand>
    | ReturnType<typeof approvalContinuationCommand>,
  continuationExecution?: ContinuationExecutionReport,
) {
  return {
    runId,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    actorId: ACTOR_ID,
    modelProfileId: 'integration-test',
    status,
    reportedLastSequence: events.at(-1)?.sequence ?? 0,
    events,
    projectKind: 'story' as const,
    workbenchMode: 'story-canvas',
    skillMountSnapshot: startCommand({ runId }).skillMountSnapshot,
    ...(continuationCommand ? { continuationCommand } : {}),
    ...(continuationExecution ? { continuationExecution } : {}),
  };
}

type ContinuationExecutionReport = Omit<
  ReturnType<typeof continuationProof>,
  'checkpointId' | 'checkpointNamespace' | 'checkpointThreadId'
> &
  Partial<
    Pick<
      ReturnType<typeof continuationProof>,
      'checkpointId' | 'checkpointNamespace' | 'checkpointThreadId'
    >
  >;

function continuationProof(request: Record<string, unknown>, runId: string) {
  return {
    executionToken: String(request.continuationExecutionToken),
    executionAttemptId: String(request.continuationExecutionAttemptId),
    executionEpoch: Number(request.continuationExecutionEpoch),
    executionOwnerId: randomUUID(),
    checkpointId: `checkpoint-continuation-${runId}`,
    checkpointNamespace: '',
    checkpointThreadId: CONVERSATION_ID,
  };
}

function continuationEvent(
  runId: string,
  sequence: number,
  type: AgentEventEnvelope['type'],
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    id: randomUUID(),
    protocolVersion: 'fizz.agent.v1',
    sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
    runId,
    conversationId: CONVERSATION_ID,
    sequence,
    timestamp: new Date().toISOString(),
    type,
    data,
  };
}

function executionEvents(admission: AgentEventEnvelope): AgentEventEnvelope[] {
  return [
    admission,
    executionEvent(admission, 2, 'RunStarted', {
      turnId: TURN_ID,
      status: 'running',
      workspaceType: 'project_canvas',
      modelProfileId: 'integration-test',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
    }),
    executionEvent(admission, 3, 'StepStarted', {
      turnId: TURN_ID,
      step: 'permission',
      permissionMode: 'smart',
      agentMode: 'ASSIST',
      projectKind: 'story',
      workbenchMode: 'story-canvas',
    }),
  ];
}

function executionEvent(
  admission: AgentEventEnvelope,
  sequence: number,
  type: AgentEventEnvelope['type'],
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    id: randomUUID(),
    protocolVersion: admission.protocolVersion,
    sessionId: admission.sessionId,
    runId: admission.runId,
    conversationId: admission.conversationId,
    sequence,
    timestamp: new Date().toISOString(),
    type,
    data,
  };
}

async function acquireCheckpointExecutionLock(
  databaseUrl: string,
  conversationId: string,
): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const lockKey = agentOsCheckpointExecutionLockKey(conversationId);
  const result = await client.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended($1, $2::bigint)) AS acquired`,
    [lockKey, AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED],
  );
  if (result.rows[0]?.acquired !== true) {
    await client.end();
    throw new Error('The test Worker could not acquire its checkpoint lock.');
  }
  return async () => {
    try {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, $2::bigint))`,
        [lockKey, AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED],
      );
    } finally {
      await client.end();
    }
  };
}

async function withCheckpointExecutionLock<T>(
  databaseUrl: string,
  conversationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireCheckpointExecutionLock(
    databaseUrl,
    conversationId,
  );
  try {
    return await operation();
  } finally {
    await release();
  }
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

async function assertStartFenceMigrationPresent(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ columnName: string | null }>>`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_os_runs'
      AND column_name = 'start_execution_epoch'
  `;
  if (rows[0]?.columnName !== 'start_execution_epoch') {
    throw new Error(
      'Local PostgreSQL is missing the Agent OS start admission fence migration.',
    );
  }
}
