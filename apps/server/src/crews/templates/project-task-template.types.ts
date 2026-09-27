import { CrewProductionKind, CrewTaskKind } from '@prisma/client';

export interface TaskTemplateItem {
  templateKey: string;
  title: string;
  taskKind: CrewTaskKind;
  priority: 'normal' | 'urgent' | 'critical';
  requiresPlotTree: boolean;
  defaultDependencies: string[];
}

export interface TaskTemplateDefinition {
  items: TaskTemplateItem[];
}

export const DEFAULT_SERIES_TASK_TEMPLATE: TaskTemplateDefinition = {
  items: [
    {
      templateKey: 'script',
      title: '剧本',
      taskKind: CrewTaskKind.script,
      priority: 'normal',
      requiresPlotTree: false,
      defaultDependencies: [],
    },
    {
      templateKey: 'assets',
      title: '美术资产',
      taskKind: CrewTaskKind.art,
      priority: 'normal',
      requiresPlotTree: false,
      defaultDependencies: ['script'],
    },
    {
      templateKey: 'boards',
      title: '分镜',
      taskKind: CrewTaskKind.storyboard,
      priority: 'normal',
      requiresPlotTree: false,
      defaultDependencies: ['script'],
    },
    {
      templateKey: 'video',
      title: '视频生成',
      taskKind: CrewTaskKind.other,
      priority: 'normal',
      requiresPlotTree: false,
      defaultDependencies: ['boards'],
    },
    {
      templateKey: 'audio',
      title: '配音',
      taskKind: CrewTaskKind.voice,
      priority: 'normal',
      requiresPlotTree: false,
      defaultDependencies: ['script'],
    },
    {
      templateKey: 'assembly',
      title: '剪辑合成',
      taskKind: CrewTaskKind.edit,
      priority: 'normal',
      requiresPlotTree: false,
      defaultDependencies: ['video', 'audio'],
    },
  ],
};
