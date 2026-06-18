"use client";

import { Handle, Position } from "@xyflow/react";
import { IconPlus } from "@tabler/icons-react";
import { colorForType, type PortDataType } from "./port-colors";

/**
 * A single "+" connection port centered on the card's left or right edge — the
 * card-level input (target) / output (source). Drag from it to wire nodes.
 *
 * `dataType` tints the connector by the data TYPE it carries (image/video/…) —
 * functional color sanctioned by DESIGN.md (only connectors carry type color).
 * Output ports pass their node's output kind so the typed graph reads at a
 * glance; the shared multi-type input port stays neutral.
 */
export function PortPlus({
  type,
  id,
  side,
  dataType,
}: {
  type: "source" | "target";
  id: string;
  side: "left" | "right";
  dataType?: PortDataType;
}) {
  const color = dataType ? colorForType(dataType) : undefined;
  return (
    <Handle
      type={type}
      id={id}
      position={side === "left" ? Position.Left : Position.Right}
      style={{
        top: "50%",
        width: 26,
        height: 26,
        ...(color ? { boxShadow: `0 0 0 1.5px ${color}` } : {}),
      }}
      className="!flex !items-center !justify-center !rounded-full !border-0 !bg-[oklch(0.3_0_0)] !text-white/60 shadow-md transition-colors hover:!bg-[oklch(0.4_0_0)] hover:!text-white"
    >
      <IconPlus
        className="pointer-events-none size-4"
        stroke={2.2}
        style={color ? { color } : undefined}
      />
    </Handle>
  );
}
