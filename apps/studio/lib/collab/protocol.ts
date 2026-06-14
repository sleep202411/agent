import * as Y from "yjs";

/**
 * Client-side wire contract for the FizzDragon documents collaboration gateway
 * (`/aurora/ws/documents`). This is a PRODUCT-level JSON frame protocol
 * (`{ event, data }`), NOT the raw y-websocket binary protocol — so we ship our
 * own Yjs provider (document-provider.ts) rather than `y-websocket`.
 *
 * Pure helpers only (frame types, base64 codec, root-type declaration); no
 * browser globals, so this module is safe to import anywhere.
 */

export type RootTypeKind = "map" | "array" | "text" | "xml";
export type RootSchema = Readonly<Record<string, RootTypeKind>>;

/** Canvas document root types — MUST match the server's rootSchemaFor('canvas'). */
export const CANVAS_ROOT_SCHEMA: RootSchema = {
  meta: "map",
  nodes: "map",
  edges: "map",
  // The project's asset library (generated + uploaded media), synced so every
  // collaborator shares one library. Keyed by asset id.
  assets: "map",
};

/** Text document root types (e.g. the Brief mode) — MUST match the server's rootSchemaFor('brief'). */
export const TEXT_DOC_ROOT_SCHEMA: RootSchema = {
  meta: "map",
  content: "text",
};

/** An operation as returned by the server (operationDto). */
export interface OperationDto {
  id: string;
  documentId: string;
  sequence: number;
  operationType: "patch" | "yjs_update" | "snapshot" | "comment" | "system";
  actorUserId?: string;
  clientMutationId?: string;
  baseSequence?: number | null;
  yjsUpdateBase64?: string;
  metadata?: unknown;
  createdAt?: string;
}

/** The document detail DTO carried in `document_snapshot`. */
export interface DocumentSnapshotDto {
  id: string;
  type: string;
  currentSequence: number;
  snapshotSequence: number;
  crdtStateBase64?: string;
  title?: string;
}

/** Frames the server sends to the client. */
export type ServerFrame =
  | { event: "document_snapshot"; data: { socketId: string; document: DocumentSnapshotDto } }
  | {
      event: "operations_sync";
      data: { afterSequence: number; operations: OperationDto[]; resync?: boolean };
    }
  | { event: "operation_ack"; data: { operation: OperationDto } }
  | { event: "document_operation"; data: OperationDto }
  | { event: "awareness"; data: { update: string } }
  | { event: "awareness_state"; data: { update: string } }
  | { event: "awareness_request"; data: Record<string, never> }
  | { event: "app_event"; data: unknown }
  | { event: "presence_state"; data: unknown }
  | { event: "presence_update"; data: unknown }
  | { event: "presence_left"; data: unknown }
  | { event: "heartbeat"; data: { serverTime: number } }
  | { event: "error"; data: { code: string; message: string; detail?: unknown } }
  | { event: "terminate"; data: { reason: string; code: number } };

/** Frames the client sends to the server. */
export type ClientFrame =
  | { event: "ping" }
  | { event: "sync_request"; data: { afterSequence?: number; limit?: number } }
  | {
      event: "operation";
      data: {
        operationType: "yjs_update";
        yjsUpdateBase64: string;
        clientMutationId?: string;
        idempotencyKey?: string;
      };
    }
  | { event: "awareness"; data: { update: string } }
  | { event: "app_event"; data: unknown };

/** Declare a document's root shared types so the doc materializes correctly. */
export function declareRoots(doc: Y.Doc, schema: RootSchema): void {
  for (const [name, kind] of Object.entries(schema)) {
    switch (kind) {
      case "map":
        doc.getMap(name);
        break;
      case "array":
        doc.getArray(name);
        break;
      case "text":
        doc.getText(name);
        break;
      case "xml":
        doc.getXmlFragment(name);
        break;
    }
  }
}

/** A Yjs update with no content (just the 2-byte header). */
export const EMPTY_UPDATE_MAX_BYTES = 2;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function newClientMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cm-${Math.floor(performance.now())}-${Math.round(Math.random() * 1e9)}`;
}
