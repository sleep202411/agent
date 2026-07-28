/**
 * The provider-facing name of a capability, derived from its id.
 *
 * A capability id is ours (`story.canvas.apply_patch`); a provider tool name has
 * to satisfy the model APIs, which accept a narrow character set and a length
 * bound. The digest is what keeps the mapping injective after the readable half
 * has been truncated and had its punctuation flattened — two capabilities that
 * collapse to the same readable prefix still get different names.
 *
 * NOT EXPORTED FROM THE BARREL, DELIBERATELY. `packages/shared` is bundled into
 * the browser and has no `node:` imports anywhere else; this module has one, so
 * it is reachable only through the `@repo/shared/studio-agent-tools` subpath and
 * only from Node. The browser never derives a tool name — the server projects
 * `toolName` onto `StudioAgentAction`, so there is exactly one implementation of
 * this rule and the browser reads its output rather than recomputing it.
 */

import { createHash } from "node:crypto";

export function studioAgentProviderToolName(capabilityId: string): string {
  const readable = capabilityId.replace(/[^a-z0-9_]/g, "_").slice(0, 47);
  const digest = createHash("sha256").update(capabilityId).digest("hex").slice(0, 12);
  return `cap_${readable}_${digest}`;
}
