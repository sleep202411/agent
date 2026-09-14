import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const CREW_PRODUCTION_TEMPLATE_VERSION = 4;

export type CrewProductionTemplateLocale = 'en-US' | 'zh-CN' | 'zh-HK';

const TEMPLATE_COPY: Record<
  CrewProductionTemplateLocale,
  {
    goal: string;
    goalPrompt: string;
    plan: string;
    episodeTitle: string;
    episodeSynopsis: string;
    episodeTable: {
      number: string;
      title: string;
      status: string;
      tasks: string;
      delivery: string;
      planned: string;
      noDelivery: string;
    };
    delivery: string;
    deliveryItems: string[];
    risks: string;
    risksPrompt: string;
  }
> = {
  'en-US': {
    goal: 'Production goal',
    goalPrompt:
      'Describe the finished work, its audience, and what success looks like.',
    plan: 'Episode plan',
    episodeTitle: 'Episode 1',
    episodeSynopsis:
      'Define the story goal, audience promise, and episode outcome.',
    episodeTable: {
      number: 'Episode',
      title: 'Title',
      status: 'Status',
      tasks: 'Tasks',
      delivery: 'Latest delivery',
      planned: 'Planned',
      noDelivery: 'No delivery',
    },
    delivery: 'Delivery standard',
    deliveryItems: [
      'Define format, resolution, aspect ratio, and duration',
      'Define review owners and acceptance criteria',
      'Define file naming and storage conventions',
    ],
    risks: 'Risks and decisions',
    risksPrompt:
      'Record current risks, open questions, and decisions awaiting confirmation.',
  },
  'zh-CN': {
    goal: '制作目标',
    goalPrompt: '描述最终要交付的作品、目标受众，以及判断项目成功的标准。',
    plan: '剧集计划',
    episodeTitle: '第 1 集',
    episodeSynopsis: '明确本集的故事目标、受众承诺与最终结果。',
    episodeTable: {
      number: '集数',
      title: '标题',
      status: '状态',
      tasks: '任务',
      delivery: '最新交付',
      planned: '计划中',
      noDelivery: '暂无交付',
    },
    delivery: '交付标准',
    deliveryItems: [
      '明确格式、分辨率、画幅与时长',
      '明确审核负责人和验收标准',
      '明确文件命名与存储规范',
    ],
    risks: '风险与待确认事项',
    risksPrompt: '记录当前风险、尚未解决的问题，以及等待确认的决策。',
  },
  'zh-HK': {
    goal: '製作目標',
    goalPrompt: '描述最終要交付的作品、目標受眾，以及判斷項目成功的標準。',
    plan: '劇集計劃',
    episodeTitle: '第 1 集',
    episodeSynopsis: '明確本集的故事目標、受眾承諾與最終成果。',
    episodeTable: {
      number: '集數',
      title: '標題',
      status: '狀態',
      tasks: '任務',
      delivery: '最新交付',
      planned: '計劃中',
      noDelivery: '暫無交付',
    },
    delivery: '交付標準',
    deliveryItems: [
      '明確格式、解像度、畫幅與時長',
      '明確審核負責人和驗收標準',
      '明確檔案命名與儲存規範',
    ],
    risks: '風險與待確認事項',
    risksPrompt: '記錄目前風險、尚未解決的問題，以及等待確認的決策。',
  },
};

/**
 * Canonical, immediately usable production-home template. Domain entities
 * still live outside this rich-text document; the template contains only
 * portable editor nodes and becomes ordinary crew-owned content after create.
 */
export function createDefaultProductionDocument(
  locale: CrewProductionTemplateLocale = 'en-US',
): Prisma.InputJsonObject {
  const copy = TEMPLATE_COPY[locale];
  return {
    type: 'doc',
    content: [
      heading(copy.goal),
      paragraph(copy.goalPrompt),
      heading(copy.plan),
      table(
        [
          copy.episodeTable.number,
          copy.episodeTable.title,
          copy.episodeTable.status,
          copy.episodeTable.tasks,
          copy.episodeTable.delivery,
        ],
        [
          '1',
          copy.episodeTitle,
          copy.episodeTable.planned,
          '0',
          copy.episodeTable.noDelivery,
        ],
      ),
      heading(copy.delivery),
      bulletList(copy.deliveryItems),
      heading(copy.risks),
      paragraph(copy.risksPrompt),
    ],
  };
}

export function createDefaultProductionPlan(
  locale: CrewProductionTemplateLocale = 'en-US',
) {
  const copy = TEMPLATE_COPY[locale];
  return {
    episode: {
      title: copy.episodeTitle,
      synopsis: copy.episodeSynopsis,
    },
  };
}

function heading(text: string): Prisma.InputJsonObject {
  return {
    type: 'heading',
    attrs: { id: randomUUID(), level: 2 },
    content: [{ type: 'text', text }],
  };
}

function paragraph(text: string): Prisma.InputJsonObject {
  return {
    type: 'paragraph',
    attrs: { id: randomUUID() },
    content: [{ type: 'text', text }],
  };
}

function table(headers: string[], row: string[]): Prisma.InputJsonObject {
  return {
    type: 'table',
    attrs: { id: randomUUID() },
    content: [
      {
        type: 'tableRow',
        content: headers.map((value) => tableCell(value, true)),
      },
      {
        type: 'tableRow',
        content: row.map((value) => tableCell(value, false)),
      },
    ],
  };
}

function tableCell(text: string, header: boolean): Prisma.InputJsonObject {
  return {
    type: header ? 'tableHeader' : 'tableCell',
    content: [paragraph(text)],
  };
}

function bulletList(items: string[]): Prisma.InputJsonObject {
  return {
    type: 'bulletList',
    attrs: { id: randomUUID() },
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraph(item)],
    })),
  };
}
