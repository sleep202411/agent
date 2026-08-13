/**
 * Copilot tool definitions (server-declared, CLIENT-executed).
 *
 * Each tool has an `inputSchema` + `outputSchema` but NO `execute` — per the
 * AI SDK v6 contract, omitting `execute` forwards the tool call to the browser,
 * where `useChat`'s `onToolCall` runs it against the live Yjs canvas graph and
 * reports back via `addToolOutput`. The server never touches the graph.
 *
 * P2a = read + safe writes (no confirmation needed). P2b adds connect_nodes /
 * run_generation (spending) + remove_* (destructive) behind `needsApproval`.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

export const canvasTools = {
  query_graph: tool({
    description:
      'Read the current canvas. Returns the list of nodes (id, type, label/prompt) so you can plan edits or answer questions about what already exists. Call this before editing or selecting existing nodes.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      nodes: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          label: z.string().optional(),
        }),
      ),
    }),
  }),

  add_node: tool({
    description:
      'Add a node to the canvas. kind "image" creates an image-generation card, "video" a video-generation card, "note" a sticky note, "shot" a storyboard shot (a numbered row of the project storyboard; seed its line of dialogue with `prompt` and its name with `label`). Optionally seed a prompt, a modelId (omit to use the studio default), and a short label. Returns the new node id. This does NOT run generation — it only creates the card.',
    inputSchema: z.object({
      kind: z.enum(['image', 'video', 'note', 'shot']),
      prompt: z.string().optional(),
      modelId: z.string().optional(),
      label: z.string().optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      nodeId: z.string().optional(),
      error: z.string().optional(),
    }),
  }),

  edit_node_params: tool({
    description:
      "Edit an existing node's prompt and/or model. Use a nodeId from query_graph. Returns ok or an error if the node no longer exists.",
    inputSchema: z.object({
      nodeId: z.string(),
      prompt: z.string().optional(),
      modelId: z.string().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
  }),

  select: tool({
    description:
      'Select/focus nodes on the canvas by id (highlights them for the user).',
    inputSchema: z.object({ nodeIds: z.array(z.string()) }),
    outputSchema: z.object({ ok: z.boolean() }),
  }),

  connect_nodes: tool({
    description:
      "Wire one node's output into another node as a reference (e.g. feed an image card into a video card). source = the node producing the output, target = the generation card receiving it. Only generation cards (image/video) can be targets, and the target model must accept the source's kind. Returns an error if the connection is invalid.",
    inputSchema: z.object({ sourceId: z.string(), targetId: z.string() }),
    outputSchema: z.object({
      ok: z.boolean(),
      edgeId: z.string().optional(),
      error: z.string().optional(),
    }),
  }),

  run_generation: tool({
    description:
      'Run the AI generation for an image/video card (by nodeId). This SPENDS the workspace compute credits — the user will be asked to confirm before it runs. The node must have a resolved model and (for most models) a non-empty prompt. Results stream back onto the card asynchronously.',
    inputSchema: z.object({ nodeId: z.string() }),
    outputSchema: z.object({
      ok: z.boolean(),
      declined: z.boolean().optional(),
      error: z.string().optional(),
    }),
  }),

  cancel_generation: tool({
    description: 'Cancel an in-flight generation for a card (by nodeId).',
    inputSchema: z.object({ nodeId: z.string() }),
    outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
  }),

  remove_node: tool({
    description:
      'Delete a node from the canvas (by nodeId). Destructive — the user will be asked to confirm.',
    inputSchema: z.object({ nodeId: z.string() }),
    outputSchema: z.object({
      ok: z.boolean(),
      declined: z.boolean().optional(),
      error: z.string().optional(),
    }),
  }),

  remove_edge: tool({
    description:
      'Delete a connection/wire from the canvas (by edgeId). Destructive — the user will be asked to confirm.',
    inputSchema: z.object({ edgeId: z.string() }),
    outputSchema: z.object({
      ok: z.boolean(),
      declined: z.boolean().optional(),
      error: z.string().optional(),
    }),
  }),
} satisfies ToolSet;

export type CanvasToolName = keyof typeof canvasTools;
