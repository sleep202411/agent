import { ConflictException } from '@nestjs/common';
import {
  StudioDocumentStatus,
  StudioDocumentType,
  StoryFrameProfile,
  WorkspaceType,
} from '@prisma/client';
import {
  AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED,
  agentOsCheckpointExecutionLockKey,
} from '@repo/shared';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { AgentOsRunJournalService } from '../agent-os-journal/agent-os-run-journal.service';
import { DocumentsService } from '../documents/documents.service';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { AgentOsAttachmentService } from './agent-os-attachment.service';
import { AgentOsCanvasShotsService } from './agent-os-canvas-shots.service';
import { AgentOsToolExecutionReceiptService } from './agent-os-tool-execution-receipt.service';
import { AttachmentAgentCapabilityHandler } from './capabilities/attachment.handler';
import type {
  AgentOsCapabilityExecuteInput,
  AgentOsContinuationExecutionProof,
  AgentOsStartExecutionProof,
} from './capabilities/capability-handler';
import { StoryAgentCapabilityHandler } from './capabilities/story.handler';

loadEnv({
  path: resolve(__dirname, '../../.env'),
  override: false,
  quiet: true,
});

const INTEGRATION_ENABLED =
  process.env.AGENT_OS_TOOL_RECEIPT_POSTGRES_INTEGRATION === '1';
const DEFAULT_LOCAL_DATABASE_URL =
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;
const { Client } = pg;

describePostgres(
  'AgentOsToolExecutionReceiptService PostgreSQL integration',
  () => {
    const databaseUrl =
      process.env.DATABASE_URL?.trim() || DEFAULT_LOCAL_DATABASE_URL;
    let prisma: ReturnType<typeof buildPrisma>;
    const runIds = new Set<string>();
    const runConversations = new Map<string, string>();
    const workspaceIds = new Set<string>();
    const platformProjectIds = new Set<string>();
    const storyProjectIds = new Set<string>();

    beforeAll(async () => {
      assertDedicatedLocalPostgres(databaseUrl);
      prisma = buildPrisma();
      await prisma.$connect();
      await assertReceiptMigrationPresent(prisma);
    });

    afterEach(async () => {
      if (runIds.size > 0) {
        await prisma.agentOsRun.deleteMany({
          where: { id: { in: [...runIds] } },
        });
      }
      if (storyProjectIds.size > 0) {
        await prisma.storyProject.deleteMany({
          where: { id: { in: [...storyProjectIds] } },
        });
      }
      if (platformProjectIds.size > 0) {
        await prisma.platformProject.deleteMany({
          where: { id: { in: [...platformProjectIds] } },
        });
      }
      if (workspaceIds.size > 0) {
        await prisma.workspace.deleteMany({
          where: { id: { in: [...workspaceIds] } },
        });
      }
      runIds.clear();
      runConversations.clear();
      storyProjectIds.clear();
      platformProjectIds.clear();
      workspaceIds.clear();
    });

    afterAll(async () => {
      if (prisma) await prisma.$disconnect();
    });

    it('serializes two pods through script.store and exact-replays one committed attachment', async () => {
      const fixture = await createFixture();
      const runId = await createLegacyRun(fixture.platformProjectId);
      const input = scriptInput(runId, fixture.platformProjectId);
      const firstPod = receiptService(prisma);
      const secondPod = receiptService(prisma);
      const handler = scriptHandler(fixture);
      const execute = jest.fn((claimed: AgentOsCapabilityExecuteInput) =>
        handler.execute(claimed, fixture.platformContext).then(success),
      );

      const [left, right] = await Promise.all([
        firstPod.executeCommand(input, execute),
        secondPod.executeCommand(input, execute),
      ]);
      const replay = await secondPod.executeCommand(input, execute);
      await prisma.agentOsRun.update({
        where: { id: runId },
        data: { status: 'cancelled' },
      });
      const replayAfterStop = await firstPod.executeCommand(input, execute);

      expect(left).toEqual(right);
      expect(replay).toEqual(left);
      expect(replayAfterStop).toEqual(left);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(
        await prisma.agentOsAttachment.count({
          where: { platformProjectId: fixture.platformProjectId },
        }),
      ).toBe(1);
      expect(
        await prisma.agentOsToolExecutionReceipt.count({
          where: { runId, status: 'completed' },
        }),
      ).toBe(1);

      await expect(
        firstPod.claim({
          ...input,
          arguments: { text: 'A divergent script.' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        firstPod.claim({
          ...input,
          toolCallId: 'different-call-same-idempotency-key',
          arguments: { text: 'A divergent script.' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // Opposite Stop ordering: the business transaction owns the run lock
      // first, so cancellation must wait. The mutation + exact receipt commits
      // before the run is terminalized, with no deadlock and no partial state.
      const writeFirstRunId = await createLegacyRun(fixture.storyProjectId);
      const writeFirstInput = storyProfileInput(
        writeFirstRunId,
        fixture.storyProjectId,
      );
      let announceRunLock!: () => void;
      const runLockAcquired = new Promise<void>((resolve) => {
        announceRunLock = resolve;
      });
      let allowBusinessCommit!: () => void;
      const mayCommit = new Promise<void>((resolve) => {
        allowBusinessCommit = resolve;
      });
      const writeFirst = firstPod.executeCommand(
        writeFirstInput,
        async (claimed) =>
          prisma.$transaction(async (tx) => {
            await firstPod.fenceBusinessMutationInTx(tx, claimed);
            announceRunLock();
            await mayCommit;
            const project = await tx.storyProject.update({
              where: { id: fixture.storyProjectId },
              data: {
                summary: 'The fenced write linearized before Stop.',
                version: { increment: 1 },
              },
            });
            const data = { version: project.version };
            await firstPod.completeSuccessInTx(tx, claimed, data);
            return success(data);
          }),
      );
      await runLockAcquired;
      let stopSettled = false;
      const stopAfterWrite = prisma.agentOsRun
        .update({
          where: { id: writeFirstRunId },
          data: { status: 'cancelled' },
        })
        .then((run) => {
          stopSettled = true;
          return run;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stopSettled).toBe(false);
      allowBusinessCommit();

      await expect(writeFirst).resolves.toEqual({
        ok: true,
        data: { version: 1 },
      });
      await expect(stopAfterWrite).resolves.toMatchObject({
        status: 'cancelled',
      });
      await expect(
        prisma.storyProject.findUniqueOrThrow({
          where: { id: fixture.storyProjectId },
        }),
      ).resolves.toMatchObject({
        summary: 'The fenced write linearized before Stop.',
        version: 1,
      });
      expect(
        await prisma.agentOsToolExecutionReceipt.count({
          where: { runId: writeFirstRunId, status: 'completed' },
        }),
      ).toBe(1);
    });

    it('rolls back the whole script.store transaction when an expired owner finishes late', async () => {
      const fixture = await createFixture();
      const runId = await createLegacyRun(fixture.platformProjectId);
      const input = scriptInput(runId, fixture.platformProjectId);
      const service = receiptService(prisma);
      const handler = scriptHandler(fixture);
      const first = requireClaim(await service.claim(input, 5_000));
      await expireReceipt(first.context.receiptId);
      const second = requireClaim(await service.claim(input, 5_000));

      await expect(
        handler.execute(
          { ...input, toolExecutionReceipt: first.context },
          fixture.platformContext,
        ),
      ).rejects.toMatchObject({
        response: { code: 'AGENT_OS_TOOL_EXECUTION_SUPERSEDED' },
      });
      expect(
        await prisma.agentOsAttachment.count({
          where: { platformProjectId: fixture.platformProjectId },
        }),
      ).toBe(0);

      await expect(
        handler.execute(
          { ...input, toolExecutionReceipt: second.context },
          fixture.platformContext,
        ),
      ).resolves.toMatchObject({ sectionCount: 1 });
      expect(
        await prisma.agentOsAttachment.count({
          where: { platformProjectId: fixture.platformProjectId },
        }),
      ).toBe(1);
    });

    it('commits a Story creative-profile mutation and its replay receipt atomically', async () => {
      const fixture = await createFixture();
      const runId = await createLegacyRun(fixture.storyProjectId);
      const input = storyProfileInput(runId, fixture.storyProjectId);
      const service = receiptService(prisma);
      const handler = storyHandler(service);
      const execute = jest.fn((claimed: AgentOsCapabilityExecuteInput) =>
        handler.execute(claimed).then(success),
      );

      const first = await service.executeCommand(input, execute);
      const replay = await service.executeCommand(input, execute);
      const project = await prisma.storyProject.findUniqueOrThrow({
        where: { id: fixture.storyProjectId },
      });

      expect(replay).toEqual(first);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(project).toMatchObject({
        durationPreset: 'short_5_15',
        visualStyle: 'cinematic_realism',
        defaultLocale: 'zh-CN',
        version: 1,
      });
      expect(project.creativeProfileConfirmedAt).not.toBeNull();
    });

    it('linearizes Stop before a proofless post-HITL Story mutation and expired takeover', async () => {
      const fixture = await createFixture();
      const runId = await createLegacyRun(fixture.storyProjectId);
      const input = storyProfileInput(runId, fixture.storyProjectId);
      const service = receiptService(prisma);
      const claim = requireClaim(await service.claim(input, 5_000));
      await prisma.agentOsRun.update({
        where: { id: runId },
        data: { status: 'cancelled' },
      });

      await expect(
        storyHandler(service).execute({
          ...input,
          toolExecutionReceipt: claim.context,
        }),
      ).rejects.toMatchObject({
        response: { code: 'AGENT_OS_START_EXECUTION_FENCED' },
      });
      const project = await prisma.storyProject.findUniqueOrThrow({
        where: { id: fixture.storyProjectId },
      });
      expect(project.creativeProfileConfirmedAt).toBeNull();
      expect(project.version).toBe(0);

      await expireReceipt(claim.context.receiptId);
      await expect(service.claim(input, 5_000)).rejects.toMatchObject({
        response: { code: 'AGENT_OS_START_EXECUTION_FENCED' },
      });
    });

    it('fences a replaced initial epoch and lets only the new owner commit script.store', async () => {
      const fixture = await createFixture();
      const firstProof = executionProof(1);
      const runId = await createInitialRun(
        fixture.platformProjectId,
        firstProof,
      );
      const firstInput = {
        ...scriptInput(runId, fixture.platformProjectId),
        startExecution: firstProof,
      };
      const service = receiptService(prisma);
      const handler = scriptHandler(fixture);
      const conversationId = runConversations.get(runId);
      if (!conversationId) throw new Error('Missing initial run conversation.');
      const first = await withCheckpointExecutionLock(
        databaseUrl,
        conversationId,
        async () => requireClaim(await service.claim(firstInput, 5_000)),
      );
      const secondProof = executionProof(2);
      await prisma.agentOsRun.update({
        where: { id: runId },
        data: {
          startExecutionAttemptId: secondProof.executionAttemptId,
          startExecutionEpoch: secondProof.executionEpoch,
          startExecutionOwnerId: secondProof.executionOwnerId,
          startExecutionLeaseExpiresAt: new Date(Date.now() + 90_000),
        },
      });
      await expireReceipt(first.context.receiptId);
      const secondInput = { ...firstInput, startExecution: secondProof };
      await withCheckpointExecutionLock(
        databaseUrl,
        conversationId,
        async () => {
          const second = requireClaim(await service.claim(secondInput, 5_000));

          await expect(
            handler.execute(
              { ...firstInput, toolExecutionReceipt: first.context },
              fixture.platformContext,
            ),
          ).rejects.toMatchObject({
            response: { code: 'AGENT_OS_START_EXECUTION_FENCED' },
          });
          expect(
            await prisma.agentOsAttachment.count({
              where: { platformProjectId: fixture.platformProjectId },
            }),
          ).toBe(0);
          await expect(
            handler.execute(
              { ...secondInput, toolExecutionReceipt: second.context },
              fixture.platformContext,
            ),
          ).resolves.toMatchObject({ sectionCount: 1 });
        },
      );
    });

    it('rolls back an old continuation epoch and admits the new epoch on a different tool call', async () => {
      const fixture = await createFixture();
      const oldProof = continuationProof(1);
      const runId = await createContinuationRun(
        fixture.storyProjectId,
        oldProof,
      );
      const service = receiptService(prisma);
      const oldInput = {
        ...storyProfileInput(runId, fixture.storyProjectId),
        toolCallId: 'continuation-old-tool-call',
        idempotencyKey: `continuation-old:${runId}:v1`,
        continuationExecution: oldProof,
      };
      const conversationId = runConversations.get(runId);
      if (!conversationId)
        throw new Error('Missing continuation run conversation.');
      const oldClaim = await withCheckpointExecutionLock(
        databaseUrl,
        conversationId,
        async () => requireClaim(await service.claim(oldInput, 5_000)),
      );
      const newProof = continuationProof(2);
      await prisma.agentOsRun.update({
        where: { id: runId },
        data: {
          continuationExecutionAttemptId: newProof.executionAttemptId,
          continuationExecutionEpoch: newProof.executionEpoch,
          continuationExecutionOwnerId: newProof.executionOwnerId,
          continuationExecutionLeaseExpiresAt: new Date(Date.now() + 90_000),
        },
      });
      const newInput = {
        ...oldInput,
        toolCallId: 'continuation-new-tool-call',
        idempotencyKey: `continuation-new:${runId}:v1`,
        continuationExecution: newProof,
      };
      await withCheckpointExecutionLock(
        databaseUrl,
        conversationId,
        async () => {
          const newClaim = requireClaim(await service.claim(newInput, 5_000));

          await expect(
            storyHandler(service).execute({
              ...oldInput,
              toolExecutionReceipt: oldClaim.context,
            }),
          ).rejects.toMatchObject({
            response: {
              code: 'AGENT_OS_CONTINUATION_EXECUTION_FENCED',
            },
          });
          await expect(
            prisma.storyProject.findUniqueOrThrow({
              where: { id: fixture.storyProjectId },
            }),
          ).resolves.toMatchObject({
            version: 0,
            creativeProfileConfirmedAt: null,
          });

          await expect(
            storyHandler(service).execute({
              ...newInput,
              toolExecutionReceipt: newClaim.context,
            }),
          ).resolves.toMatchObject({
            frameProfile: 'landscape_16_9',
            durationPreset: 'short_5_15',
          });
        },
      );
      await expect(
        prisma.storyProject.findUniqueOrThrow({
          where: { id: fixture.storyProjectId },
        }),
      ).resolves.toMatchObject({ version: 1 });
      expect(
        await prisma.agentOsToolExecutionReceipt.count({
          where: { runId, status: 'completed' },
        }),
      ).toBe(1);
    });

    it('commits one Canvas operation and replays the exact durable result after response loss', async () => {
      const fixture = await createFixture();
      const runId = await createLegacyRun(fixture.platformProjectId);
      const input = canvasInput(runId, fixture.platformProjectId);
      const service = receiptService(prisma);
      const canvas = canvasService(service);
      const execute = jest.fn(async (claimed: AgentOsCapabilityExecuteInput) =>
        success(
          await canvas.applyPatch({
            actorId: claimed.actorId,
            projectId: claimed.projectId,
            documentId: fixture.documentId,
            baseDraftRevision: 0,
            baseLayoutRevision: 0,
            operations: [
              {
                operationId: 'op-create-opening',
                kind: 'shot.upsert',
                payload: {
                  id: 'opening',
                  title: 'Opening',
                  prompt: 'A watchtower before dawn.',
                },
              },
            ],
            idempotencyKey: claimed.idempotencyKey,
            skillResolutionId: claimed.skillResolutionId,
            skillVersionIds: claimed.skillVersionIds,
            toolExecution: claimed,
          }),
        ),
      );

      const committed = await service.executeCommand(input, execute);
      const replay = await service.executeCommand(input, execute);
      const document = await prisma.studioDocument.findUniqueOrThrow({
        where: { id: fixture.documentId },
      });

      expect(replay).toEqual(committed);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(document).toMatchObject({ currentSequence: 1, version: 1 });
      expect(
        await prisma.studioDocumentOperation.count({
          where: { documentId: fixture.documentId },
        }),
      ).toBe(1);
      expect(
        await prisma.agentOsToolExecutionReceipt.count({
          where: { runId, status: 'completed' },
        }),
      ).toBe(1);
    });

    async function createFixture() {
      const suffix = randomUUID().slice(0, 8);
      const actorId = `agent-os-receipt-pg-${suffix}`;
      const workspace = await prisma.workspace.create({
        data: {
          type: WorkspaceType.team,
          name: `Receipt integration ${suffix}`,
          ownerUserId: actorId,
          createdById: actorId,
          members: {
            create: {
              userId: actorId,
              role: 'owner',
            },
          },
        },
      });
      workspaceIds.add(workspace.id);
      const platformProject = await prisma.platformProject.create({
        data: {
          workspaceId: workspace.id,
          name: `Canvas ${suffix}`,
          createdById: actorId,
        },
      });
      platformProjectIds.add(platformProject.id);
      const section = await prisma.platformProjectSection.create({
        data: {
          workspaceId: workspace.id,
          projectId: platformProject.id,
          title: 'Chapter 1',
          rank: 0,
          createdById: actorId,
        },
      });
      const document = await prisma.studioDocument.create({
        data: {
          workspaceId: workspace.id,
          platformProjectId: platformProject.id,
          sectionId: section.id,
          type: StudioDocumentType.canvas,
          status: StudioDocumentStatus.active,
          title: 'Canvas',
          contentSnapshot: { nodes: {}, edges: {} },
          createdById: actorId,
        },
      });
      const storyProject = await prisma.storyProject.create({
        data: {
          workspaceId: workspace.id,
          frameProfile: StoryFrameProfile.landscape_16_9,
          title: `Story ${suffix}`,
          defaultLocale: 'en-US',
          createdByUserId: actorId,
          members: {
            create: {
              userId: actorId,
              role: 'owner',
              status: 'active',
              grantedByUserId: actorId,
            },
          },
          writeState: { create: {} },
        },
      });
      storyProjectIds.add(storyProject.id);
      return {
        actorId,
        workspaceId: workspace.id,
        platformProjectId: platformProject.id,
        storyProjectId: storyProject.id,
        documentId: document.id,
        platformContext: {
          projectId: platformProject.id,
          projectKind: 'platform' as const,
          workspaceId: workspace.id,
        },
      };
    }

    async function createLegacyRun(projectId: string): Promise<string> {
      const id = randomUUID();
      const conversationId = randomUUID();
      runIds.add(id);
      runConversations.set(id, conversationId);
      await prisma.agentOsRun.create({
        data: {
          id,
          projectId,
          conversationId,
          actorId: actorForProject(projectId),
          modelProfileId: 'integration-test',
          status: 'running',
        },
      });
      return id;
    }

    async function createInitialRun(
      projectId: string,
      proof: AgentOsStartExecutionProof,
    ): Promise<string> {
      const id = randomUUID();
      const conversationId = randomUUID();
      runIds.add(id);
      runConversations.set(id, conversationId);
      const turnId = randomUUID();
      const messageId = randomUUID();
      await prisma.agentOsRun.create({
        data: {
          id,
          projectId,
          conversationId,
          actorId: actorForProject(projectId),
          modelProfileId: 'integration-test',
          status: 'running',
          startAdmissionVersion: 2,
          clientSubmissionId: randomUUID(),
          startTurnId: turnId,
          startUserMessageId: messageId,
          submissionFingerprint: 'a'.repeat(64),
          startCommand: {
            runId: id,
            turnId,
            messageId,
          },
          startExecutionToken: proof.executionToken,
          startExecutionAttemptId: proof.executionAttemptId,
          startExecutionEpoch: proof.executionEpoch,
          startExecutionOwnerId: proof.executionOwnerId,
          startExecutionLeaseExpiresAt: new Date(Date.now() + 90_000),
        },
      });
      return id;
    }

    async function createContinuationRun(
      projectId: string,
      proof: AgentOsContinuationExecutionProof,
    ): Promise<string> {
      const id = randomUUID();
      const conversationId = randomUUID();
      runIds.add(id);
      runConversations.set(id, conversationId);
      await prisma.agentOsRun.create({
        data: {
          id,
          projectId,
          conversationId,
          actorId: actorForProject(projectId),
          modelProfileId: 'integration-test',
          status: 'running',
          continuationCommand: {
            kind: 'approval',
            runId: id,
            turnId: randomUUID(),
            responseId: randomUUID(),
          },
          continuationExecutionToken: proof.executionToken,
          continuationExecutionAttemptId: proof.executionAttemptId,
          continuationExecutionEpoch: proof.executionEpoch,
          continuationExecutionOwnerId: proof.executionOwnerId,
          continuationExecutionLeaseExpiresAt: new Date(Date.now() + 90_000),
        },
      });
      return id;
    }

    function actorForProject(projectId: string): string {
      return `receipt-${projectId.slice(0, 24)}`;
    }

    function receiptService(client: ReturnType<typeof buildPrisma>) {
      return new AgentOsToolExecutionReceiptService(
        client as unknown as PrismaService,
        new AgentOsRunJournalService(
          client as unknown as PrismaService,
          { schedule: jest.fn() } as never,
        ),
      );
    }

    function scriptHandler(fixture: Awaited<ReturnType<typeof createFixture>>) {
      const projects = {
        requireWrite: jest.fn().mockResolvedValue(fixture.platformContext),
        authorizeRead: jest.fn().mockResolvedValue(undefined),
      };
      return new AttachmentAgentCapabilityHandler(
        new AgentOsAttachmentService(
          prisma as unknown as PrismaService,
          projects as never,
        ),
        projects as never,
        prisma as unknown as PrismaService,
        receiptService(prisma),
      );
    }

    function storyHandler(receipts: AgentOsToolExecutionReceiptService) {
      return new StoryAgentCapabilityHandler(
        prisma as unknown as PrismaService,
        new AgentOsRunJournalService(
          prisma as unknown as PrismaService,
          { schedule: jest.fn() } as never,
        ),
        { authorizeWrite: jest.fn().mockResolvedValue(undefined) } as never,
        {
          acquireAgentOsMutationFence: jest.fn().mockResolvedValue(undefined),
        } as never,
        {} as never,
        receipts,
      );
    }

    function canvasService(receipts: AgentOsToolExecutionReceiptService) {
      const documents = new DocumentsService(
        prisma as unknown as PrismaService,
        {} as never,
        { requireDocument: jest.fn().mockResolvedValue(undefined) } as never,
        {} as never,
        {} as never,
        { schedule: jest.fn() } as never,
      );
      return new AgentOsCanvasShotsService(
        prisma as unknown as PrismaService,
        documents,
        {
          publishDocumentOperation: jest.fn().mockResolvedValue(undefined),
        } as never,
        receipts,
      );
    }

    function commonInput(
      runId: string,
      projectId: string,
      toolId: string,
      argumentsValue: unknown,
    ): AgentOsCapabilityExecuteInput {
      return {
        toolId,
        runId,
        conversationId: runConversations.get(runId) ?? 'missing-conversation',
        turnId: randomUUID(),
        toolCallId: `${toolId}-call`,
        actorId: actorForProject(projectId),
        projectId,
        skillResolutionId: randomUUID(),
        skillVersionIds: [],
        idempotencyKey: `${toolId}:${runId}:v1`,
        arguments: argumentsValue,
      };
    }

    function scriptInput(runId: string, projectId: string) {
      return commonInput(runId, projectId, 'script.store', {
        text: 'EXT. WATCHTOWER — NIGHT\nThe last guard lights the beacon.',
      });
    }

    function storyProfileInput(runId: string, projectId: string) {
      return commonInput(runId, projectId, 'story.confirmCreativeProfile', {
        aspectRatio: 'landscape_16_9',
        targetRuntime: 'short_5_15',
        visualDirection: 'cinematic_realism',
        storyLanguage: 'zh-CN',
      });
    }

    function canvasInput(runId: string, projectId: string) {
      return commonInput(runId, projectId, 'canvas.applyPatch', {
        documentId: 'resolved-by-workbench-context',
        baseDraftRevision: 0,
        baseLayoutRevision: 0,
        operations: [{ operationId: 'op-create-opening' }],
      });
    }

    function executionProof(epoch: number): AgentOsStartExecutionProof {
      return {
        executionToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        executionAttemptId:
          epoch === 1
            ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
            : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        executionEpoch: epoch,
        executionOwnerId:
          epoch === 1
            ? 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
            : 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      };
    }

    function continuationProof(
      epoch: number,
    ): AgentOsContinuationExecutionProof {
      return {
        executionToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        executionAttemptId:
          epoch === 1
            ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
            : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
        executionEpoch: epoch,
        executionOwnerId:
          epoch === 1
            ? 'ffffffff-ffff-4fff-8fff-fffffffffff1'
            : 'ffffffff-ffff-4fff-8fff-fffffffffff2',
      };
    }

    function requireClaim(
      claim: Awaited<ReturnType<AgentOsToolExecutionReceiptService['claim']>>,
    ): Extract<typeof claim, { kind: 'claimed' }> {
      if (claim.kind !== 'claimed') {
        throw new Error(`Expected a claimed receipt, got ${claim.kind}.`);
      }
      return claim;
    }

    async function expireReceipt(receiptId: string): Promise<void> {
      await prisma.agentOsToolExecutionReceipt.update({
        where: { id: receiptId },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });
    }
  },
);

function success(data: unknown) {
  return { ok: true as const, data };
}

async function withCheckpointExecutionLock<T>(
  databaseUrl: string,
  conversationId: string,
  operation: () => Promise<T>,
): Promise<T> {
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
  try {
    return await operation();
  } finally {
    try {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, $2::bigint))`,
        [lockKey, AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED],
      );
    } finally {
      await client.end();
    }
  }
}

function assertDedicatedLocalPostgres(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    url.port !== '5433'
  ) {
    throw new Error(
      'Refusing Agent OS receipt integration tests: DATABASE_URL must target PostgreSQL on localhost:5433.',
    );
  }
  process.env.DATABASE_URL = rawUrl;
}

async function assertReceiptMigrationPresent(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'agent_os_tool_execution_receipts'
  `;
  if (rows[0]?.tableName !== 'agent_os_tool_execution_receipts') {
    throw new Error(
      'Local PostgreSQL is missing the Agent OS tool execution receipt migration.',
    );
  }
}
