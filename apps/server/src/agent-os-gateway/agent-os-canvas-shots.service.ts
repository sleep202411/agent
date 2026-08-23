import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  type StudioDocumentOperation,
  StudioDocumentOperationType,
  StudioDocumentStatus,
  StudioDocumentType,
} from '@prisma/client';
import {
  AGENT_SHOT_ID_PREFIX,
  compareByOrder,
  nextShotPosition,
  orderBetween,
  type ShotWrite,
} from '@repo/shared';
import * as Y from 'yjs';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { DocumentsService } from '../documents/documents.service';
import { DocumentsGateway } from '../documents/documents.gateway';
import { rootSchemaFor } from '../documents/document-modes';
import { AgentOsToolExecutionReceiptService } from './agent-os-tool-execution-receipt.service';
import type { AgentOsCapabilityExecuteInput } from './capabilities/capability-handler';

const SHOT_NODE_TYPE = 'shot';
const AGENT_OS_OPERATION_RECEIPT_KEY = 'agentOsToolReceipt';

type AgentOsOperationReceiptEnvelope = {
  requestFingerprint: string;
  result: unknown;
};

export type AgentOsCanvasShot = {
  id: string;
  title: string;
  prompt: string;
  notes?: string;
};

/**
 * A shot as it exists on the board — every field the canvas node carries, not
 * the four the agent used to keep in its own store. `agentAuthored` is
 * provenance only: human rows are addressable exactly like agent ones.
 */
export type AgentOsCanvasShotRow = {
  /** The id the agent addresses: its own shot id, or the node id for human rows. */
  id: string;
  nodeId: string;
  order: string | null;
  agentAuthored: boolean;
  title: string;
  prompt: string;
  notes: string;
  description: string;
  shotSize: string;
  perspective: string;
  movement: string;
  dialogue: string;
  videoPrompt: string;
  durationSeconds: number | null;
};

/**
 * Authoritative product write: Agent OS storyboard shots → canvas Yjs `shot` nodes.
 * Fans out over the documents WS so open Studio tabs update without a client poll.
 */
@Injectable()
export class AgentOsCanvasShotsService {
  private readonly logger = new Logger(AgentOsCanvasShotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly documentsGateway: DocumentsGateway,
    private readonly receipts: AgentOsToolExecutionReceiptService,
  ) {}

  /**
   * Product read for canvas.read tool — counts nodes / shot summaries from
   * the live CRDT (compacted state + op tail).
   */
  async readCanvasSummary(input: {
    actorId: string;
    projectId: string;
    documentId: string;
  }): Promise<{
    projectId: string;
    draftRevision: number;
    layoutRevision: number;
    nodeCount: number;
    selectedSummaries: Array<{ id: string; kind: string; title?: string }>;
  }> {
    const row = await this.prisma.studioDocument.findFirst({
      where: {
        id: input.documentId,
        platformProjectId: input.projectId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
        section: { archivedAt: null },
      },
      select: {
        id: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
        version: true,
      },
    });
    if (!row) {
      throw new UnprocessableEntityException({
        code: 'CANVAS_DOCUMENT_MISSING',
        message: 'The active chapter canvas is unavailable.',
      });
    }

    const schema = rootSchemaFor(StudioDocumentType.canvas);
    const doc = new Y.Doc({ gc: true });
    try {
      if (schema) {
        for (const [name, kind] of Object.entries(schema)) {
          if (kind === 'map') doc.getMap(name);
          else if (kind === 'array') doc.getArray(name);
          else if (kind === 'text') doc.getText(name);
        }
      }
      await this.hydrateDoc(doc, row.id, row.crdtState, row.snapshotSequence);
      const nodes = doc.getMap<Y.Map<unknown>>('nodes');
      const selectedSummaries: Array<{
        id: string;
        kind: string;
        title?: string;
      }> = [];
      nodes.forEach((yNode, id) => {
        if (!(yNode instanceof Y.Map)) return;
        const rawType: unknown = yNode.get('type');
        const type = typeof rawType === 'string' ? rawType : 'unknown';
        const data: unknown = yNode.get('data');
        let title: string | undefined;
        if (data instanceof Y.Map) {
          const label: unknown = data.get('label');
          if (typeof label === 'string' && label.trim()) title = label.trim();
        }
        selectedSummaries.push({ id, kind: type, title });
      });
      return {
        projectId: input.projectId,
        draftRevision: row.version,
        layoutRevision: row.currentSequence,
        nodeCount: selectedSummaries.length,
        selectedSummaries: selectedSummaries.slice(0, 50),
      };
    } finally {
      doc.destroy();
    }
  }

  /**
   * storyboard.listShots — the board as the agent sees it.
   *
   * Reads the canvas document, which is the single store: the storyboard table
   * and the canvas board are two renderings of it, so this returns EVERY shot,
   * including the ones a human authored. Row order is the shared comparator, so
   * the shot the model calls "3" is the row the user sees numbered 3.
   *
   * Cheap by default: when the materialised snapshot is exactly current, parse
   * plain JSON and never construct a Y.Doc. Otherwise hydrate and render the
   * same shape, so the mapping below has one input format.
   */
  async listShots(input: {
    actorId: string;
    projectId: string;
    documentId: string;
  }): Promise<{
    documentId: string;
    revision: number;
    shots: AgentOsCanvasShotRow[];
  }> {
    const row = await this.prisma.studioDocument.findFirst({
      where: {
        id: input.documentId,
        platformProjectId: input.projectId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
        section: { archivedAt: null },
      },
      select: {
        id: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
        contentSnapshot: true,
      },
    });
    if (!row) {
      throw new UnprocessableEntityException({
        code: 'CANVAS_DOCUMENT_MISSING',
        message: 'The active chapter canvas is unavailable.',
      });
    }

    // The compactor debounces (1.5s) and hard-caps (15s), so the snapshot is
    // only trustworthy when it covers every op written so far.
    const snapshotIsCurrent =
      row.snapshotSequence === row.currentSequence &&
      row.contentSnapshot !== null &&
      typeof row.contentSnapshot === 'object';

    let content: Record<string, unknown>;
    if (snapshotIsCurrent) {
      content = row.contentSnapshot as Record<string, unknown>;
    } else {
      const schema = rootSchemaFor(StudioDocumentType.canvas);
      const doc = new Y.Doc({ gc: true });
      try {
        if (schema) {
          for (const [name, kind] of Object.entries(schema)) {
            if (kind === 'map') doc.getMap(name);
            else if (kind === 'array') doc.getArray(name);
            else if (kind === 'text') doc.getText(name);
          }
        }
        await this.hydrateDoc(doc, row.id, row.crdtState, row.snapshotSequence);
        content = doc.toJSON() as Record<string, unknown>;
      } finally {
        doc.destroy();
      }
    }

    return {
      documentId: row.id,
      revision: row.currentSequence,
      shots: readShotRows(content),
    };
  }

  /**
   * canvas.applyPatch — CAS on document version + sequence, then Yjs mutate.
   * Supported kinds: node.patchData, node.move, shot.upsert.
   */
  async applyPatch(input: {
    actorId: string;
    projectId: string;
    documentId: string;
    baseDraftRevision: number;
    baseLayoutRevision: number;
    operations: Array<{
      operationId: string;
      kind: string;
      payload: Record<string, unknown>;
    }>;
    idempotencyKey: string;
    skillResolutionId: string;
    skillVersionIds: readonly string[];
    toolExecution: AgentOsCapabilityExecuteInput;
  }): Promise<{
    draftRevision: number;
    layoutRevision: number;
    appliedOperationIds: string[];
    /** Canvas nodes this patch created or changed, for "show me" links. */
    nodeIds: string[];
  }> {
    const user: AuthUser = { userId: input.actorId };
    const operationKey = `agent-os:patch:${input.idempotencyKey}`.slice(0, 160);
    const replay = await this.replayCommittedOperation<{
      draftRevision: number;
      layoutRevision: number;
      appliedOperationIds: string[];
      nodeIds: string[];
    }>(input, operationKey);
    if (replay) return replay;
    const row = await this.prisma.studioDocument.findFirst({
      where: {
        id: input.documentId,
        platformProjectId: input.projectId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
        section: { archivedAt: null },
      },
      select: {
        id: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
        version: true,
      },
    });
    if (!row) {
      throw new UnprocessableEntityException({
        code: 'CANVAS_NOT_FOUND',
        message: 'Canvas document not found for project.',
      });
    }

    if (
      row.version !== input.baseDraftRevision ||
      row.currentSequence !== input.baseLayoutRevision
    ) {
      throw new ConflictException({
        code: 'CANVAS_VERSION_CONFLICT',
        message: `Expected draftRevision ${input.baseDraftRevision} / layoutRevision ${input.baseLayoutRevision}, current is ${row.version} / ${row.currentSequence}`,
        expected: {
          draftRevision: input.baseDraftRevision,
          nodeIds: [],
          layoutRevision: input.baseLayoutRevision,
        },
        actual: {
          draftRevision: row.version,
          layoutRevision: row.currentSequence,
        },
      });
    }

    const schema = rootSchemaFor(StudioDocumentType.canvas);
    const doc = new Y.Doc({ gc: true });
    try {
      if (schema) {
        for (const [name, kind] of Object.entries(schema)) {
          if (kind === 'map') doc.getMap(name);
          else if (kind === 'array') doc.getArray(name);
          else if (kind === 'text') doc.getText(name);
        }
      }
      await this.hydrateDoc(doc, row.id, row.crdtState, row.snapshotSequence);
      const before = Y.encodeStateVector(doc);
      const appliedOperationIds: string[] = [];
      const touchedNodeIds: string[] = [];

      for (const op of input.operations) {
        const nodeId = this.applyOneOp(doc, op.kind, op.payload);
        if (nodeId && !touchedNodeIds.includes(nodeId))
          touchedNodeIds.push(nodeId);
        appliedOperationIds.push(op.operationId);
      }

      const update = Y.encodeStateAsUpdate(doc, before);
      if (update.byteLength === 0) {
        return {
          draftRevision: row.version,
          layoutRevision: row.currentSequence,
          appliedOperationIds,
          nodeIds: touchedNodeIds,
        };
      }

      let committedResult:
        | {
            draftRevision: number;
            layoutRevision: number;
            appliedOperationIds: string[];
            nodeIds: string[];
          }
        | undefined;
      const { operation } = await this.documents.appendOperation(
        user,
        row.id,
        {
          operationType: StudioDocumentOperationType.yjs_update,
          yjsUpdateBase64: Buffer.from(update).toString('base64'),
          idempotencyKey: operationKey,
          metadata: {
            source: 'agent-os',
            toolId: 'canvas.applyPatch',
            appliedOperationIds,
            skillResolutionId: input.skillResolutionId,
            skillVersionIds: [...input.skillVersionIds],
          },
        },
        {
          onTransactionStart: (tx) =>
            this.receipts.fenceBusinessMutationInTx(tx, input.toolExecution),
          onBeforeCommit: async (tx, storedOperation, context) => {
            const committedDocument = await tx.studioDocument.findUnique({
              where: { id: row.id },
              select: { version: true },
            });
            if (
              !context.replayed &&
              (storedOperation.sequence - 1 !== input.baseLayoutRevision ||
                (committedDocument?.version ?? 0) - 1 !==
                  input.baseDraftRevision)
            ) {
              throw new ConflictException({
                code: 'CANVAS_VERSION_CONFLICT',
                message:
                  'Canvas changed before this Agent patch could be committed.',
                expected: {
                  draftRevision: input.baseDraftRevision,
                  layoutRevision: input.baseLayoutRevision,
                },
                actual: {
                  draftRevision: (committedDocument?.version ?? 1) - 1,
                  layoutRevision: storedOperation.sequence - 1,
                },
              });
            }
            const result = {
              draftRevision: committedDocument?.version ?? row.version + 1,
              layoutRevision: storedOperation.sequence,
              appliedOperationIds,
              nodeIds: touchedNodeIds,
            };
            committedResult = await this.commitOperationReceiptInTx(
              tx,
              storedOperation,
              input.toolExecution,
              result,
              context.replayed,
            );
          },
        },
      );

      await this.publishOperation(row.id, operation);
      if (!committedResult) {
        throw new Error('Canvas command committed without a durable result.');
      }
      return committedResult;
    } finally {
      doc.destroy();
    }
  }

  /**
   * Remove product shot nodes (and edges) for Agent OS shot ids.
   * Node id convention: `agent-os:shot:<shotId>`.
   */
  /**
   * storyboard.deleteShots — removal in the same one-hydrate shape as the
   * write. Unknown ids fail the whole call before anything is removed, so the
   * model never gets a partial success it has to reason about.
   */
  async deleteShots(input: {
    actorId: string;
    projectId: string;
    documentId: string;
    shotIds: string[];
    baseRevision?: number;
    idempotencyKey: string;
    skillResolutionId: string;
    skillVersionIds: readonly string[];
    toolExecution: AgentOsCapabilityExecuteInput;
  }): Promise<{
    revision: number;
    deleted: Array<{ id: string; title: string }>;
    staleBaseRevision?: true;
  }> {
    const user: AuthUser = { userId: input.actorId };
    const operationKey = `agent-os:shots-del:${input.idempotencyKey}`.slice(
      0,
      160,
    );
    const replay = await this.replayCommittedOperation<{
      revision: number;
      deleted: Array<{ id: string; title: string }>;
      staleBaseRevision?: true;
    }>(input, operationKey);
    if (replay) return replay;
    const row = await this.prisma.studioDocument.findFirst({
      where: {
        id: input.documentId,
        platformProjectId: input.projectId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
        section: { archivedAt: null },
      },
      select: {
        id: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
      },
    });
    if (!row) {
      throw new UnprocessableEntityException({
        code: 'CANVAS_DOCUMENT_MISSING',
        message: 'Project canvas document is unavailable.',
      });
    }

    const doc = this.newCanvasDoc();
    try {
      await this.hydrateDoc(doc, row.id, row.crdtState, row.snapshotSequence);
      const nodes = doc.getMap<Y.Map<unknown>>('nodes');

      const targets: Array<{ id: string; nodeId: string; title: string }> = [];
      const missing: string[] = [];
      for (const shotId of input.shotIds) {
        const nodeId = resolveShotNodeId(nodes, shotId);
        if (!nodeId) {
          missing.push(shotId);
          continue;
        }
        const data: unknown = nodes.get(nodeId)?.get('data');
        const label: unknown = data instanceof Y.Map ? data.get('label') : null;
        targets.push({
          id: shotId,
          nodeId,
          title: typeof label === 'string' ? label : '',
        });
      }
      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          code: 'SHOT_NOT_FOUND',
          message: `Unknown shot id(s): ${missing.join(', ')}. Call storyboard.listShots first.`,
          missing,
        });
      }

      const before = Y.encodeStateVector(doc);
      this.removeShotNodes(
        doc,
        targets.map((target) => target.nodeId),
      );
      const update = Y.encodeStateAsUpdate(doc, before);
      const deleted = targets.map(({ id, title }) => ({ id, title }));
      if (update.byteLength === 0) {
        return {
          revision: row.currentSequence,
          deleted,
          ...(isStaleRevision(input.baseRevision, row.currentSequence)
            ? { staleBaseRevision: true as const }
            : {}),
        };
      }

      let committedResult:
        | {
            revision: number;
            deleted: Array<{ id: string; title: string }>;
            staleBaseRevision?: true;
          }
        | undefined;
      const { operation } = await this.documents.appendOperation(
        user,
        row.id,
        {
          operationType: StudioDocumentOperationType.yjs_update,
          yjsUpdateBase64: Buffer.from(update).toString('base64'),
          idempotencyKey: operationKey,
          metadata: {
            source: 'agent-os',
            toolId: 'storyboard.deleteShots',
            skillResolutionId: input.skillResolutionId,
            skillVersionIds: [...input.skillVersionIds],
          },
        },
        {
          onTransactionStart: (tx) =>
            this.receipts.fenceBusinessMutationInTx(tx, input.toolExecution),
          onBeforeCommit: async (tx, storedOperation, context) => {
            const result = {
              revision: storedOperation.sequence,
              deleted,
              ...(isStaleRevision(
                input.baseRevision,
                storedOperation.sequence - 1,
              )
                ? { staleBaseRevision: true as const }
                : {}),
            };
            committedResult = await this.commitOperationReceiptInTx(
              tx,
              storedOperation,
              input.toolExecution,
              result,
              context.replayed,
            );
          },
        },
      );

      await this.publishOperation(row.id, operation);
      if (!committedResult) {
        throw new Error(
          'Storyboard delete committed without a durable result.',
        );
      }
      return committedResult;
    } finally {
      doc.destroy();
    }
  }

  /**
   * storyboard.upsertShots — the single write. Addressing, existence checks,
   * row placement and the field patch all happen inside ONE hydrate of the
   * document that is then appended as one operation, so a shot can never
   * "exist" anywhere the board did not actually receive it.
   */
  async applyShots(input: {
    actorId: string;
    projectId: string;
    documentId: string;
    shots: ShotWrite[];
    baseRevision?: number;
    idempotencyKey: string;
    skillResolutionId: string;
    skillVersionIds: readonly string[];
    toolExecution: AgentOsCapabilityExecuteInput;
  }): Promise<{
    revision: number;
    written: Array<{ id: string; title: string; nodeId: string }>;
    staleBaseRevision?: true;
  }> {
    const user: AuthUser = { userId: input.actorId };
    const operationKey = `agent-os:shots:${input.idempotencyKey}`.slice(0, 160);
    const replay = await this.replayCommittedOperation<{
      revision: number;
      written: Array<{ id: string; title: string; nodeId: string }>;
      staleBaseRevision?: true;
    }>(input, operationKey);
    if (replay) return replay;
    const row = await this.prisma.studioDocument.findFirst({
      where: {
        id: input.documentId,
        platformProjectId: input.projectId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
        section: { archivedAt: null },
      },
      select: {
        id: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
      },
    });
    if (!row) {
      throw new UnprocessableEntityException({
        code: 'CANVAS_DOCUMENT_MISSING',
        message: 'Project canvas document is unavailable.',
      });
    }

    const doc = this.newCanvasDoc();
    try {
      await this.hydrateDoc(doc, row.id, row.crdtState, row.snapshotSequence);

      const before = Y.encodeStateVector(doc);
      const written = this.writeShotNodes(doc, input.shots);
      const update = Y.encodeStateAsUpdate(doc, before);
      if (update.byteLength === 0) {
        return {
          revision: row.currentSequence,
          written,
          ...(isStaleRevision(input.baseRevision, row.currentSequence)
            ? { staleBaseRevision: true as const }
            : {}),
        };
      }

      let committedResult:
        | {
            revision: number;
            written: Array<{ id: string; title: string; nodeId: string }>;
            staleBaseRevision?: true;
          }
        | undefined;
      const { operation } = await this.documents.appendOperation(
        user,
        row.id,
        {
          operationType: StudioDocumentOperationType.yjs_update,
          yjsUpdateBase64: Buffer.from(update).toString('base64'),
          idempotencyKey: operationKey,
          metadata: {
            source: 'agent-os',
            toolId: 'storyboard.upsertShots',
            skillResolutionId: input.skillResolutionId,
            skillVersionIds: [...input.skillVersionIds],
          },
        },
        {
          onTransactionStart: (tx) =>
            this.receipts.fenceBusinessMutationInTx(tx, input.toolExecution),
          onBeforeCommit: async (tx, storedOperation, context) => {
            const result = {
              revision: storedOperation.sequence,
              written,
              ...(isStaleRevision(
                input.baseRevision,
                storedOperation.sequence - 1,
              )
                ? { staleBaseRevision: true as const }
                : {}),
            };
            committedResult = await this.commitOperationReceiptInTx(
              tx,
              storedOperation,
              input.toolExecution,
              result,
              context.replayed,
            );
          },
        },
      );

      await this.publishOperation(row.id, operation);
      if (!committedResult) {
        throw new Error(
          'Storyboard upsert committed without a durable result.',
        );
      }
      return committedResult;
    } finally {
      doc.destroy();
    }
  }

  /**
   * Recover an operation that committed before the caller received its HTTP
   * response. This lookup deliberately precedes document/version/hydration
   * checks: an exact replay returns the original product result even after the
   * board has advanced.
   */
  private async replayCommittedOperation<T extends object>(
    input: {
      projectId: string;
      documentId: string;
      toolExecution: AgentOsCapabilityExecuteInput;
    },
    idempotencyKey: string,
  ): Promise<T | null> {
    const operation = await this.prisma.studioDocumentOperation.findFirst({
      where: {
        documentId: input.documentId,
        idempotencyKey,
        document: {
          platformProjectId: input.projectId,
          type: StudioDocumentType.canvas,
          deletedAt: null,
        },
      },
    });
    if (!operation) return null;
    const envelope = operationReceiptEnvelope(operation.metadata);
    const receipt = input.toolExecution.toolExecutionReceipt;
    if (
      !receipt ||
      envelope?.requestFingerprint !== receipt.requestFingerprint
    ) {
      throw new ConflictException({
        code: 'AGENT_OS_DOCUMENT_RECEIPT_CONFLICT',
        message:
          'The document idempotency key was already committed by a different tool request.',
      });
    }
    const result = requireObjectResult<T>(envelope.result);
    await this.prisma.$transaction((tx) =>
      this.receipts.completeSuccessInTx(tx, input.toolExecution, result),
    );
    return result;
  }

  private async commitOperationReceiptInTx<T extends object>(
    tx: Prisma.TransactionClient,
    operation: StudioDocumentOperation,
    toolExecution: AgentOsCapabilityExecuteInput,
    proposedResult: T,
    replayed: boolean,
  ): Promise<T> {
    const receipt = toolExecution.toolExecutionReceipt;
    if (!receipt) {
      throw new ConflictException({
        code: 'AGENT_OS_DOCUMENT_RECEIPT_REQUIRED',
        message: 'A document command requires a durable tool receipt.',
      });
    }
    const existing = operationReceiptEnvelope(operation.metadata);
    if (existing) {
      if (existing.requestFingerprint !== receipt.requestFingerprint) {
        throw new ConflictException({
          code: 'AGENT_OS_DOCUMENT_RECEIPT_CONFLICT',
          message:
            'The document idempotency key belongs to a different tool payload.',
        });
      }
      const stored = requireObjectResult<T>(existing.result);
      await this.receipts.completeSuccessInTx(tx, toolExecution, stored);
      return stored;
    }
    if (replayed) {
      throw new ConflictException({
        code: 'AGENT_OS_DOCUMENT_RECEIPT_MISSING',
        message:
          'The existing document operation predates durable Agent OS receipts and cannot be replayed safely.',
      });
    }
    const metadata = jsonObject(operation.metadata);
    await tx.studioDocumentOperation.update({
      where: { id: operation.id },
      data: {
        metadata: {
          ...metadata,
          [AGENT_OS_OPERATION_RECEIPT_KEY]: {
            requestFingerprint: receipt.requestFingerprint,
            result: proposedResult,
          },
        } as Prisma.InputJsonObject,
      },
    });
    await this.receipts.completeSuccessInTx(tx, toolExecution, proposedResult);
    return proposedResult;
  }

  private async publishOperation(
    documentId: string,
    operation: unknown,
  ): Promise<void> {
    try {
      await this.documentsGateway.publishDocumentOperation(
        documentId,
        operation,
      );
    } catch (error) {
      // PostgreSQL already owns both the product mutation and its exact result.
      // A realtime transport outage must not turn that durable success into a
      // second command execution; reconnect/sync will recover the operation.
      const operationId = asRecord(operation).id;
      this.logger.error(
        `Document operation ${typeof operationId === 'string' ? operationId : 'unknown'} committed but realtime publication failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** A Y.Doc with the canvas roots declared, ready to hydrate. */
  private newCanvasDoc(): Y.Doc {
    const schema = rootSchemaFor(StudioDocumentType.canvas);
    const doc = new Y.Doc({ gc: true });
    if (schema) {
      for (const [name, kind] of Object.entries(schema)) {
        if (kind === 'map') doc.getMap(name);
        else if (kind === 'array') doc.getArray(name);
        else if (kind === 'text') doc.getText(name);
      }
    }
    return doc;
  }

  private async hydrateDoc(
    doc: Y.Doc,
    documentId: string,
    crdtState: Buffer | Uint8Array | null,
    snapshotSequence: number,
  ): Promise<void> {
    if (crdtState && crdtState.byteLength > 0) {
      Y.applyUpdate(
        doc,
        crdtState instanceof Buffer ? new Uint8Array(crdtState) : crdtState,
      );
    }
    const tail = await this.prisma.studioDocumentOperation.findMany({
      where: {
        documentId,
        sequence: { gt: snapshotSequence },
        yjsUpdate: { not: null },
      },
      orderBy: { sequence: 'asc' },
      select: { yjsUpdate: true },
      take: 5_000,
    });
    for (const op of tail) {
      if (op.yjsUpdate && op.yjsUpdate.byteLength > 0) {
        Y.applyUpdate(doc, new Uint8Array(op.yjsUpdate));
      }
    }
  }

  /**
   * Apply one patch operation and report the node it touched.
   *
   * The node id is what lets the UI offer "show me this on the canvas" — a
   * write the user cannot find is barely a write at all.
   */
  private applyOneOp(
    doc: Y.Doc,
    kind: string,
    payload: Record<string, unknown>,
  ): string | null {
    switch (kind) {
      case 'node.patchData': {
        const nodeId = stringField(payload, 'nodeId');
        const data = payload.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new UnprocessableEntityException({
            code: 'INVALID_PATCH_PAYLOAD',
            message: 'node.patchData requires data object',
          });
        }
        const yNode = doc.getMap<Y.Map<unknown>>('nodes').get(nodeId);
        if (!(yNode instanceof Y.Map)) {
          throw new UnprocessableEntityException({
            code: 'NODE_NOT_FOUND',
            message: `Node ${nodeId} not found`,
          });
        }
        let dataY = yNode.get('data');
        if (!(dataY instanceof Y.Map)) {
          dataY = new Y.Map<unknown>();
          yNode.set('data', dataY);
        }
        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          if (v === null || v === undefined)
            (dataY as Y.Map<unknown>).delete(k);
          else (dataY as Y.Map<unknown>).set(k, v);
        }
        return nodeId;
      }
      case 'node.move': {
        const nodeId = stringField(payload, 'nodeId');
        const x = numberField(payload, 'x');
        const y = numberField(payload, 'y');
        const yNode = doc.getMap<Y.Map<unknown>>('nodes').get(nodeId);
        if (!(yNode instanceof Y.Map)) {
          throw new UnprocessableEntityException({
            code: 'NODE_NOT_FOUND',
            message: `Node ${nodeId} not found`,
          });
        }
        let pos = yNode.get('position');
        if (!(pos instanceof Y.Map)) {
          pos = new Y.Map<number>();
          yNode.set('position', pos);
        }
        (pos as Y.Map<number>).set('x', x);
        (pos as Y.Map<number>).set('y', y);
        return nodeId;
      }
      case 'shot.upsert': {
        const id = stringField(payload, 'id');
        const title = stringField(payload, 'title');
        const prompt = stringField(payload, 'prompt');
        const notes =
          typeof payload.notes === 'string' ? payload.notes : undefined;
        // Same write path as storyboard.upsertShots — one shot writer.
        const nodes = doc.getMap<Y.Map<unknown>>('nodes');
        this.writeShotNodes(doc, [
          {
            id,
            intent: resolveShotNodeId(nodes, id) ? 'replace' : 'create',
            title,
            prompt,
            notes,
          },
        ]);
        return resolveShotNodeId(nodes, id) ?? `${AGENT_SHOT_ID_PREFIX}${id}`;
      }
      case 'node.delete': {
        const nodeId = stringField(payload, 'nodeId');
        const nodes = doc.getMap<Y.Map<unknown>>('nodes');
        if (!nodes.has(nodeId)) {
          throw new UnprocessableEntityException({
            code: 'NODE_NOT_FOUND',
            message: `Node ${nodeId} not found`,
          });
        }
        nodes.delete(nodeId);
        // Drop edges that referenced the deleted node.
        const edges = doc.getMap<Y.Map<unknown>>('edges');
        const drop: string[] = [];
        edges.forEach((yEdge, edgeId) => {
          if (!(yEdge instanceof Y.Map)) return;
          if (
            yEdge.get('source') === nodeId ||
            yEdge.get('target') === nodeId
          ) {
            drop.push(edgeId);
          }
        });
        for (const edgeId of drop) edges.delete(edgeId);
        return null;
      }
      case 'edge.connect': {
        const edgeId = stringField(payload, 'edgeId');
        const source = stringField(payload, 'source');
        const target = stringField(payload, 'target');
        const nodes = doc.getMap<Y.Map<unknown>>('nodes');
        if (!nodes.has(source) || !nodes.has(target)) {
          throw new UnprocessableEntityException({
            code: 'NODE_NOT_FOUND',
            message: 'edge.connect requires existing source and target nodes',
          });
        }
        const edges = doc.getMap<Y.Map<unknown>>('edges');
        let yEdge = edges.get(edgeId);
        if (!(yEdge instanceof Y.Map)) {
          yEdge = new Y.Map<unknown>();
          edges.set(edgeId, yEdge);
        }
        yEdge.set('id', edgeId);
        yEdge.set('source', source);
        yEdge.set('target', target);
        if (typeof payload.sourceHandle === 'string') {
          yEdge.set('sourceHandle', payload.sourceHandle);
        }
        if (typeof payload.targetHandle === 'string') {
          yEdge.set('targetHandle', payload.targetHandle);
        }
        return null;
      }
      case 'edge.remove': {
        const edgeId = stringField(payload, 'edgeId');
        const edges = doc.getMap<Y.Map<unknown>>('edges');
        if (!edges.has(edgeId)) {
          throw new UnprocessableEntityException({
            code: 'EDGE_NOT_FOUND',
            message: `Edge ${edgeId} not found`,
          });
        }
        edges.delete(edgeId);
        return null;
      }
      default:
        throw new UnprocessableEntityException({
          code: 'UNSUPPORTED_PATCH_KIND',
          message:
            'Unsupported canvas patch kind. Allowed: node.patchData, node.move, node.delete, edge.connect, edge.remove, shot.upsert',
        });
    }
  }

  /** Drop shot nodes by RESOLVED node id, cascading their wires. */
  private removeShotNodes(doc: Y.Doc, nodeIds: string[]): void {
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const edges = doc.getMap<Y.Map<unknown>>('edges');

    for (const nodeId of nodeIds) {
      if (!nodes.has(nodeId)) continue;
      nodes.delete(nodeId);
      const drop: string[] = [];
      edges.forEach((yEdge, edgeId) => {
        if (!(yEdge instanceof Y.Map)) return;
        if (yEdge.get('source') === nodeId || yEdge.get('target') === nodeId) {
          drop.push(edgeId);
        }
      });
      for (const edgeId of drop) edges.delete(edgeId);
    }
  }

  /**
   * Apply a batch of shot writes to the hydrated doc.
   *
   * Two rules carry the weight. Addressing: a shot is found by its node id
   * (a human's row) or by its agent id (`agent-os:shot:<id>`), so the agent can
   * touch anything on the board. Patching: only the fields the write NAMES are
   * set, because the row belongs to whoever is editing it — blanket-setting
   * five keys is how an agent used to wipe a human's 画面描述.
   */
  private writeShotNodes(
    doc: Y.Doc,
    shots: ShotWrite[],
  ): Array<{ id: string; title: string; nodeId: string }> {
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const written: Array<{ id: string; title: string; nodeId: string }> = [];

    for (const shot of shots) {
      const existingNodeId = resolveShotNodeId(nodes, shot.id);

      if (shot.intent === 'create' && existingNodeId) {
        throw new UnprocessableEntityException({
          code: 'SHOT_EXISTS',
          message: `Shot ${shot.id} already exists. Use intent "replace" to update it.`,
        });
      }
      if (shot.intent === 'replace' && !existingNodeId) {
        throw new UnprocessableEntityException({
          code: 'SHOT_NOT_FOUND',
          message: `Unknown shot id ${shot.id}. Call storyboard.listShots first.`,
        });
      }

      const nodeId = existingNodeId ?? `${AGENT_SHOT_ID_PREFIX}${shot.id}`;
      let yNode = nodes.get(nodeId);

      if (!(yNode instanceof Y.Map)) {
        yNode = new Y.Map<unknown>();
        nodes.set(nodeId, yNode);
        yNode.set('id', nodeId);
        yNode.set('type', SHOT_NODE_TYPE);
        const { x, y } = nextShotPosition(readNodeGeometry(nodes));
        const position = new Y.Map<number>();
        position.set('x', x);
        position.set('y', y);
        yNode.set('position', position);
        yNode.set('data', new Y.Map<unknown>());
      }

      let data = yNode.get('data');
      if (!(data instanceof Y.Map)) {
        data = new Y.Map<unknown>();
        yNode.set('data', data);
      }
      const shotData = data as Y.Map<unknown>;

      // Order: place on create, or on replace only when `after` was given.
      const placing = shot.after !== undefined;
      if (!existingNodeId || placing) {
        shotData.set('order', placeShotOrder(nodes, nodeId, shot.after));
      }
      // Provenance for rows this agent created; never stamped on a human row.
      if (!existingNodeId) shotData.set('agentOsShotId', shot.id);

      for (const [key, value] of shotWritePatch(shot)) shotData.set(key, value);

      const title =
        typeof shotData.get('label') === 'string'
          ? (shotData.get('label') as string)
          : '';
      written.push({ id: shot.id, title, nodeId });
    }

    return written;
  }
}

/** Geometry of every placed node, in the shape the shared placer expects. */
function readNodeGeometry(
  nodes: Y.Map<Y.Map<unknown>>,
): Array<{ type: string; position: { x: number; y: number } | null }> {
  const out: Array<{
    type: string;
    position: { x: number; y: number } | null;
  }> = [];
  nodes.forEach((yNode) => {
    if (!(yNode instanceof Y.Map)) return;
    const position = yNode.get('position');
    const rawType: unknown = yNode.get('type');
    out.push({
      type: typeof rawType === 'string' ? rawType : '',
      position:
        position instanceof Y.Map
          ? {
              x: Number(position.get('x') ?? 0),
              y: Number(position.get('y') ?? 0),
            }
          : null,
    });
  });
  return out;
}

/**
 * The node a write addresses: a raw node id (a row the user created) or an
 * agent id that resolves to the prefixed node. Returns null when the board has
 * no such shot, which is what separates create from replace.
 */
function resolveShotNodeId(
  nodes: Y.Map<Y.Map<unknown>>,
  shotId: string,
): string | null {
  for (const candidate of [shotId, `${AGENT_SHOT_ID_PREFIX}${shotId}`]) {
    const node = nodes.get(candidate);
    if (node instanceof Y.Map && node.get('type') === SHOT_NODE_TYPE) {
      return candidate;
    }
  }
  return null;
}

/** Shot rows currently on the board, in order, excluding one node id. */
function boardOrder(
  nodes: Y.Map<Y.Map<unknown>>,
  excludeNodeId: string,
): Array<{ id: string; order: string | null }> {
  const rows: Array<{ id: string; order: string | null }> = [];
  nodes.forEach((yNode, id) => {
    if (id === excludeNodeId) return;
    if (!(yNode instanceof Y.Map) || yNode.get('type') !== SHOT_NODE_TYPE)
      return;
    const data = yNode.get('data');
    const order: unknown = data instanceof Y.Map ? data.get('order') : null;
    rows.push({ id, order: typeof order === 'string' ? order : null });
  });
  return rows.sort(compareByOrder);
}

/**
 * The order key for a shot placed after `after` — `null` meaning the top of the
 * board and `undefined` meaning append. Both neighbours come from the same
 * hydrated doc, so a batch that creates several rows walks forward correctly.
 */
function placeShotOrder(
  nodes: Y.Map<Y.Map<unknown>>,
  nodeId: string,
  after: string | null | undefined,
): string {
  const rows = boardOrder(nodes, nodeId);
  if (after === null) {
    return orderBetween(null, rows[0]?.order ?? null);
  }
  if (after === undefined) {
    return orderBetween(rows[rows.length - 1]?.order ?? null, null);
  }
  const anchor = resolveShotNodeId(nodes, after);
  const index = anchor ? rows.findIndex((row) => row.id === anchor) : -1;
  if (index === -1) {
    // Unknown anchor: append rather than fail — placement is not the point of
    // the call, and a lost row would be worse than a row in the wrong place.
    return orderBetween(rows[rows.length - 1]?.order ?? null, null);
  }
  return orderBetween(rows[index].order, rows[index + 1]?.order ?? null);
}

/**
 * Field mapping for one write — ONLY the keys the caller supplied.
 *
 * `prompt` is 图片提示词 and lands on imagePrompt alone. It used to be written
 * to `description` as well, which silently overwrote the human's 画面描述 on
 * every agent touch; the two are different columns owned by different authors.
 */
function shotWritePatch(shot: ShotWrite): Array<[string, unknown]> {
  const patch: Array<[string, unknown]> = [];
  if (shot.title !== undefined) patch.push(['label', shot.title]);
  if (shot.prompt !== undefined) patch.push(['imagePrompt', shot.prompt]);
  if (shot.description !== undefined)
    patch.push(['description', shot.description]);
  if (shot.notes !== undefined) patch.push(['notes', shot.notes]);
  if (shot.dialogue !== undefined) patch.push(['dialogue', shot.dialogue]);
  if (shot.videoPrompt !== undefined)
    patch.push(['videoPrompt', shot.videoPrompt]);
  if (shot.shotSize !== undefined) patch.push(['shotSize', shot.shotSize]);
  if (shot.perspective !== undefined)
    patch.push(['perspective', shot.perspective]);
  if (shot.movement !== undefined) patch.push(['movement', shot.movement]);
  if (shot.durationSeconds !== undefined) {
    patch.push(['durationSeconds', shot.durationSeconds]);
  }
  return patch;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  return asRecord(value) as Prisma.InputJsonObject;
}

function operationReceiptEnvelope(
  metadata: Prisma.JsonValue,
): AgentOsOperationReceiptEnvelope | null {
  const candidate = asRecord(metadata)[AGENT_OS_OPERATION_RECEIPT_KEY];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  return typeof record.requestFingerprint === 'string' &&
    Object.hasOwn(record, 'result')
    ? {
        requestFingerprint: record.requestFingerprint,
        result: record.result,
      }
    : null;
}

function requireObjectResult<T extends object>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConflictException({
      code: 'AGENT_OS_DOCUMENT_RECEIPT_CORRUPT',
      message: 'The stored document tool result is invalid.',
    });
  }
  return value as T;
}

function isStaleRevision(
  expected: number | undefined,
  actual: number,
): boolean {
  return expected !== undefined && expected !== actual;
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Shot nodes of a canvas document (`Y.Doc.toJSON()` shape), in board order.
 * Sorting goes through the shared comparator so the row numbers the model is
 * told match the row numbers the storyboard table renders.
 */
export function readShotRows(
  content: Record<string, unknown>,
): AgentOsCanvasShotRow[] {
  const nodes = asRecord(content.nodes);
  const rows: AgentOsCanvasShotRow[] = [];

  for (const [nodeId, rawNode] of Object.entries(nodes)) {
    const node = asRecord(rawNode);
    if (node.type !== SHOT_NODE_TYPE) continue;
    const data = asRecord(node.data);
    const agentOsShotId = readString(data, 'agentOsShotId');
    const order = readString(data, 'order');
    const duration = data.durationSeconds;

    rows.push({
      id: agentOsShotId || nodeId,
      nodeId,
      order: order || null,
      agentAuthored: Boolean(agentOsShotId),
      title: readString(data, 'label'),
      prompt: readString(data, 'imagePrompt'),
      notes: readString(data, 'notes'),
      description: readString(data, 'description'),
      shotSize: readString(data, 'shotSize'),
      perspective: readString(data, 'perspective'),
      movement: readString(data, 'movement'),
      dialogue: readString(data, 'dialogue'),
      videoPrompt: readString(data, 'videoPrompt'),
      durationSeconds: typeof duration === 'number' ? duration : null,
    });
  }

  return rows.sort(compareByOrder);
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UnprocessableEntityException({
      code: 'INVALID_PATCH_PAYLOAD',
      message: `${key} must be a non-empty string`,
    });
  }
  return value.trim();
}

function numberField(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UnprocessableEntityException({
      code: 'INVALID_PATCH_PAYLOAD',
      message: `${key} must be a finite number`,
    });
  }
  return value;
}
