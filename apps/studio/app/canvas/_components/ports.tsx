"use client";

import { Handle, Position } from "@xyflow/react";
import { IconPlus } from "@tabler/icons-react";

/**
 * A single "+" connection port centered on the card's left or right edge — the
 * card-level input (target) / output (source). Drag from it to wire nodes.
 */
export function PortPlus({
  type,
  id,
  side,
}: {
  type: "source" | "target";
  id: string;
  side: "left" | "right";
}) {
  return (
    <Handle
      type={type}
      id={id}
      position={side === "left" ? Position.Left : Position.Right}
      style={{ top: "50%", width: 26, height: 26 }}
      className="!flex !items-center !justify-center !rounded-full !border-0 !bg-[oklch(0.3_0_0)] !text-white/60 shadow-md transition-colors hover:!bg-[oklch(0.4_0_0)] hover:!text-white"
    >
      <IconPlus className="pointer-events-none size-4" stroke={2.2} />
    </Handle>
  );
}
