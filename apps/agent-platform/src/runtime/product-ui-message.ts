import { TransformStream } from "node:stream/web";

import type { MastraStreamTransform } from "@mastra/core/stream";
import type { UIMessage } from "ai";

/**
 * Mastra's Observational Memory emits `data-om-*` events for framework-owned
 * memory diagnostics and optional framework UI. They are not part of
 * FizzDragon's public Agent Platform protocol.
 *
 * Keeping this rule at the platform boundary prevents a Mastra upgrade from
 * silently expanding the product wire contract and also repairs historical
 * rows written before this boundary existed.
 */
const MASTRA_INTERNAL_DATA_PART_PREFIX = "data-om-";

export function projectProductUiMessages(messages: ReadonlyArray<UIMessage>): UIMessage[] {
  return messages.flatMap((message) => {
    const parts = message.parts.filter(isProductUiPart);
    if (parts.length === 0) return [];
    const metadata = productMetadata(message.metadata);
    if (parts.length === message.parts.length && metadata === message.metadata) return [message];
    return [{ ...message, parts, metadata }];
  });
}

export const stripMastraInternalUiEvents: MastraStreamTransform = () =>
  new TransformStream({
    transform(chunk, controller) {
      if (isMastraInternalPartType(chunk.type)) return;
      controller.enqueue(chunk);
    },
  });

function isProductUiPart(part: UIMessage["parts"][number]): boolean {
  return !isMastraInternalPartType(part.type);
}

function isMastraInternalPartType(type: string): boolean {
  return type.startsWith(MASTRA_INTERNAL_DATA_PART_PREFIX);
}

function productMetadata(metadata: UIMessage["metadata"]): UIMessage["metadata"] {
  if (!isRecord(metadata) || !Object.hasOwn(metadata, "mastra")) return metadata;
  const product = { ...metadata };
  delete product.mastra;
  return Object.keys(product).length > 0 ? product : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
