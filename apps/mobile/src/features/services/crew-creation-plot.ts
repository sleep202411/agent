// Native validation mirrors the official Crew plot-tree import contract.
import { z } from "zod";

export const PlotTreeTransitionSchema = z.object({
  to: z.string().trim().min(1),
  label: z.string().default(""),
  condition: z.string().optional(),
});

export const PlotTreeNodeTypeSchema = z.enum(["scene", "choice", "ending"]);

export const PlotTreeNodeSchema = z.object({
  id: z.string().trim().min(1),
  type: PlotTreeNodeTypeSchema,
  content: z.record(z.unknown()).default({}),
  transitions: z.array(PlotTreeTransitionSchema).default([]),
});

export const PlotTreeSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().default(""),
    startNodeId: z.string().trim().min(1),
    nodes: z.array(PlotTreeNodeSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const nodeMap = new Map<string, z.infer<typeof PlotTreeNodeSchema>>();
    let hasEnding = false;

    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i];
      if (nodeMap.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node ID must be unique: ${node.id}`,
          path: ["nodes", i, "id"],
        });
      }
      nodeMap.set(node.id, node);

      if (node.type === "ending") {
        hasEnding = true;
      }
      if (node.type === "choice" && node.transitions.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choice nodes must have at least 2 transitions",
          path: ["nodes", i, "transitions"],
        });
      }
      if (node.type === "scene" && node.transitions.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Scene nodes must have at least 1 transition",
          path: ["nodes", i, "transitions"],
        });
      }
    }

    if (!nodeMap.has(data.startNodeId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startNodeId must exist in nodes",
        path: ["startNodeId"],
      });
    }

    if (!hasEnding) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Plot tree must have at least one ending node",
        path: ["nodes"],
      });
    }

    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i];
      for (let j = 0; j < node.transitions.length; j++) {
        const target = node.transitions[j].to;
        if (!nodeMap.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Transition target does not exist: ${target}`,
            path: ["nodes", i, "transitions", j, "to"],
          });
        }
      }
    }

    if (nodeMap.has(data.startNodeId)) {
      const visited = new Set<string>();
      const queue: string[] = [data.startNodeId];
      visited.add(data.startNodeId);

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentNode = nodeMap.get(currentId);
        if (currentNode && currentNode.transitions) {
          for (const t of currentNode.transitions) {
            if (nodeMap.has(t.to) && !visited.has(t.to)) {
              visited.add(t.to);
              queue.push(t.to);
            }
          }
        }
      }

      for (let i = 0; i < data.nodes.length; i++) {
        const node = data.nodes[i];
        if (!visited.has(node.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Node is unreachable from startNodeId: ${node.id}`,
            path: ["nodes", i],
          });
        }
      }
    }
  });
