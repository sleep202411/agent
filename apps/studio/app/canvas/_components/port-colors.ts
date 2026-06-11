/**
 * Port/edge colors encode the data TYPE a connector carries (text / image /
 * video). This is functional information, not decoration — the same exception
 * DESIGN.md grants chart colors. Surfaces stay monochrome; only connectors
 * (handles, their labels, and the edges between them) carry type color.
 */
export const PORT_COLOR = {
  text: "#5b9dff", // text / prompt ports
  image: "#e0a45c", // image ports
  video: "#5dd6a0", // video ports
} as const;

export type PortDataType = keyof typeof PORT_COLOR;

const HANDLE_TYPE: Record<string, PortDataType> = {
  text: "text",
  prompt: "text",
  image: "image",
  reference: "image",
  video: "video",
};

const NEUTRAL = "rgb(255 255 255 / 0.5)";

export function handleColor(handleId: string | null | undefined): string {
  if (!handleId) return NEUTRAL;
  const type = HANDLE_TYPE[handleId];
  return type ? PORT_COLOR[type] : NEUTRAL;
}
