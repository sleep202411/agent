"use client";

import { Handle, Position } from "@xyflow/react";
import { colorForType, handleColor, type PortDataType } from "./port-colors";

/**
 * A typed connection port with its label floating outside the node card
 * (imagine.art pattern). The parent node root must be `relative`.
 *
 * The Handle itself is a 24px transparent hit target (easy to grab); the
 * visible 12px dot is an inner element centered inside it. Color encodes
 * data type (see port-colors). Source ports render filled, target ports
 * render as a hollow ring.
 */
export function Port({
  type,
  id,
  side,
  top,
  label,
  dataType,
  required = false,
}: {
  type: "source" | "target";
  id: string;
  side: "left" | "right";
  top: number;
  label: string;
  /** Override the id-based color (reference input ports color by media kind). */
  dataType?: PortDataType;
  required?: boolean;
}) {
  const color = dataType ? colorForType(dataType) : handleColor(id);
  return (
    <>
      <Handle
        type={type}
        id={id}
        position={side === "left" ? Position.Left : Position.Right}
        style={{ top, width: 24, height: 24, background: "transparent", border: "none" }}
        className="!flex !items-center !justify-center"
      >
        <span
          className="pointer-events-none block size-3 rounded-full border-2"
          style={{
            borderColor: color,
            background: type === "source" ? color : "var(--background)",
          }}
        />
      </Handle>
      <span
        className="pointer-events-none absolute text-xs whitespace-nowrap"
        style={{
          top: top - 8,
          color,
          [side === "left" ? "right" : "left"]: "100%",
          margin: "0 10px",
        }}
      >
        {label}
        {required && <span> *</span>}
      </span>
    </>
  );
}
