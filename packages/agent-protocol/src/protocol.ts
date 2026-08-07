import { z } from "zod";

/**
 * Wire protocol version for Agent OS.
 *
 * Literal on purpose — producers and consumers upgrade intentionally.
 */
export const FIZZ_AGENT_PROTOCOL_VERSION = "fizz.agent.v1" as const;

export const FizzAgentProtocolVersionSchema = z.literal(FIZZ_AGENT_PROTOCOL_VERSION);
export type FizzAgentProtocolVersion = z.infer<typeof FizzAgentProtocolVersionSchema>;
