import Ably from "ably";

type ConnectableAgentSession = Readonly<{
  connect(): Promise<void>;
}>;

type AgentAblyClientFactory = (apiKey: string) => Ably.Realtime;

const createRealtimeClient: AgentAblyClientFactory = (apiKey) =>
  new Ably.Realtime({
    key: apiKey,
    autoConnect: false,
    echoMessages: false,
    clientId: "fizzdragon-agent-platform",
  });

/**
 * A Temporal worker executes many short Activities. Recreating a Realtime
 * client for every Activity repeats DNS, TLS, authentication, and connection
 * establishment before every model or tool step. One worker-scoped client is
 * safe across Ably channels and lets the SDK own reconnect/resume semantics.
 *
 * Failed and explicitly closed clients are never reused. A changed credential
 * also rotates the client without exposing the credential in logs or metrics.
 */
export class AgentAblyClientPool {
  #entry: Readonly<{ apiKey: string; client: Ably.Realtime }> | undefined;

  constructor(private readonly createClient: AgentAblyClientFactory = createRealtimeClient) {}

  acquire(apiKey: string): Ably.Realtime {
    const current = this.#entry;
    if (
      current &&
      current.apiKey === apiKey &&
      current.client.connection.state !== "failed" &&
      current.client.connection.state !== "closing" &&
      current.client.connection.state !== "closed"
    ) {
      return current.client;
    }

    current?.client.close();
    const client = this.createClient(apiKey);
    this.#entry = { apiKey, client };
    return client;
  }

  close(): void {
    const current = this.#entry;
    this.#entry = undefined;
    current?.client.close();
  }
}

/**
 * Wire-message limit per Ably channel-history round trip for worker sessions.
 *
 * AI Transport's default (100) over-provisions for client rendering, where one
 * fetch should cover a screen of conversation. A worker Activity's hot path
 * needs only the newest few wires — the trigger plus the run lifecycle events —
 * and every deeper need (suspended-run adoption) is driven explicitly to its
 * run boundary in activities.ts. History fetch time is dominated by response
 * payload, not round trips, and the newest wires of a long conversation carry
 * whole assistant messages, so the full-size default made `ably.run.locate`
 * and `ably.run.load` grow with conversation length (measured 1.2-2.0s per
 * fetch on a 90+ message thread). A quarter-size page keeps the hot path to
 * one small fetch; boundary-driven walks pay extra round trips only when the
 * adopted run genuinely extends deeper.
 */
export const AGENT_HISTORY_PAGE_SIZE = 25;

const workerClientPool = new AgentAblyClientPool();

export function acquireAgentAblyClient(apiKey: string): Ably.Realtime {
  return workerClientPool.acquire(apiKey);
}

export function closeAgentAblyClientPool(): void {
  workerClientPool.close();
}

/**
 * Open the underlying Realtime connection before asking AI Transport to attach
 * its channel. Ably deliberately stays in `initialized` when `autoConnect` is
 * disabled; `session.connect()` attaches the channel but does not start that
 * client connection for us.
 */
export async function connectAgentSession(
  client: Pick<Ably.Realtime, "connect">,
  session: ConnectableAgentSession
): Promise<void> {
  client.connect();
  await session.connect();
}

export async function releaseAgentSession(session: { detach(): Promise<void> }): Promise<void> {
  await session.detach();
}
