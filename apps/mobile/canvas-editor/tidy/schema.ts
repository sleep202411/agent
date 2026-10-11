import { z } from "zod";
const finite = z.number().finite();
export const canvasTidyRequestSchema = z
  .object({
    nodes: z.array(
      z
        .object({
          id: z.string().min(1),
          width: finite.positive(),
          height: finite.positive(),
          position: z.object({ x: finite, y: finite }).strict(),
        })
        .strict()
    ),
    edges: z.array(
      z
        .object({ id: z.string().min(1), source: z.string().min(1), target: z.string().min(1) })
        .strict()
    ),
    direction: z.enum(["RIGHT", "DOWN", "LEFT", "UP"]),
    nodeSpacing: finite.positive(),
    layerSpacing: finite.positive(),
    componentSpacing: finite.positive(),
    componentAspectRatio: finite.positive(),
    lanes: z.array(
      z
        .object({
          id: z.string().min(1),
          side: z.enum(["left", "right", "above", "below"]),
          nodeIds: z.array(z.string().min(1)),
          gap: finite.positive(),
          nodeGap: finite.positive(),
        })
        .strict()
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.nodes.map((node) => node.id));
    const edgeIds = new Set(value.edges.map((edge) => edge.id));
    const assigned = new Set<string>();
    if (
      ids.size !== value.nodes.length ||
      edgeIds.size !== value.edges.length ||
      value.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))
    )
      ctx.addIssue({ code: "custom", message: "Canvas layout identities are invalid." });
    for (const lane of value.lanes)
      for (const id of lane.nodeIds) {
        if (!ids.has(id) || assigned.has(id))
          ctx.addIssue({ code: "custom", message: "Canvas layout lane membership is invalid." });
        assigned.add(id);
      }
  });
export type CanvasTidyLayoutRequest = z.infer<typeof canvasTidyRequestSchema>;
export type CanvasTidyLayoutNode = CanvasTidyLayoutRequest["nodes"][number];
export type CanvasTidyLayoutLane = CanvasTidyLayoutRequest["lanes"][number];
export type CanvasTidyPosition = { id: string; position: { x: number; y: number } };
