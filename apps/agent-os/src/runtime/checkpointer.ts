import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let singleton: BaseCheckpointSaver | null = null;
let setupPromise: Promise<void> | null = null;

/**
 * Prefer Postgres checkpoints when AGENT_OS_CHECKPOINT_DATABASE_URL (or
 * DATABASE_URL) is set; otherwise MemorySaver for unit tests / offline.
 */
export async function getAgentOsCheckpointer(): Promise<BaseCheckpointSaver> {
  if (singleton) return singleton;

  const conn =
    process.env.AGENT_OS_CHECKPOINT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

  if (!conn) {
    singleton = new MemorySaver();
    return singleton;
  }

  const schema = process.env.AGENT_OS_CHECKPOINT_SCHEMA?.trim() || "agent_os";
  const saver = PostgresSaver.fromConnString(conn, { schema });
  if (!setupPromise) {
    setupPromise = saver.setup();
  }
  await setupPromise;
  singleton = saver;
  return singleton;
}

export function resetAgentOsCheckpointerForTests(): void {
  singleton = null;
  setupPromise = null;
}
