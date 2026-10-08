import { z } from 'zod';
import { CrewTaskKind } from '@prisma/client';

export type TaskCategory = 'creative' | 'production';

export const DeliveryFieldTypeSchema = z.enum([
  'document_or_link',
  'image',
  'music_asset',
  'music_final',
  'video_with_subtitle',
  'video_without_subtitle',
  'audio_track',
  'raw_image_assets',
  'raw_video_assets',
  'final_video',
  'cost_sheet',
  'review_sheet',
  'client_signoff',
  'prompt_or_script',
]);

export type DeliveryFieldType =
  | 'document_or_link' // 附件文稿或者链接
  | 'image' // 图片
  | 'music_asset' // 音乐素材
  | 'music_final' // 音乐最终成品/音乐素材
  | 'video_with_subtitle' // 有字幕视频
  | 'video_without_subtitle' // 无字幕视频
  | 'audio_track' // 音轨
  | 'raw_image_assets' // 图片素材
  | 'raw_video_assets' // 视频素材
  | 'final_video' // 最终完结视频
  | 'cost_sheet' // 成本估算excel
  | 'review_sheet' // 人员评价表
  | 'client_signoff' // 客户确认验收附件
  | 'prompt_or_script'; // 备用

export interface DeliveryField {
  type: DeliveryFieldType;
  required: boolean;
}

export interface TaskQualification {
  pdLevel?: 'PD' | 'FD'; // Historical saved templates only.
  fdRank?: 1 | 2 | 3 | 4 | 5;
  certification?: string; // 编剧 / 美术 / 音乐 / 剪辑 / 认证AI制片人
}

export interface TaskPriceRange {
  min: number;
  max?: number;
  unit?: 'percent'; // 分润 case
}

export interface TaskTemplateItem {
  templateKey: string;
  title: string;
  category: TaskCategory;
  roleRequirement: string;
  qualification?: TaskQualification;
  deliveryFields: DeliveryField[];
  unit: string; // 字 / 剧 / 张 / 分钟 / 项目
  priceRange?: TaskPriceRange;
  defaultDependencies: string[];
  taskKind: CrewTaskKind;
  priority: 'normal' | 'urgent' | 'critical';
  requiresPlotTree: boolean;
  deliveryCategoryKey?: string;
}

export interface TaskTemplateDefinition {
  version: number;
  items: TaskTemplateItem[];
}

export const DEFAULT_SERIES_TASK_TEMPLATE: TaskTemplateDefinition = {
  version: 1,
  items: [
    // ---- Creative development ----
    {
      templateKey: 'script',
      title: '剧本',
      category: 'creative',
      roleRequirement: '剧本',
      qualification: { certification: '编剧' },
      deliveryFields: [{ type: 'document_or_link', required: true }],
      unit: '1000字',
      priceRange: { min: 150, max: 300 },
      defaultDependencies: [],
      taskKind: CrewTaskKind.script,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'gameplay',
      title: '游戏玩法',
      category: 'creative',
      roleRequirement: '游戏策划（如果是影游）',
      deliveryFields: [{ type: 'document_or_link', required: true }],
      unit: '',
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.gameplay,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'character_art',
      title: '人物美术设定',
      category: 'creative',
      roleRequirement: '美术设定-角色',
      qualification: { fdRank: 1, certification: '美术' },
      deliveryFields: [{ type: 'image', required: true }],
      unit: '张',
      priceRange: { min: 10 },
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.art,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'scene_art',
      title: '场景美术设定',
      category: 'creative',
      roleRequirement: '美术设定-场景',
      qualification: { fdRank: 1, certification: '美术' },
      deliveryFields: [{ type: 'image', required: true }],
      unit: '张',
      priceRange: { min: 10 },
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.art,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'music_package',
      title: '音乐包',
      category: 'creative',
      roleRequirement: '主题音乐素材包',
      qualification: { certification: '音乐' },
      deliveryFields: [
        { type: 'music_final', required: true },
        { type: 'music_asset', required: true },
      ],
      unit: '剧',
      priceRange: { min: 300 },
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.music,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'music_final',
      title: '音乐',
      category: 'creative',
      roleRequirement: '音乐-影视（AI素材收）',
      deliveryFields: [{ type: 'music_final', required: true }],
      unit: '',
      defaultDependencies: ['music_package'],
      taskKind: CrewTaskKind.music,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'director',
      title: '导演统筹管理对接',
      category: 'creative',
      roleRequirement: '导演',
      qualification: { fdRank: 2, certification: '认证AI制片人' },
      deliveryFields: [
        { type: 'client_signoff', required: true },
        { type: 'cost_sheet', required: true },
        { type: 'review_sheet', required: true },
      ],
      unit: '项目',
      priceRange: { min: 10, unit: 'percent' },
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.other,
      priority: 'normal',
      requiresPlotTree: false,
    },
    // ---- Production ----
    {
      templateKey: 'assembly_base',
      title: '剧集成片',
      category: 'production',
      roleRequirement: '基础成片',
      qualification: { fdRank: 1 },
      deliveryFields: [
        { type: 'video_with_subtitle', required: true },
        { type: 'video_without_subtitle', required: true },
        { type: 'audio_track', required: true },
        { type: 'raw_image_assets', required: true },
        { type: 'raw_video_assets', required: true },
      ],
      unit: '条',
      priceRange: { min: 8 },
      defaultDependencies: ['character_art', 'scene_art', 'music_final'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'assembly_fine_cut',
      title: '单独做剧（已经提供美术）-短剧FD2-内部',
      category: 'production',
      roleRequirement: '单独做剧（已经提供美术）',
      qualification: { fdRank: 2 },
      deliveryFields: [
        { type: 'video_with_subtitle', required: true },
        { type: 'video_without_subtitle', required: true },
        { type: 'audio_track', required: true },
        { type: 'raw_image_assets', required: true },
        { type: 'raw_video_assets', required: true },
      ],
      unit: '分钟',
      priceRange: { min: 120 },
      defaultDependencies: ['character_art', 'scene_art'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'assembly_standalone',
      title: '单独做剧（已经提供美术）-短剧FD3-内部',
      category: 'production',
      roleRequirement: '单独做剧（已经提供美术）',
      qualification: { fdRank: 3 },
      deliveryFields: [{ type: 'final_video', required: true }],
      unit: '分钟',
      priceRange: { min: 150 },
      defaultDependencies: ['character_art', 'scene_art'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'poster_ai',
      title: 'AI海报-内部',
      category: 'production',
      roleRequirement: 'AI海报-内部',
      qualification: { fdRank: 1, certification: '美术' },
      deliveryFields: [{ type: 'image', required: true }],
      unit: '张',
      priceRange: { min: 25 },
      defaultDependencies: ['character_art'],
      taskKind: CrewTaskKind.art,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'edit_internal',
      title: '剪辑和后期-内',
      category: 'production',
      roleRequirement: '剪辑和后期-内',
      qualification: { fdRank: 1, certification: '剪辑' },
      deliveryFields: [{ type: 'final_video', required: true }],
      unit: '分钟',
      priceRange: { min: 60 },
      defaultDependencies: ['assembly_standalone'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
    },
  ],
};

export type PlotTreeNodeType = 'scene' | 'choice' | 'ending';

export interface PlotTreeTransition {
  to: string;
  label: string;
  condition?: string;
}

export interface PlotTreeNode {
  id: string;
  type: PlotTreeNodeType;
  content: Record<string, unknown>;
  transitions: PlotTreeTransition[];
}

export interface PlotTree {
  title: string;
  description?: string;
  startNodeId: string;
  nodes: PlotTreeNode[];
}

export interface PlotTreeImportSummary {
  templateId: string;
  nodeCount: number;
  choiceCount: number;
  endingCount: number;
}

export const PlotTreeTransitionSchema = z.object({
  to: z.string().trim().min(1),
  label: z.string().default(''),
  condition: z.string().optional(),
});

export const PlotTreeNodeTypeSchema = z.enum(['scene', 'choice', 'ending']);

export const PlotTreeNodeSchema = z.object({
  id: z.string().trim().min(1),
  type: PlotTreeNodeTypeSchema,
  content: z.record(z.string(), z.unknown()).default({}),
  transitions: z.array(PlotTreeTransitionSchema).default([]),
});

export const PlotTreeSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().default(''),
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
          path: ['nodes', i, 'id'],
        });
      }
      nodeMap.set(node.id, node);

      if (node.type === 'ending') {
        hasEnding = true;
      }
      if (node.type === 'choice' && node.transitions.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Choice nodes must have at least 2 transitions',
          path: ['nodes', i, 'transitions'],
        });
      }
      if (node.type === 'scene' && node.transitions.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Scene nodes must have at least 1 transition',
          path: ['nodes', i, 'transitions'],
        });
      }
    }

    if (!nodeMap.has(data.startNodeId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startNodeId must exist in nodes',
        path: ['startNodeId'],
      });
    }

    if (!hasEnding) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Plot tree must have at least one ending node',
        path: ['nodes'],
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
            path: ['nodes', i, 'transitions', j, 'to'],
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
            path: ['nodes', i],
          });
        }
      }
    }
  });

export type PlotTreeImportInput = z.infer<typeof PlotTreeSchema>;

export const DEFAULT_INTERACTIVE_FILM_TASK_TEMPLATE: TaskTemplateDefinition = {
  version: 1,
  items: [
    {
      templateKey: 'script',
      deliveryCategoryKey: 'script_delivery',
      title: '剧本与分支设定',
      category: 'creative',
      roleRequirement: '编剧',
      qualification: { certification: '编剧' },
      deliveryFields: [{ type: 'document_or_link', required: true }],
      unit: '1000字',
      priceRange: { min: 150, max: 300 },
      defaultDependencies: [],
      taskKind: CrewTaskKind.script,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'plot_tree',
      title: '故事剧情树构建',
      category: 'creative',
      roleRequirement: '游戏策划/互动编剧',
      deliveryFields: [{ type: 'document_or_link', required: true }],
      unit: '分支点',
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.plot_tree,
      priority: 'normal',
      requiresPlotTree: true,
    },
    {
      templateKey: 'character_art',
      deliveryCategoryKey: 'character_art_delivery',
      title: '互动人物设定',
      category: 'creative',
      roleRequirement: '美术设定-角色',
      qualification: { fdRank: 1, certification: '美术' },
      deliveryFields: [{ type: 'image', required: true }],
      unit: '张',
      priceRange: { min: 15 },
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.art,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'scene_art',
      deliveryCategoryKey: 'scene_art_delivery',
      title: '场景分支概念图',
      category: 'creative',
      roleRequirement: '美术设定-场景',
      qualification: { fdRank: 1, certification: '美术' },
      deliveryFields: [{ type: 'image', required: true }],
      unit: '张',
      priceRange: { min: 15 },
      defaultDependencies: ['script'],
      taskKind: CrewTaskKind.art,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'storyboard',
      deliveryCategoryKey: 'storyboard_delivery',
      title: '互动分镜设计',
      category: 'creative',
      roleRequirement: '互动分镜师',
      deliveryFields: [{ type: 'raw_image_assets', required: true }],
      unit: '镜',
      defaultDependencies: ['plot_tree', 'character_art', 'scene_art'],
      taskKind: CrewTaskKind.storyboard,
      priority: 'normal',
      requiresPlotTree: true,
    },
    {
      templateKey: 'assembly',
      deliveryCategoryKey: 'assembly_delivery',
      title: '互动引擎集成与剪辑',
      category: 'production',
      roleRequirement: '互动视频剪辑与打包',
      qualification: { fdRank: 2 },
      deliveryFields: [
        { type: 'final_video', required: true },
        { type: 'video_with_subtitle', required: true },
        { type: 'raw_video_assets', required: true },
      ],
      unit: '分钟',
      priceRange: { min: 120 },
      defaultDependencies: ['storyboard'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: true,
    },
    {
      templateKey: 'qa',
      deliveryCategoryKey: 'qa_delivery',
      title: '互动体验与全分支测试',
      category: 'production',
      roleRequirement: 'QA测试',
      deliveryFields: [{ type: 'review_sheet', required: true }],
      unit: '项目',
      defaultDependencies: ['assembly'],
      taskKind: CrewTaskKind.qa,
      priority: 'normal',
      requiresPlotTree: true,
    },
  ],
};
