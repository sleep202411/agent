import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";

const LEGACY_BARE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Story interaction ids are durable graph identifiers, not opaque request ids.
 * Prefixing the UUID keeps every generated value inside StoryStableIdSchema
 * while retaining collision resistance across concurrent authoring sessions.
 */
export function createStoryHotspotId(uuid = globalThis.crypto.randomUUID()): string {
  return `hotspot:${uuid}`;
}

/**
 * Repairs the one invalid shape emitted by the previous editor: a bare UUID.
 * Other malformed ids remain untouched so contract violations still fail loud
 * instead of being silently rewritten into unrelated identities.
 */
export function migrateLegacyStoryHotspotIds(
  content: InteractiveStoryDraftContent
): InteractiveStoryDraftContent {
  let changed = false;
  const nodes = content.graph.nodes.map((node) => {
    if (node.kind !== "clip") return node;
    let nodeChanged = false;
    const interactions = node.interactions.map((interaction) => {
      const id = interaction.interactionId;
      if (!LEGACY_BARE_UUID_PATTERN.test(id)) return interaction;
      changed = true;
      nodeChanged = true;
      return { ...interaction, interactionId: createStoryHotspotId(id) };
    });
    return nodeChanged ? { ...node, interactions } : node;
  });

  return changed ? { ...content, graph: { ...content.graph, nodes } } : content;
}
