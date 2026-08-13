"use client";

import Link from "next/link";
import { IconArrowUpRight } from "@tabler/icons-react";

/**
 * "Show me what you just wrote."
 *
 * A write the user cannot find is barely a write: the agent reports an id in
 * prose and the node is somewhere on a board that may be hundreds of nodes
 * wide. The canvas already answers `?focus=<nodeId>`; this just gives the
 * transcript a way to point at it.
 *
 * The ids come from the tool RESULT, not from the assistant's prose — the model
 * may phrase its summary any way it likes, but the write itself is factual.
 */
export type WrittenNode = { nodeId: string; label: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Canvas nodes a completed tool call created or changed. */
export function writtenNodesFromResult(toolId: string, result: unknown): WrittenNode[] {
  const payload = asRecord(result);

  if (toolId === "storyboard.upsertShots") {
    const written = Array.isArray(payload.written) ? payload.written : [];
    return written
      .map((raw) => {
        const row = asRecord(raw);
        const nodeId = str(row.nodeId);
        return nodeId ? { nodeId, label: str(row.title) || str(row.id) } : null;
      })
      .filter((row): row is WrittenNode => row !== null);
  }

  if (toolId === "canvas.applyPatch") {
    const nodeIds = Array.isArray(payload.nodeIds) ? payload.nodeIds : [];
    return nodeIds
      .map((raw) => str(raw))
      .filter(Boolean)
      .map((nodeId) => ({ nodeId, label: shortNodeLabel(nodeId) }));
  }

  return [];
}

/** Agent-authored ids carry a namespace the user never typed — drop it. */
function shortNodeLabel(nodeId: string): string {
  const bare = nodeId.replace(/^agent-os:shot:/, "");
  return bare.length > 28 ? `${bare.slice(0, 27)}…` : bare;
}

export function WrittenNodes({
  projectId,
  sectionId,
  nodes,
  label,
}: {
  projectId: string;
  sectionId?: string;
  nodes: readonly WrittenNode[];
  /** e.g. "Show on canvas" */
  label: string;
}) {
  if (nodes.length === 0) return null;
  const sectionQuery = sectionId ? `section=${encodeURIComponent(sectionId)}&` : "";
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1">
      <span className="text-[10px] text-white/35">{label}</span>
      {nodes.slice(0, 8).map((node) => (
        <Link
          key={node.nodeId}
          href={`/project/${projectId}/canvas?${sectionQuery}focus=${encodeURIComponent(node.nodeId)}`}
          className="inline-flex items-center gap-0.5 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
        >
          {node.label}
          <IconArrowUpRight className="size-3" stroke={1.8} />
        </Link>
      ))}
      {nodes.length > 8 ? (
        <span className="text-[10px] text-white/30">+{nodes.length - 8}</span>
      ) : null}
    </div>
  );
}
