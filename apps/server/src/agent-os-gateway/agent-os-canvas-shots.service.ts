import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlatformDocumentOperationType,
  PlatformDocumentStatus,
  PlatformDocumentType,
} from '@prisma/client';
import { orderAfter } from '@repo/shared';
import * as Y from 'yjs';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { DocumentsService } from '../documents/documents.service';
import { DocumentsGateway } from '../documents/documents.gateway';
import { rootSchemaFor } from '../documents/document-modes';

const SHOT_NODE_TYPE = 'shot';
const SHOT_NODE_WIDTH = 280;
const SHOT_STRIP_GAP = 64;

export type AgentOsCanvasShot = {
  id: string;
  title: string;
  prompt: string;
  notes?: string;
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
  ) {}

  /**
   * Product read for canvas.read tool — counts nodes / shot summaries from
   * the live CRDT (compacted state + op tail).
   */
  async readCanvasSummary(input: {
    actorId: string;
    projectId: string;
  }): Promise<{
    projectId: string;
    draftRevision: number;
    layoutRevision: number;
    nodeCount: number;
    selectedSummaries: Array<{ id: string; kind: string; title?: string }>;
  }> {
    const user: AuthUser = { userId: input.actorId };
    const ensured = await this.documents.ensurePrimaryDocument(
      user,
      input.projectId,
      PlatformDocumentType.canvas,
    );
    const documentId = ensured.document.id as string;
    const row = await this.prisma.platformDocument.findFirst({
      where: {
        id: documentId,
        status: PlatformDocumentStatus.active,
        deletedAt: null,
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
      return {
        projectId: input.projectId,
        draftRevision: 0,
        layoutRevision: 0,
        nodeCount: 0,
        selectedSummaries: [],
      };
    }

    const schema = rootSchemaFor(PlatformDocumentType.canvas);
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
        const type = String(yNode.get('type') ?? 'unknown');
        const data = yNode.get('data');
        let title: string | undefined;
        if (data instanceof Y.Map) {
          const label = data.get('label');
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
   * canvas.applyPatch — CAS on document version + sequence, then Yjs mutate.
   * Supported kinds: node.patchData, node.move, shot.upsert.
   */
  async applyPatch(input: {
    actorId: string;
    projectId: string;
    baseDraftRevision: number;
    baseLayoutRevision: number;
    operations: Array<{
      operationId: string;
      kind: string;
      payload: Record<string, unknown>;
    }>;
    idempotencyKey: string;
  }): Promise<{
    draftRevision: number;
    layoutRevision: number;
    appliedOperationIds: string[];
  }> {
    const user: AuthUser = { userId: input.actorId };
    const ensured = await this.documents.ensurePrimaryDocument(
      user,
      input.projectId,
      PlatformDocumentType.canvas,
    );
    const documentId = ensured.document.id as string;
    const row = await this.prisma.platformDocument.findFirst({
      where: {
        id: documentId,
        status: PlatformDocumentStatus.active,
        deletedAt: null,
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
          layoutRevision: input.baseLayoutRevision,
        },
        actual: {
          draftRevision: row.version,
          layoutRevision: row.currentSequence,
        },
      });
    }

    const schema = rootSchemaFor(PlatformDocumentType.canvas);
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

      for (const op of input.operations) {
        this.applyOneOp(doc, op.kind, op.payload);
        appliedOperationIds.push(op.operationId);
      }

      const update = Y.encodeStateAsUpdate(doc, before);
      if (update.byteLength === 0) {
        return {
          draftRevision: row.version,
          layoutRevision: row.currentSequence,
          appliedOperationIds,
        };
      }

      const { operation } = await this.documents.appendOperation(user, row.id, {
        operationType: PlatformDocumentOperationType.yjs_update,
        yjsUpdateBase64: Buffer.from(update).toString('base64'),
        idempotencyKey: `agent-os:patch:${input.idempotencyKey}`.slice(0, 160),
        metadata: {
          source: 'agent-os',
          toolId: 'canvas.applyPatch',
          appliedOperationIds,
        },
      });

      await this.documentsGateway.publishDocumentOperation(row.id, operation);

      const refreshed = await this.prisma.platformDocument.findUnique({
        where: { id: row.id },
        select: { version: true, currentSequence: true },
      });

      return {
        draftRevision: refreshed?.version ?? row.version + 1,
        layoutRevision:
          (operation.sequence as number) ??
          refreshed?.currentSequence ??
          row.currentSequence + 1,
        appliedOperationIds,
      };
    } finally {
      doc.destroy();
    }
  }

  /**
   * Remove product shot nodes (and edges) for Agent OS shot ids.
   * Node id convention: `agent-os:shot:<shotId>`.
   */
  async deleteShots(input: {
    actorId: string;
    projectId: string;
    shotIds: string[];
    idempotencyKey: string;
  }): Promise<{
    documentId: string;
    sequence: number;
    removed: Array<{ id: string; nodeId: string }>;
  } | null> {
    if (input.shotIds.length === 0) return null;

    const user: AuthUser = { userId: input.actorId };
    let documentId: string;
    try {
      const ensured = await this.documents.ensurePrimaryDocument(
        user,
        input.projectId,
        PlatformDocumentType.canvas,
      );
      documentId = ensured.document.id as string;
    } catch (error) {
      this.logger.warn(
        `ensurePrimaryDocument canvas failed projectId=${input.projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    const row = await this.prisma.platformDocument.findFirst({
      where: {
        id: documentId,
        status: PlatformDocumentStatus.active,
        deletedAt: null,
      },
      select: {
        id: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
      },
    });
    if (!row) return null;

    const schema = rootSchemaFor(PlatformDocumentType.canvas);
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
      const removed = this.removeShotNodes(doc, input.shotIds);
      const update = Y.encodeStateAsUpdate(doc, before);
      if (update.byteLength === 0) {
        return {
          documentId: row.id,
          sequence: row.currentSequence,
          removed,
        };
      }

      const { operation } = await this.documents.appendOperation(user, row.id, {
        operationType: PlatformDocumentOperationType.yjs_update,
        yjsUpdateBase64: Buffer.from(update).toString('base64'),
        idempotencyKey: `agent-os:shots-del:${input.idempotencyKey}`.slice(
          0,
          160,
        ),
        metadata: {
          source: 'agent-os',
          toolId: 'storyboard.deleteShots',
        },
      });

      await this.documentsGateway.publishDocumentOperation(row.id, operation);

      return {
        documentId: row.id,
        sequence: operation.sequence as number,
        removed,
      };
    } finally {
      doc.destroy();
    }
  }

  async applyShots(input: {
    actorId: string;
    projectId: string;
    shots: AgentOsCanvasShot[];
    idempotencyKey: string;
  }): Promise<{
    documentId: string;
    sequence: number;
    written: Array<{ id: string; title: string; nodeId: string }>;
  } | null> {
    if (input.shots.length === 0) return null;

    const user: AuthUser = { userId: input.actorId };
    let documentId: string;
    try {
      const ensured = await this.documents.ensurePrimaryDocument(
        user,
        input.projectId,
        PlatformDocumentType.canvas,
      );
      documentId = ensured.document.id as string;
    } catch (error) {
      this.logger.warn(
        `ensurePrimaryDocument canvas failed projectId=${input.projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    const row = await this.prisma.platformDocument.findFirst({
      where: {
        id: documentId,
        status: PlatformDocumentStatus.active,
        deletedAt: null,
      },
      select: {
        id: true,
        crdtState: true,
        snapshotSequence: true,
        currentSequence: true,
      },
    });
    if (!row) return null;

    const schema = rootSchemaFor(PlatformDocumentType.canvas);
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
      const written = this.writeShotNodes(doc, input.shots);
      const update = Y.encodeStateAsUpdate(doc, before);
      if (update.byteLength === 0) {
        return {
          documentId: row.id,
          sequence: row.currentSequence,
          written,
        };
      }

      const { operation } = await this.documents.appendOperation(user, row.id, {
        operationType: PlatformDocumentOperationType.yjs_update,
        yjsUpdateBase64: Buffer.from(update).toString('base64'),
        idempotencyKey: `agent-os:shots:${input.idempotencyKey}`.slice(0, 160),
        metadata: {
          source: 'agent-os',
          toolId: 'storyboard.upsertShots',
        },
      });

      await this.documentsGateway.publishDocumentOperation(row.id, operation);

      return {
        documentId: row.id,
        sequence: operation.sequence as number,
        written,
      };
    } finally {
      doc.destroy();
    }
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
    const tail = await this.prisma.platformDocumentOperation.findMany({
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

  private applyOneOp(
    doc: Y.Doc,
    kind: string,
    payload: Record<string, unknown>,
  ): void {
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
        return;
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
        return;
      }
      case 'shot.upsert': {
        const id = stringField(payload, 'id');
        const title = stringField(payload, 'title');
        const prompt = stringField(payload, 'prompt');
        const notes =
          typeof payload.notes === 'string' ? payload.notes : undefined;
        this.writeShotNodes(doc, [{ id, title, prompt, notes }]);
        return;
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
        return;
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
        return;
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
        return;
      }
      default:
        throw new UnprocessableEntityException({
          code: 'UNSUPPORTED_PATCH_KIND',
          message:
            'Unsupported canvas patch kind. Allowed: node.patchData, node.move, node.delete, edge.connect, edge.remove, shot.upsert',
        });
    }
  }

  private removeShotNodes(
    doc: Y.Doc,
    shotIds: string[],
  ): Array<{ id: string; nodeId: string }> {
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const edges = doc.getMap<Y.Map<unknown>>('edges');
    const removed: Array<{ id: string; nodeId: string }> = [];

    for (const shotId of shotIds) {
      const nodeId = toShotNodeId(shotId);
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
      removed.push({ id: shotId, nodeId });
    }

    return removed;
  }

  private writeShotNodes(
    doc: Y.Doc,
    shots: AgentOsCanvasShot[],
  ): Array<{ id: string; title: string; nodeId: string }> {
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const existingShotOrders: string[] = [];
    let maxX = 0;
    let stripY = 0;
    let hasShot = false;

    nodes.forEach((yNode) => {
      if (!(yNode instanceof Y.Map)) return;
      if (yNode.get('type') !== SHOT_NODE_TYPE) return;
      hasShot = true;
      const data = yNode.get('data');
      if (data instanceof Y.Map) {
        const order = data.get('order');
        if (typeof order === 'string') existingShotOrders.push(order);
      }
      const pos = yNode.get('position');
      if (pos instanceof Y.Map) {
        const x = Number(pos.get('x') ?? 0);
        const y = Number(pos.get('y') ?? 0);
        if (x >= maxX) {
          maxX = x;
          stripY = y;
        }
      }
    });

    existingShotOrders.sort();
    let orderCursor =
      existingShotOrders.length > 0
        ? existingShotOrders[existingShotOrders.length - 1]
        : undefined;
    let nextX = hasShot ? maxX + SHOT_NODE_WIDTH + SHOT_STRIP_GAP : 0;
    const nextY = hasShot ? stripY : 0;
    const written: Array<{ id: string; title: string; nodeId: string }> = [];

    for (const shot of shots) {
      const nodeId = toShotNodeId(shot.id);
      const patch = {
        label: shot.title,
        imagePrompt: shot.prompt,
        description: shot.prompt,
        notes: shot.notes ?? '',
        agentOsShotId: shot.id,
      };

      let yNode = nodes.get(nodeId);
      if (!(yNode instanceof Y.Map)) {
        yNode = new Y.Map<unknown>();
        nodes.set(nodeId, yNode);
        yNode.set('id', nodeId);
        yNode.set('type', SHOT_NODE_TYPE);
        const pos = new Y.Map<number>();
        pos.set('x', nextX);
        pos.set('y', nextY);
        yNode.set('position', pos);
        nextX += SHOT_NODE_WIDTH + SHOT_STRIP_GAP;
        const order = orderAfter(orderCursor);
        orderCursor = order;
        const data = new Y.Map<unknown>();
        data.set('order', order);
        for (const [k, v] of Object.entries(patch)) data.set(k, v);
        yNode.set('data', data);
      } else {
        let dataY = yNode.get('data');
        if (!(dataY instanceof Y.Map)) {
          dataY = new Y.Map<unknown>();
          yNode.set('data', dataY);
        }
        for (const [k, v] of Object.entries(patch)) {
          (dataY as Y.Map<unknown>).set(k, v);
        }
      }
      written.push({ id: shot.id, title: shot.title, nodeId });
    }

    return written;
  }
}

function toShotNodeId(shotId: string): string {
  return shotId.startsWith('agent-os:shot:')
    ? shotId
    : `agent-os:shot:${shotId}`;
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
