import { randomUUID } from 'node:crypto';
import {
  CrewAssetNodeKind,
  CrewProductionKind,
  CrewTaskKind,
  CrewTaskStatus,
  Prisma,
} from '@prisma/client';

export type ProductionLocale = 'en-US' | 'zh-CN' | 'zh-HK';

type FolderSeed = {
  key: string;
  names: Record<ProductionLocale, string>;
  children?: FolderSeed[];
};

type TaskSeed = {
  key: string;
  kind: CrewTaskKind;
  titles: Record<ProductionLocale, string>;
};

const SHARED_FOLDERS: FolderSeed[] = [
  {
    key: 'script',
    names: { 'en-US': 'Script', 'zh-CN': '剧本', 'zh-HK': '劇本' },
  },
  {
    key: 'art',
    names: {
      'en-US': 'Art',
      'zh-CN': '美术资源',
      'zh-HK': '美術資源',
    },
    children: [
      {
        key: 'art.characters',
        names: { 'en-US': 'Characters', 'zh-CN': '角色', 'zh-HK': '角色' },
      },
      {
        key: 'art.scenes',
        names: { 'en-US': 'Scenes', 'zh-CN': '场景', 'zh-HK': '場景' },
      },
      {
        key: 'art.props',
        names: { 'en-US': 'Props', 'zh-CN': '道具', 'zh-HK': '道具' },
      },
    ],
  },
  {
    key: 'music',
    names: { 'en-US': 'Music', 'zh-CN': '音乐', 'zh-HK': '音樂' },
    children: [
      {
        key: 'music.bgm',
        names: {
          'en-US': 'Background music',
          'zh-CN': '背景音乐',
          'zh-HK': '背景音樂',
        },
      },
      {
        key: 'music.voices',
        names: {
          'en-US': 'Character voices',
          'zh-CN': '人物音色',
          'zh-HK': '人物音色',
        },
      },
    ],
  },
  {
    key: 'video',
    names: { 'en-US': 'Video', 'zh-CN': '视频', 'zh-HK': '影片' },
    children: [
      {
        key: 'video.rough',
        names: {
          'en-US': 'Rough cut',
          'zh-CN': '粗剪视频',
          'zh-HK': '粗剪影片',
        },
      },
      {
        key: 'video.fine',
        names: {
          'en-US': 'Fine cut',
          'zh-CN': '精剪视频',
          'zh-HK': '精剪影片',
        },
      },
      {
        key: 'video.subtitled',
        names: {
          'en-US': 'Subtitled',
          'zh-CN': '有字幕视频',
          'zh-HK': '有字幕影片',
        },
      },
    ],
  },
];

const INTERACTIVE_EXTRA_FOLDERS: FolderSeed[] = [
  {
    key: 'plot_tree',
    names: {
      'en-US': 'Plot tree',
      'zh-CN': '情节树参考',
      'zh-HK': '情節樹參考',
    },
  },
  {
    key: 'playtest',
    names: { 'en-US': 'Playtest', 'zh-CN': '试玩包', 'zh-HK': '試玩包' },
  },
];

const SERIES_EXTRA_FOLDERS: FolderSeed[] = [
  {
    key: 'video.final',
    names: { 'en-US': 'Final', 'zh-CN': '成片', 'zh-HK': '成片' },
  },
];

const INTERACTIVE_TASKS: TaskSeed[] = [
  {
    key: 'script',
    kind: CrewTaskKind.script,
    titles: { 'en-US': 'Script', 'zh-CN': '剧本', 'zh-HK': '劇本' },
  },
  {
    key: 'gameplay',
    kind: CrewTaskKind.gameplay,
    titles: {
      'en-US': 'Gameplay design',
      'zh-CN': '游戏玩法设计',
      'zh-HK': '遊戲玩法設計',
    },
  },
  {
    key: 'plot_tree',
    kind: CrewTaskKind.plot_tree,
    titles: { 'en-US': 'Plot tree', 'zh-CN': '情节树', 'zh-HK': '情節樹' },
  },
  {
    key: 'assets',
    kind: CrewTaskKind.art,
    titles: {
      'en-US': 'Assets (characters / scenes / voice / music)',
      'zh-CN': '资产（角色 / 场景 / 配音 / 音乐）',
      'zh-HK': '資產（角色 / 場景 / 配音 / 音樂）',
    },
  },
  {
    key: 'storyboard',
    kind: CrewTaskKind.storyboard,
    titles: { 'en-US': 'Storyboard', 'zh-CN': '分镜', 'zh-HK': '分鏡' },
  },
  {
    key: 'edit',
    kind: CrewTaskKind.edit,
    titles: {
      'en-US': 'Gamified assembly',
      'zh-CN': '游戏化组装（剪辑）',
      'zh-HK': '遊戲化組裝（剪輯）',
    },
  },
  {
    key: 'qa',
    kind: CrewTaskKind.qa,
    titles: {
      'en-US': 'Global QA + playtest',
      'zh-CN': '全局校验 + 试玩',
      'zh-HK': '全局校驗 + 試玩',
    },
  },
];

const SERIES_TASKS: TaskSeed[] = [
  {
    key: 'script',
    kind: CrewTaskKind.script,
    titles: { 'en-US': 'Script', 'zh-CN': '剧本', 'zh-HK': '劇本' },
  },
  {
    key: 'storyboard',
    kind: CrewTaskKind.storyboard,
    titles: { 'en-US': 'Storyboard', 'zh-CN': '分镜', 'zh-HK': '分鏡' },
  },
  {
    key: 'art',
    kind: CrewTaskKind.art,
    titles: { 'en-US': 'Art assets', 'zh-CN': '美术资产', 'zh-HK': '美術資產' },
  },
  {
    key: 'voice',
    kind: CrewTaskKind.voice,
    titles: {
      'en-US': 'Voice / music',
      'zh-CN': '配音 / 音乐',
      'zh-HK': '配音 / 音樂',
    },
  },
  {
    key: 'rough',
    kind: CrewTaskKind.edit,
    titles: { 'en-US': 'Rough cut', 'zh-CN': '粗剪', 'zh-HK': '粗剪' },
  },
  {
    key: 'fine',
    kind: CrewTaskKind.edit,
    titles: { 'en-US': 'Fine cut', 'zh-CN': '精剪', 'zh-HK': '精剪' },
  },
  {
    key: 'subtitles',
    kind: CrewTaskKind.edit,
    titles: { 'en-US': 'Subtitles', 'zh-CN': '字幕', 'zh-HK': '字幕' },
  },
  {
    key: 'qa',
    kind: CrewTaskKind.qa,
    titles: {
      'en-US': 'Final review',
      'zh-CN': '成片校验',
      'zh-HK': '成片校驗',
    },
  },
];

export function productionFolderTree(kind: CrewProductionKind): FolderSeed[] {
  if (kind === CrewProductionKind.interactive_film) {
    return [...SHARED_FOLDERS, ...INTERACTIVE_EXTRA_FOLDERS];
  }
  const video = SHARED_FOLDERS.find((folder) => folder.key === 'video');
  return SHARED_FOLDERS.map((folder) =>
    folder.key === 'video'
      ? {
          ...folder,
          children: [...(video?.children ?? []), ...SERIES_EXTRA_FOLDERS],
        }
      : folder,
  );
}

export function productionTaskPipeline(kind: CrewProductionKind): TaskSeed[] {
  return kind === CrewProductionKind.interactive_film
    ? INTERACTIVE_TASKS
    : SERIES_TASKS;
}

export async function seedCrewProductionFolders(
  tx: Prisma.TransactionClient,
  input: {
    crewId: string;
    userId: string;
    kind: CrewProductionKind;
    locale: ProductionLocale;
  },
) {
  const existing = await tx.crewAssetNode.count({
    where: { crewId: input.crewId, folderKey: { not: null } },
  });
  if (existing > 0) return;

  const createLevel = async (
    folders: FolderSeed[],
    parentId: string | null,
  ) => {
    for (const folder of folders) {
      const id = randomUUID();
      await tx.crewAssetNode.create({
        data: {
          id,
          crewId: input.crewId,
          parentId,
          kind: CrewAssetNodeKind.folder,
          folderKey: folder.key,
          name: folder.names[input.locale],
          createdByUserId: input.userId,
          updatedByUserId: input.userId,
        },
      });
      if (folder.children?.length) {
        await createLevel(folder.children, id);
      }
    }
  };

  await createLevel(productionFolderTree(input.kind), null);
}

export async function seedCrewProductionTasks(
  tx: Prisma.TransactionClient,
  input: {
    crewId: string;
    userId: string;
    episodeId: string;
    kind: CrewProductionKind;
    locale: ProductionLocale;
    openWorkflowStateId: string;
  },
) {
  const existing = await tx.crewTask.count({ where: { crewId: input.crewId } });
  if (existing > 0) return;

  const pipeline = productionTaskPipeline(input.kind);
  let previousId: string | null = null;
  let rank = new Prisma.Decimal(1024);
  let number = 1;
  for (const task of pipeline) {
    const id = randomUUID();
    await tx.crewTask.create({
      data: {
        id,
        crewId: input.crewId,
        number,
        title: task.titles[input.locale],
        description: '',
        workflowStateId: input.openWorkflowStateId,
        taskKind: task.kind,
        episodeId: input.episodeId,
        rank,
        createdByUserId: input.userId,
        ...(previousId
          ? {
              dependenciesAsBlocked: {
                create: {
                  blockingTaskId: previousId,
                  createdByUserId: input.userId,
                },
              },
            }
          : {}),
      },
    });
    previousId = id;
    number += 1;
    rank = rank.plus(1024);
  }
}

export function systemTaskKindTemplates(locale: ProductionLocale) {
  const kinds: CrewTaskKind[] = [
    CrewTaskKind.script,
    CrewTaskKind.gameplay,
    CrewTaskKind.plot_tree,
    CrewTaskKind.art,
    CrewTaskKind.storyboard,
    CrewTaskKind.voice,
    CrewTaskKind.music,
    CrewTaskKind.edit,
    CrewTaskKind.qa,
    CrewTaskKind.other,
  ];
  const titles: Record<CrewTaskKind, Record<ProductionLocale, string>> = {
    script: { 'en-US': 'Script', 'zh-CN': '剧本', 'zh-HK': '劇本' },
    gameplay: {
      'en-US': 'Gameplay',
      'zh-CN': '玩法设计',
      'zh-HK': '玩法設計',
    },
    plot_tree: { 'en-US': 'Plot tree', 'zh-CN': '情节树', 'zh-HK': '情節樹' },
    art: { 'en-US': 'Art', 'zh-CN': '美术', 'zh-HK': '美術' },
    storyboard: { 'en-US': 'Storyboard', 'zh-CN': '分镜', 'zh-HK': '分鏡' },
    voice: { 'en-US': 'Voice', 'zh-CN': '配音', 'zh-HK': '配音' },
    music: { 'en-US': 'Music', 'zh-CN': '音乐', 'zh-HK': '音樂' },
    edit: { 'en-US': 'Edit', 'zh-CN': '剪辑', 'zh-HK': '剪輯' },
    qa: { 'en-US': 'QA', 'zh-CN': '校验', 'zh-HK': '校驗' },
    other: { 'en-US': 'Other', 'zh-CN': '其他', 'zh-HK': '其他' },
  };
  return kinds.map((kind) => ({
    kind,
    name: titles[kind][locale],
    title: titles[kind][locale],
  }));
}

export async function seedCrewTaskKindTemplates(
  tx: Prisma.TransactionClient,
  input: {
    crewId: string;
    userId: string;
    locale: ProductionLocale;
  },
) {
  const existing = await tx.crewTaskKindTemplate.count({
    where: { crewId: input.crewId },
  });
  if (existing > 0) return;
  await tx.crewTaskKindTemplate.createMany({
    data: systemTaskKindTemplates(input.locale).map((row) => ({
      crewId: input.crewId,
      kind: row.kind,
      name: row.name,
      title: row.title,
      description: '',
      createdByUserId: input.userId,
    })),
  });
}

export { CrewTaskStatus };
