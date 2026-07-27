import { z } from 'zod';

/**
 * Story Studio owns this document. It deliberately mirrors the canvas
 * capability's plain graph contract without borrowing Creative Studio's
 * PlatformProject/PlatformDocument identity.
 */
export const STORY_PRODUCTION_CANVAS_SCHEMA_VERSION =
  'story-production-canvas-v2' as const;

export const STORY_PRODUCTION_CANVAS_NODE_COUNT_MAX = 2_000;
export const STORY_PRODUCTION_CANVAS_EDGE_COUNT_MAX = 4_000;
export const STORY_PRODUCTION_CANVAS_ASSET_COUNT_MAX = 4_000;
export const STORY_PRODUCTION_CANVAS_GROUP_COUNT_MAX = 2_000;
const COORDINATE_ABS_MAX = 1_000_000;

const CanvasEntityIdSchema = z.string().trim().min(1).max(160);
const CanvasCoordinateSchema = z
  .number()
  .finite()
  .min(-COORDINATE_ABS_MAX)
  .max(COORDINATE_ABS_MAX);
const OptionalDimensionSchema = z
  .number()
  .finite()
  .positive()
  .max(COORDINATE_ABS_MAX)
  .optional();

export const StoryProductionCanvasNodeSchema = z
  .object({
    id: CanvasEntityIdSchema,
    type: z.enum([
      'image',
      'panorama',
      'note',
      'videoAsset',
      'audioAsset',
      'prompt',
      'video',
    ]),
    position: z
      .object({
        x: CanvasCoordinateSchema,
        y: CanvasCoordinateSchema,
      })
      .strict(),
    data: z.record(z.string().max(120), z.unknown()),
    width: OptionalDimensionSchema,
    height: OptionalDimensionSchema,
  })
  .strict();

export const StoryProductionCanvasEdgeSchema = z
  .object({
    id: CanvasEntityIdSchema,
    source: CanvasEntityIdSchema,
    target: CanvasEntityIdSchema,
    sourceHandle: z.string().max(120).nullable().optional(),
    targetHandle: z.string().max(120).nullable().optional(),
  })
  .strict();

export const StoryProductionCanvasAssetSchema = z
  .object({
    id: CanvasEntityIdSchema,
    mediaAssetId: z.string().uuid().optional(),
    kind: z.enum(['image', 'video', 'audio']),
    source: z.enum(['generated', 'uploaded']),
    url: z.string().trim().min(1).max(2_048),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    name: z.string().trim().max(255).optional(),
    prompt: z.string().max(20_000).optional(),
    panorama: z.boolean().optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const STORY_PRODUCTION_CANVAS_GROUP_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'cyan',
  'blue',
  'indigo',
  'pink',
] as const;

export const DEFAULT_STORY_PRODUCTION_CANVAS_GROUP_COLOR = 'slate' as const;

/** Editable group. Bounds are derived from members; membership and the palette token persist. */
export const StoryProductionCanvasGroupSchema = z
  .object({
    id: CanvasEntityIdSchema,
    nodeIds: z
      .array(CanvasEntityIdSchema)
      .min(2)
      .max(STORY_PRODUCTION_CANVAS_NODE_COUNT_MAX),
    color: z
      .enum(STORY_PRODUCTION_CANVAS_GROUP_COLORS)
      .default(DEFAULT_STORY_PRODUCTION_CANVAS_GROUP_COLOR),
  })
  .strict();

export const StoryProductionCanvasContentSchema = z
  .object({
    nodes: z
      .array(StoryProductionCanvasNodeSchema)
      .max(STORY_PRODUCTION_CANVAS_NODE_COUNT_MAX),
    edges: z
      .array(StoryProductionCanvasEdgeSchema)
      .max(STORY_PRODUCTION_CANVAS_EDGE_COUNT_MAX),
    assets: z
      .array(StoryProductionCanvasAssetSchema)
      .max(STORY_PRODUCTION_CANVAS_ASSET_COUNT_MAX),
    groups: z
      .array(StoryProductionCanvasGroupSchema)
      .max(STORY_PRODUCTION_CANVAS_GROUP_COUNT_MAX),
  })
  .strict()
  .superRefine((content, context) => {
    const nodeIds = new Set<string>();
    content.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'id'],
          message: `Duplicate canvas node id ${node.id}.`,
        });
      }
      nodeIds.add(node.id);
    });

    const edgeIds = new Set<string>();
    content.edges.forEach((edge, index) => {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index, 'id'],
          message: `Duplicate canvas edge id ${edge.id}.`,
        });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: 'Canvas edges must connect existing nodes.',
        });
      }
    });

    const assetIds = new Set<string>();
    content.assets.forEach((asset, index) => {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'id'],
          message: `Duplicate canvas asset id ${asset.id}.`,
        });
      }
      assetIds.add(asset.id);
    });

    const groupIds = new Set<string>();
    const groupedNodeIds = new Set<string>();
    content.groups.forEach((group, groupIndex) => {
      if (groupIds.has(group.id)) {
        context.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'id'],
          message: `Duplicate production group id ${group.id}.`,
        });
      }
      groupIds.add(group.id);

      const memberIds = new Set<string>();
      group.nodeIds.forEach((nodeId, nodeIndex) => {
        if (memberIds.has(nodeId)) {
          context.addIssue({
            code: 'custom',
            path: ['groups', groupIndex, 'nodeIds', nodeIndex],
            message: `Duplicate node ${nodeId} in production group ${group.id}.`,
          });
        }
        memberIds.add(nodeId);
        if (!nodeIds.has(nodeId)) {
          context.addIssue({
            code: 'custom',
            path: ['groups', groupIndex, 'nodeIds', nodeIndex],
            message: `Production group ${group.id} references a missing node.`,
          });
        }
        if (groupedNodeIds.has(nodeId)) {
          context.addIssue({
            code: 'custom',
            path: ['groups', groupIndex, 'nodeIds', nodeIndex],
            message: `Canvas node ${nodeId} cannot belong to multiple production groups.`,
          });
        }
        groupedNodeIds.add(nodeId);
      });
    });
  });

export type StoryProductionCanvasContent = z.infer<
  typeof StoryProductionCanvasContentSchema
>;

export const EMPTY_STORY_PRODUCTION_CANVAS_CONTENT = {
  nodes: [],
  edges: [],
  assets: [],
  groups: [],
} satisfies StoryProductionCanvasContent;
