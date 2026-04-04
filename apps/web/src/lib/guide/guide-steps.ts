export type GuideId = "storyboard" | "timeline" | "script" | "projects";

export interface GuideStep {
  element: string;
  title: string;
  description: string;
  side?: "top" | "bottom" | "left" | "right";
}

export const guideSteps: Record<GuideId, GuideStep[]> = {
  storyboard: [
    {
      element: '[data-tour-step="tabs"]',
      title: "工作区切换",
      description: "在剧本、分镜表和时间线之间切换不同的创作视图",
      side: "bottom",
    },
    {
      element: '[data-tour-step="storyboard-table"]',
      title: "分镜表",
      description: "核心创作区，每一行是一个镜头。填写画面描述后可以 AI 生图、生视频",
      side: "top",
    },
    {
      element: '[data-tour-step="ai-assistant"]',
      title: "AI 助手",
      description: "让 AI 帮你拆剧本、设计分镜、分析资产，一键完成繁琐的创作工作",
      side: "right",
    },
    {
      element: '[data-tour-step="sidebar"]',
      title: "资产管理",
      description: "管理项目中的角色、场景和道具，AI 生图时会自动引用这些资产",
      side: "right",
    },
    {
      element: '[data-tour-step="credits"]',
      title: "积分",
      description: "AI 功能消耗积分，点击查看使用记录或充值",
      side: "bottom",
    },
    {
      element: '[data-tour-step="upgrade"]',
      title: "升级套餐",
      description: "解锁更多 AI 创作能力和专属权益",
      side: "bottom",
    },
  ],
  timeline: [
    {
      element: '[data-tour-step="timeline-preview"]',
      title: "视频预览",
      description: "播放分镜动画预览，查看整体效果",
      side: "bottom",
    },
    {
      element: '[data-tour-step="timeline-ruler"]',
      title: "时间轴",
      description: "时间刻度尺，点击可跳转到对应时间点",
      side: "bottom",
    },
    {
      element: '[data-tour-step="timeline-track"]',
      title: "镜头轨道",
      description: "拖拽镜头卡片排序，拖拽右边缘调整时长",
      side: "top",
    },
  ],
  script: [],
  projects: [],
};
