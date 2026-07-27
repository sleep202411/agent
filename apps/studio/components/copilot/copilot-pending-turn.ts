import type { UIMessage } from "ai";

const STORAGE_PREFIX = "fizzdragon:copilot-pending-turn:v1";
const STORAGE_VERSION = 1;
const MAX_RECOVERY_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_RECOVERY_BYTES = 768 * 1_024;

export interface CopilotPendingTurnScope {
  userId: string;
  workspaceId: string;
  projectId: string;
  mode: "canvas" | "story-canvas";
  conversationId: string;
}

export interface CopilotPendingTurn<
  UI_MESSAGE extends UIMessage = UIMessage,
  METADATA = Record<string, never>,
> {
  message: UI_MESSAGE;
  metadata: METADATA;
}

interface StoredPendingTurnEnvelope {
  version: number;
  scope: CopilotPendingTurnScope;
  savedAt: number;
  turn: unknown;
}

/**
 * Session-scoped recovery for a user turn whose server claim is ambiguous.
 *
 * The authenticated user, workspace, project, mode, and canonical conversation
 * are all part of both the key and the validated envelope. `sessionStorage`
 * survives reload/navigation in this tab without leaking a private draft into
 * another browser tab. Callers must provide a strict parser that permits only
 * durable message identities/metadata (never File, blob, data, or signed URLs).
 */
export function readCopilotPendingTurn<UI_MESSAGE extends UIMessage, METADATA>(
  scope: CopilotPendingTurnScope | null,
  parseTurn: (value: unknown) => CopilotPendingTurn<UI_MESSAGE, METADATA> | null
): CopilotPendingTurn<UI_MESSAGE, METADATA> | null {
  const storage = sessionStorageOrNull();
  if (!scope || !storage) return null;
  const key = pendingTurnStorageKey(scope);
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isEnvelopeForScope(parsed, scope)) {
      storage.removeItem(key);
      return null;
    }
    const recoveryAge = Date.now() - parsed.savedAt;
    if (recoveryAge < 0 || recoveryAge > MAX_RECOVERY_AGE_MS) {
      storage.removeItem(key);
      return null;
    }
    const turn = parseTurn(parsed.turn);
    if (!turn) storage.removeItem(key);
    return turn;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Browser storage may be unavailable; recovery remains fail-closed.
    }
    return null;
  }
}

export function writeCopilotPendingTurn<UI_MESSAGE extends UIMessage, METADATA>(
  scope: CopilotPendingTurnScope | null,
  turn: CopilotPendingTurn<UI_MESSAGE, METADATA>
): boolean {
  const storage = sessionStorageOrNull();
  if (!scope || !storage) return false;
  const envelope: StoredPendingTurnEnvelope = {
    version: STORAGE_VERSION,
    scope,
    savedAt: Date.now(),
    turn,
  };
  try {
    const serialized = JSON.stringify(envelope);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RECOVERY_BYTES) return false;
    storage.setItem(pendingTurnStorageKey(scope), serialized);
    return true;
  } catch {
    return false;
  }
}

/** Remove only the expected turn so a late stream cannot erase a newer one. */
export function clearCopilotPendingTurn(
  scope: CopilotPendingTurnScope | null,
  expectedMessageId?: string
): void {
  const storage = sessionStorageOrNull();
  if (!scope || !storage) return;
  const key = pendingTurnStorageKey(scope);
  try {
    if (expectedMessageId) {
      const raw = storage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (
        !isEnvelopeForScope(parsed, scope) ||
        pendingMessageId(parsed.turn) !== expectedMessageId
      ) {
        return;
      }
    }
    storage.removeItem(key);
  } catch {
    // Storage is best-effort UI recovery, never conversation authority.
  }
}

export function pendingTurnStorageKey(scope: CopilotPendingTurnScope): string {
  return [
    STORAGE_PREFIX,
    scope.userId,
    scope.workspaceId,
    scope.mode,
    scope.projectId,
    scope.conversationId,
  ]
    .map(encodeURIComponent)
    .join(":");
}

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isEnvelopeForScope(
  value: unknown,
  scope: CopilotPendingTurnScope
): value is StoredPendingTurnEnvelope {
  if (!isRecord(value) || value.version !== STORAGE_VERSION || !Number.isFinite(value.savedAt)) {
    return false;
  }
  const storedScope = value.scope;
  return (
    isRecord(storedScope) &&
    storedScope.userId === scope.userId &&
    storedScope.workspaceId === scope.workspaceId &&
    storedScope.projectId === scope.projectId &&
    storedScope.mode === scope.mode &&
    storedScope.conversationId === scope.conversationId
  );
}

function pendingMessageId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.message)) return null;
  return typeof value.message.id === "string" ? value.message.id : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
