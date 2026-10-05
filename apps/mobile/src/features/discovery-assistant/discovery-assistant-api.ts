import { z } from "zod";
import {
  DiscoveryAssistantRequestSchema,
  DiscoveryAssistantReceiptSchema,
  type DiscoveryAssistantRequest,
  type DiscoveryAssistantReceipt,
} from "@repo/shared/discovery-assistant";
import { getAuthGeneration } from "@/auth/auth-store";
import { api, ApiRequestError } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
export type AssistantRequest = DiscoveryAssistantRequest;
export type AssistantReceipt = DiscoveryAssistantReceipt;
export type AssistantScope = {
  userId: string;
  generation: number;
  locale: AssistantRequest["locale"];
  kind: AssistantRequest["conversation"]["current"]["kind"];
};
const path = "/content-gps/discovery/requests";
const command = z
  .object({
    clientKey: z.string().uuid(),
    request: z.unknown().transform((v) => DiscoveryAssistantRequestSchema.parse(v)),
  })
  .refine((v) => v.clientKey === v.request.requestId);
function current(scope: AssistantScope, signal?: AbortSignal) {
  if (!scope.userId || scope.generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Discovery conversation session expired.");
}
function scoped(scope: AssistantScope, input: AssistantRequest) {
  const next = DiscoveryAssistantRequestSchema.parse(input);
  if (next.locale !== scope.locale || next.conversation.current.kind !== scope.kind)
    throw new Error("Discovery request scope does not match.");
  return next;
}
export function discoveryPending(scope: AssistantScope) {
  current(scope);
  const store = pendingRequest(
    command,
    scope.generation,
    durableRecord("discovery-assistant", scope.userId, `${scope.locale}:${scope.kind}`)
  );
  return {
    read: () => {
      const value = store.read();
      if (value) scoped(scope, value.request);
      return value?.request ?? null;
    },
    save: (request: AssistantRequest) =>
      store.save({ clientKey: request.requestId, request: scoped(scope, request) }),
    clear: (id: string) => store.clear(id),
  };
}
/** Explicit recovery after hydration failed. Preserve any now-readable pending request. */
export function recoverDiscoveryStorage(scope: AssistantScope): AssistantRequest | null {
  current(scope);
  const storage = durableRecord(
    "discovery-assistant",
    scope.userId,
    `${scope.locale}:${scope.kind}`
  );
  // Storage access failures must propagate; they are not evidence of corrupt data.
  const raw = storage.read();
  let request: AssistantRequest | null = null;
  if (raw !== null) {
    try {
      const record = z
        .object({ version: z.literal(1), intent: command.nullable() })
        .parse(JSON.parse(raw));
      request = record.intent?.request ?? null;
    } catch {
      // Only an explicit confirmed recovery may replace an unreadable record.
    }
  }
  current(scope);
  if (request) return scoped(scope, request);
  if (!request) storage.write(JSON.stringify({ version: 1, intent: null }));
  return request;
}
function receipt(scope: AssistantScope, expected: AssistantRequest, raw: unknown) {
  const value = DiscoveryAssistantReceiptSchema.safeParse(raw);
  if (
    !value.success ||
    value.data.requestId !== expected.requestId ||
    (value.data.result?.status === "results" &&
      (value.data.result.kind !== scope.kind ||
        (value.data.result.kind === "ips" && value.data.result.query.locale !== scope.locale)))
  )
    throw new Error("The reply does not match this request. Check its status again.");
  const result = value.data.result;
  if (result?.status === "results" && result.kind === "creators")
    return {
      ...value.data,
      result: {
        ...result,
        cards: result.cards.map((c) => (c.showOnMap ? c : { ...c, basedIn: null, point: null })),
      },
    };
  return value.data;
}
function stored(scope: AssistantScope, request: AssistantRequest) {
  current(scope);
  const value = discoveryPending(scope).read();
  if (!value || JSON.stringify(value) !== JSON.stringify(scoped(scope, request)))
    throw new Error("The saved discovery request changed. Reopen the conversation.");
}
export async function checkDiscovery(
  scope: AssistantScope,
  request: AssistantRequest,
  signal: AbortSignal
) {
  current(scope, signal);
  stored(scope, request);
  const raw = await api.get(`${path}/${request.requestId}`, {
    service: "aurora",
    signal,
    retry: false,
    timeout: 60000,
  });
  current(scope, signal);
  stored(scope, request);
  return receipt(scope, request, raw);
}
async function dispatch(scope: AssistantScope, request: AssistantRequest, signal: AbortSignal) {
  current(scope, signal);
  stored(scope, request);
  const raw = await api.post(path, {
    service: "aurora",
    signal,
    retry: false,
    timeout: 60000,
    data: request,
  });
  current(scope, signal);
  stored(scope, request);
  return receipt(scope, request, raw);
}
/** New turns can replace only an acknowledged succeeded/cancelled request. */
export async function sendDiscovery(
  scope: AssistantScope,
  input: AssistantRequest,
  signal: AbortSignal
) {
  current(scope, signal);
  const request = scoped(scope, input),
    store = discoveryPending(scope),
    old = store.read();
  if (old) {
    if (old.requestId === request.requestId)
      throw new Error("Check the saved request before retrying it.");
    const previous = await checkDiscovery(scope, old, signal);
    if (!["succeeded", "cancelled"].includes(previous.status))
      throw new Error(
        "The previous request is unresolved. Check it or explicitly start a new conversation."
      );
    store.clear(old.requestId);
  }
  current(scope, signal);
  store.save(request);
  return dispatch(scope, request, signal);
}
/** A read-confirmed missing receipt permits an explicit replay of the same exact request. */
export async function retryDiscovery(
  scope: AssistantScope,
  request: AssistantRequest,
  signal: AbortSignal
) {
  try {
    return await checkDiscovery(scope, request, signal);
  } catch (e) {
    if (!(e instanceof ApiRequestError && e.status === 404)) throw e;
  }
  current(scope, signal);
  return dispatch(scope, request, signal);
}
export async function cancelDiscovery(
  scope: AssistantScope,
  request: AssistantRequest,
  signal: AbortSignal
) {
  current(scope, signal);
  stored(scope, request);
  const raw = await api.post(`${path}/${request.requestId}/cancel`, {
    service: "aurora",
    signal,
    retry: false,
    timeout: 60000,
    data: {},
  });
  current(scope, signal);
  stored(scope, request);
  return receipt(scope, request, raw);
}
/** Called only after explicit new-conversation confirmation; never cancels remote work. */
export function clearDiscovery(
  scope: AssistantScope,
  request: AssistantRequest,
  acknowledged: AssistantReceipt
) {
  current(scope);
  stored(scope, request);
  const checked = receipt(scope, request, acknowledged);
  if (checked.status === "dispatched")
    throw new Error("Check the existing request before starting a new conversation.");
  discoveryPending(scope).clear(request.requestId);
}
