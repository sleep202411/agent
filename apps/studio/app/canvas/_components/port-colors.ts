/**
 * Port/edge colors encode the data TYPE a connector carries (text / image /
 * video / audio). This is functional information, not decoration — the same
 * exception DESIGN.md grants chart colors. Surfaces stay monochrome; only
 * connectors (handles, their labels, and the edges between them) carry type
 * color.
 */
export const PORT_COLOR = {
  text: "#5b9dff", // text / prompt ports
  image: "#e0a45c", // image ports
  video: "#E52227", // video ports (brand red)
  audio: "#b48cff", // audio ports
} as const;

export type PortDataType = keyof typeof PORT_COLOR;

const NEUTRAL = "rgb(255 255 255 / 0.5)";

/** Color for a known data type (used by reference input ports, keyed by kind). */
export function colorForType(type: PortDataType | undefined): string {
  return type ? PORT_COLOR[type] : NEUTRAL;
}

const HANDLE_TYPE: Record<string, PortDataType> = {
  text: "text",
  prompt: "text",
  image: "image",
  reference: "image",
  video: "video",
  audio: "audio",
};

export function handleColor(handleId: string | null | undefined): string {
  if (!handleId) return NEUTRAL;
  return colorForType(HANDLE_TYPE[handleId]);
}
