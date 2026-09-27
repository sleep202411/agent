import { CrewTaskKind } from '@prisma/client';

export type TaskCategory = 'creative' | 'production';

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
  pdLevel?: 'PD' | 'FD'; // PD or FD
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
      unit: '100字',
      priceRange: { min: 150 },
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
      qualification: { pdLevel: 'PD', certification: '美术' },
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
      qualification: { pdLevel: 'PD', certification: '美术' },
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
      roleRequirement: '音乐-影视（原创，AI=30%）',
      qualification: { certification: '音乐' },
      deliveryFields: [{ type: 'music_asset', required: true }],
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
      qualification: { certification: '认证AI制片人' },
      deliveryFields: [
        { type: 'client_signoff', required: true },
        { type: 'cost_sheet', required: true },
        { type: 'review_sheet', required: true },
      ],
      unit: '项目',
      priceRange: { min: 0, unit: 'percent' },
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
      qualification: { pdLevel: 'PD' },
      deliveryFields: [
        { type: 'video_with_subtitle', required: true },
        { type: 'video_without_subtitle', required: true },
        { type: 'audio_track', required: true },
        { type: 'raw_image_assets', required: true },
        { type: 'raw_video_assets', required: true },
      ],
      unit: '分钟',
      priceRange: { min: 30 },
      defaultDependencies: ['character_art', 'scene_art', 'music_final'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'assembly_fine_cut',
      title: '剧集-精剪',
      category: 'production',
      roleRequirement: '精剪：基于基础成片进行精剪',
      qualification: { pdLevel: 'PD' },
      deliveryFields: [
        { type: 'video_with_subtitle', required: true },
        { type: 'video_without_subtitle', required: true },
        { type: 'audio_track', required: true },
        { type: 'raw_image_assets', required: true },
        { type: 'raw_video_assets', required: true },
      ],
      unit: '分钟',
      priceRange: { min: 80 },
      defaultDependencies: ['assembly_base'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'assembly_standalone',
      title: '剧集-单独成片',
      category: 'production',
      roleRequirement: '单独成片：基础成片+精剪',
      qualification: { pdLevel: 'PD' },
      deliveryFields: [
        { type: 'video_with_subtitle', required: true },
        { type: 'video_without_subtitle', required: true },
        { type: 'audio_track', required: true },
        { type: 'raw_image_assets', required: true },
        { type: 'raw_video_assets', required: true },
      ],
      unit: '分钟',
      priceRange: { min: 110 },
      defaultDependencies: ['assembly_fine_cut'],
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
    },
    {
      templateKey: 'poster_ai',
      title: 'AI海报-内部',
      category: 'production',
      roleRequirement: 'AI海报-内部',
      qualification: { pdLevel: 'FD', certification: '美术' },
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
      qualification: { pdLevel: 'FD', certification: '剪辑' },
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
