import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LockableInteractiveFilmDraftContentSchema,
  type FilmClipSpec,
  type FilmSpec,
  type InteractiveFilmDraftContent,
} from '../interactive-film.schema';
import { projectStoryFilmRevision } from '../story-film-revision-projector';

const PROMPT_SPEC_PATH = resolve(
  __dirname,
  '../../../../../docs/jinling-rumeng/21-V2-VIDEO-GENERATION-SPEC.md',
);

const CLIP_DURATION_MS = 12_000;
const DEFAULT_LOCALE = 'zh-CN';
const DIRECTOR_PREFIX =
  '真人古装电影质感的《红楼梦》荣国府场景，第一视角亲密感，表演克制，材质、光线和物理动作可信。荣国府使用深木、黛青、月白与旧金，淡红印纹是唯一强色。超自然只通过纸张、水面、灯火、反射和不可能的淡红纹路出现，不使用粒子魔法、仙侠光效或科幻 HUD。玩家永不露脸。全片 16:9、1920×1080、24fps、一镜到底，无剪切、无跳时、无突然变焦，末帧达到稳定态。';

export const JINLING_V2_CLIP_IDS = [
  'p00-ledger-opening',
  's01-gate-arrival',
  's02-corridor-crisis',
  's03-jiamu-reunion',
  's03-xifeng-boundary',
  's04-baoyu-arrival',
  's04-jade-throw',
  's05-daiyu-night-visit',
  's05-letter-reveal',
  'c1-r01-brocade',
  'c1-r02-old-seal',
  'c1-r03-medicine-pouch',
  'c2-r01-protect-daiyu',
  'c2-r02-steady-lantern',
  'c2-r03-protect-letter',
  'c3-r01-catch-jade',
  'c3-r02-shield-daiyu',
  'c3-r03-call-household',
  'c3-r04-observe-pattern',
  'e01-spring-with-daiyu',
  'e02-name-in-house',
  'e03-memory-shared',
  'e04-future-unwritten',
  'w01-identity-wait',
  'w02-corridor-wait',
  'w03-final-choice-wait',
] as const;

export type JinlingV2ClipId = (typeof JINLING_V2_CLIP_IDS)[number];

type Localized = Record<'en-US' | 'zh-CN' | 'zh-HK', string>;
type GraphNode = InteractiveFilmDraftContent['graph']['nodes'][number];

interface ParsedPrompt {
  clipId: JinlingV2ClipId;
  title: string;
  positive: string;
  timeline: string;
  imageSlots: string[];
  audioSlots: string[];
}

export interface JinlingV2ImportBundle {
  draftContent: InteractiveFilmDraftContent;
  filmSpec: FilmSpec;
  clipSpecs: FilmClipSpec[];
  prompts: ParsedPrompt[];
}

const CHOICES = {
  c1: {
    prompt: localized(
      'How will you prove where you came from?',
      '你拿什么证明自己的来处？',
      '你拿甚麼證明自己的來處？',
    ),
    source: 'w01-identity-wait',
    options: [
      option(
        'brocade',
        'Show the old Jiangning brocade fragment',
        '出示江宁织造的旧云锦残片',
        '出示江寧織造的舊雲錦殘片',
        'c1-r01-brocade',
      ),
      option(
        'oldSeal',
        "Show an old friend's private seal",
        '出示故交私印，请门房比对印面',
        '出示故交私印，請門房比對印面',
        'c1-r02-old-seal',
      ),
      option(
        'medicinePouch',
        'Show the medicine pouch and worn prescription',
        '出示随身药囊与那张旧方笺',
        '出示隨身藥囊與那張舊方箋',
        'c1-r03-medicine-pouch',
      ),
    ],
  },
  c2: {
    prompt: localized(
      'The wind reaches her first. What do you protect?',
      '风先扑向了她，你先护住什么？',
      '風先撲向了她，你先護住甚麼？',
    ),
    source: 'w02-corridor-wait',
    options: [
      option(
        'protectDaiyu',
        "Free Daiyu's snagged sleeve",
        '先替黛玉解开被挂住的衣袖',
        '先替黛玉解開被掛住的衣袖',
        'c2-r01-protect-daiyu',
      ),
      option(
        'steadyLantern',
        'Steady the heavy lantern',
        '先稳住那盏沉重的风灯',
        '先穩住那盞沉重的風燈',
        'c2-r02-steady-lantern',
      ),
      option(
        'protectLetter',
        'Shield the letter and crimson seal',
        '先护住荐书与淡红封印',
        '先護住薦書與淡紅封印',
        'c2-r03-protect-letter',
      ),
    ],
  },
  c3: {
    prompt: localized(
      'The whole hall will remember this instant. What do you do?',
      '满堂人都会记住这一瞬，你怎么做？',
      '滿堂人都會記住這一瞬，你怎樣做？',
    ),
    source: 's04-jade-throw',
    options: [
      option(
        'catchJade',
        'Catch the falling jade',
        '接住坠落的通灵玉',
        '接住墜落的通靈玉',
        'c3-r01-catch-jade',
      ),
      option(
        'shieldDaiyu',
        'Step between Daiyu and the jade',
        '挡到黛玉与落玉之间',
        '擋到黛玉與落玉之間',
        'c3-r02-shield-daiyu',
      ),
      option(
        'callHousehold',
        'Call for the household',
        '扬声唤众人接管这一乱',
        '揚聲喚眾人接管這一亂',
        'c3-r03-call-household',
      ),
      option(
        'observePattern',
        'Watch the crimson trace',
        '不出手，只看那道淡红纹',
        '不出手，只看那道淡紅紋',
        'c3-r04-observe-pattern',
      ),
    ],
  },
  c4: {
    prompt: localized(
      'Into whose hands does this unwritten fate go?',
      '这页未写完的命，交到谁手里？',
      '這頁未寫完的命，交到誰手裏？',
    ),
    source: 'w03-final-choice-wait',
    options: [
      option(
        'spring',
        'Live out this spring with Daiyu',
        '与黛玉把这一春过完',
        '與黛玉把這一春過完',
        'e01-spring-with-daiyu',
      ),
      option(
        'name',
        'Ask the house to enter your name',
        '请府中为你立一张名帖',
        '請府中為你立一張名帖',
        'e02-name-in-house',
      ),
      option(
        'memory',
        'Tell her the truth of the wordless ledger',
        '把无字命册的秘密如实相告',
        '把無字命冊的秘密如實相告',
        'e03-memory-shared',
      ),
      option(
        'unwritten',
        'Leave the fate ahead unwritten',
        '让往后的命仍是一页空白',
        '讓往後的命仍是一頁空白',
        'e04-future-unwritten',
      ),
    ],
  },
} as const;

function localized(en: string, cn: string, hk: string): Localized {
  return { 'en-US': en, 'zh-CN': cn, 'zh-HK': hk };
}

function option(
  id: string,
  en: string,
  cn: string,
  hk: string,
  reaction: JinlingV2ClipId,
) {
  return { id, label: localized(en, cn, hk), reaction };
}

export function jinlingClipKey(clipId: JinlingV2ClipId): string {
  return clipId.toUpperCase().replaceAll('-', '_');
}

export function jinlingClipNodeId(clipId: JinlingV2ClipId): string {
  return `clip:${clipId}`;
}

export function buildJinlingV2ImportBundle(
  defaultCanonicalModelId: string,
  markdown = readFileSync(PROMPT_SPEC_PATH, 'utf8'),
): JinlingV2ImportBundle {
  const prompts = JINLING_V2_CLIP_IDS.map((clipId) =>
    parsePrompt(markdown, clipId),
  );
  const promptById = new Map(prompts.map((prompt) => [prompt.clipId, prompt]));
  const nodes = buildGraph();

  const draftContent = LockableInteractiveFilmDraftContentSchema.parse({
    storyBible: buildStoryBible(),
    graph: { entryNodeId: jinlingClipNodeId('p00-ledger-opening'), nodes },
    clipPrompts: JINLING_V2_CLIP_IDS.map((clipId) => {
      const prompt = promptById.get(clipId);
      if (!prompt) throw new Error(`Missing prompt for ${clipId}.`);
      return {
        graphNodeId: jinlingClipNodeId(clipId),
        clipKey: jinlingClipKey(clipId),
        title: prompt.title,
        description: `${prompt.title}（金陵入梦 v2 成片）`,
        targetDurationMs: CLIP_DURATION_MS,
        generationControl: { mode: 'omni_reference' as const },
        masterDirection: `${DIRECTOR_PREFIX}\n\n${prompt.positive}`,
        referenceRoleNotes: [
          ...prompt.imageSlots.map((referenceId, index) => ({
            id: `ref:image:${index + 1}`,
            role: 'omni_reference' as const,
            referenceId,
            note: `生成时的第 ${index + 1} 个图像参考位。`,
          })),
          ...prompt.audioSlots.map((referenceId, index) => ({
            id: `ref:audio:${index + 1}`,
            role: 'other' as const,
            referenceId,
            note: `生成时的第 ${index + 1} 个声纹参考位。`,
          })),
        ],
        emotionalArc: '克制、真实，以细微反应完成叙事推进。',
        beats: [
          {
            id: 'beat:full',
            startMs: 0,
            endMs: CLIP_DURATION_MS,
            visual: prompt.positive,
            camera: '16:9 横屏，第一视角，一镜到底。',
            action: prompt.timeline,
            performance: '自然克制，不做舞台化夸张表演。',
            emotion: '由场景动作自然递进。',
            dialogue: '',
            audio: '保留同期环境声与已锁定角色声线。',
            endState: '末帧进入稳定、可衔接状态。',
            continuity: '服装、道具、人物站位与淡红纹路保持连续。',
          },
        ],
        negativeConstraints: [
          '不生成可读姓名、字幕、判词或信中文字。',
          '不使用粒子魔法、仙侠光效、科幻 HUD、剪切、跳时或突然变焦。',
          '玩家不露脸。',
        ],
        continuityNotes: ['以原 v2 生成规格与现有 1080p 成片为准。'],
      };
    }),
    trailerPrompt: null,
    productionNotes: [
      '由《金陵入梦：无字来客》v2 的 26 条 Seedance 2.0 成片导入。',
      '等待片段暂作为时间码 0 出现选择的普通影片节点；循环等待 UI 语义后续单独抽象。',
    ],
  });

  const { filmSpec, clipSpecs } = projectStoryFilmRevision({
    draft: draftContent,
    frameProfile: 'landscape_16_9',
    defaultLocale: DEFAULT_LOCALE,
    defaultCanonicalModelId,
  });
  return { draftContent, filmSpec, clipSpecs, prompts };
}

function buildGraph(): GraphNode[] {
  const auto = (clipId: JinlingV2ClipId, next: JinlingV2ClipId): GraphNode => ({
    kind: 'clip',
    nodeId: jinlingClipNodeId(clipId),
    clipKey: jinlingClipKey(clipId),
    exit: {
      kind: 'auto',
      nextNodeId: jinlingClipNodeId(next),
    },
  });
  const decision = (chapter: keyof typeof CHOICES): GraphNode => {
    const authored = CHOICES[chapter];
    return {
      kind: 'clip',
      nodeId: jinlingClipNodeId(authored.source),
      clipKey: jinlingClipKey(authored.source),
      exit: {
        kind: 'choice',
        decisionId: `decision:${chapter}`,
        prompt: authored.prompt,
        trigger: { kind: 'timecode', atMs: 0 },
        choices: authored.options.map((choice) => ({
          choiceId: `choice:${chapter}:${choice.id}`,
          label: choice.label,
          effects: [],
          nextNodeId: jinlingClipNodeId(choice.reaction),
          afterSelect: { kind: 'immediate' },
        })),
      },
    };
  };
  const ending = (clipId: JinlingV2ClipId, endingId: string): GraphNode => ({
    kind: 'clip',
    nodeId: jinlingClipNodeId(clipId),
    clipKey: jinlingClipKey(clipId),
    exit: { kind: 'ending', endingId },
  });

  return [
    auto('p00-ledger-opening', 's01-gate-arrival'),
    auto('s01-gate-arrival', 'w01-identity-wait'),
    decision('c1'),
    auto('c1-r01-brocade', 's02-corridor-crisis'),
    auto('c1-r02-old-seal', 's02-corridor-crisis'),
    auto('c1-r03-medicine-pouch', 's02-corridor-crisis'),
    auto('s02-corridor-crisis', 'w02-corridor-wait'),
    decision('c2'),
    auto('c2-r01-protect-daiyu', 's03-jiamu-reunion'),
    auto('c2-r02-steady-lantern', 's03-jiamu-reunion'),
    auto('c2-r03-protect-letter', 's03-jiamu-reunion'),
    auto('s03-jiamu-reunion', 's03-xifeng-boundary'),
    auto('s03-xifeng-boundary', 's04-baoyu-arrival'),
    auto('s04-baoyu-arrival', 's04-jade-throw'),
    {
      kind: 'clip',
      nodeId: jinlingClipNodeId('s04-jade-throw'),
      clipKey: jinlingClipKey('s04-jade-throw'),
      exit: {
        kind: 'choice',
        decisionId: 'decision:c3',
        prompt: CHOICES.c3.prompt,
        trigger: { kind: 'media-ended' },
        choices: CHOICES.c3.options.map((choice) => ({
          choiceId: `choice:c3:${choice.id}`,
          label: choice.label,
          effects: [],
          nextNodeId: jinlingClipNodeId(choice.reaction),
          afterSelect: { kind: 'immediate' },
        })),
      },
    },
    auto('c3-r01-catch-jade', 's05-daiyu-night-visit'),
    auto('c3-r02-shield-daiyu', 's05-daiyu-night-visit'),
    auto('c3-r03-call-household', 's05-daiyu-night-visit'),
    auto('c3-r04-observe-pattern', 's05-daiyu-night-visit'),
    auto('s05-daiyu-night-visit', 's05-letter-reveal'),
    auto('s05-letter-reveal', 'w03-final-choice-wait'),
    decision('c4'),
    ending('e01-spring-with-daiyu', 'ending:e01'),
    ending('e02-name-in-house', 'ending:e02'),
    ending('e03-memory-shared', 'ending:e03'),
    ending('e04-future-unwritten', 'ending:e04'),
  ];
}

function buildStoryBible() {
  return {
    logline:
      '作为一个不属于原著的无字来客，你与黛玉一同进入荣国府，并以四次选择决定自己在金陵留下怎样的命。',
    synopsis:
      '玩家从太虚水面的无字命册醒来，持一封带淡红印纹的荐书进入荣国府。门前验身、游廊风灯、宝玉摔玉与黛玉夜访构成四个选择节点；每次选择先产生一条即时反应，再汇回共同主线。最终四个选择分别通向共春、立名、共忆与未写。',
    worldview:
      '古典写实的荣国府与一条极克制的超自然规则相叠：命册只记录选择，从不替人写完命运；淡红印纹只借纸、水、灯火和反射显现。',
    storyRules: [
      '玩家是不属于原著的成年无字来客，始终使用第一视角且不露脸。',
      '选择会改变人物对玩家的理解，但前三次选择最终汇回同一主线。',
      '第四次选择确定唯一结局，不使用隐藏分数随机改写。',
      '超自然表现必须克制，不破坏古典写实质感。',
    ],
    characters: [
      {
        id: 'player',
        name: localized('The Unwritten Visitor', '无字来客', '無字來客'),
        role: 'player_protagonist',
        summary: '从无字命册醒来、持荐书进入荣国府的成年异乡人。',
        playable: true,
        continuityRules: ['第一视角，不露脸。', '手部与成年声线保持一致。'],
      },
      {
        id: 'daiyu',
        name: localized('Lin Daiyu', '林黛玉', '林黛玉'),
        role: 'primary_companion',
        summary: '同为异乡人的敏锐少女，是玩家进入荣府后的情感锚点。',
        playable: false,
        continuityRules: ['清瘦克制，不病弱化。', '服装与发型遵循锁定参考。'],
      },
      {
        id: 'baoyu',
        name: localized('Jia Baoyu', '贾宝玉', '賈寶玉'),
        role: 'catalyst',
        summary: '以摔玉事件迫使满堂人物显露各自边界。',
        playable: false,
        continuityRules: ['少年感与冲动并存。'],
      },
      {
        id: 'xifeng',
        name: localized('Wang Xifeng', '王熙凤', '王熙鳳'),
        role: 'household_boundary',
        summary: '以热络和审视同时确认来客在府中的位置。',
        playable: false,
        continuityRules: ['明艳、利落、边界清晰。'],
      },
    ],
    locations: [
      '太虚水面',
      '荣国府门前',
      '荣府游廊',
      '荣禧堂正厅',
      '内院客房',
      '海棠廊下',
    ],
    props: [
      '无字命册',
      '淡红封印荐书',
      '旧云锦残片',
      '故交私印',
      '随身药囊',
      '风灯',
      '通灵玉',
    ],
    stateVariables: [],
    endings: [
      {
        id: 'ending:e01',
        title: localized('A Shared Spring', '共春', '共春'),
        summary: localized(
          'Live this spring fully with Daiyu.',
          '与黛玉把眼前这一春认真过完。',
          '與黛玉把眼前這一春認真過完。',
        ),
        kind: 'bond' as const,
      },
      {
        id: 'ending:e02',
        title: localized('A Name in the House', '立名', '立名'),
        summary: localized(
          'Take a real place and name in the Rong house.',
          '在荣府得到一张真正的名帖。',
          '在榮府得到一張真正的名帖。',
        ),
        kind: 'custom' as const,
      },
      {
        id: 'ending:e03',
        title: localized('A Shared Memory', '共忆', '共憶'),
        summary: localized(
          'Share the impossible memory with Daiyu.',
          '把无字命册的秘密与黛玉共同守住。',
          '把無字命冊的秘密與黛玉共同守住。',
        ),
        kind: 'truth' as const,
      },
      {
        id: 'ending:e04',
        title: localized('Unwritten', '未写', '未寫'),
        summary: localized(
          'Leave the road ahead unwritten.',
          '什么都不定下，让往后的路仍然空白。',
          '甚麼都不定下，讓往後的路仍然空白。',
        ),
        kind: 'hidden' as const,
      },
    ],
  };
}

function parsePrompt(markdown: string, clipId: JinlingV2ClipId): ParsedPrompt {
  const headingPattern = new RegExp(`^## \\d+｜\`${clipId}\`｜(.+)$`, 'mu');
  const match = headingPattern.exec(markdown);
  if (!match || match.index < 0)
    throw new Error(`Prompt spec is missing ${clipId}.`);
  const nextHeading = markdown.indexOf('\n## ', match.index + match[0].length);
  const section = markdown.slice(
    match.index,
    nextHeading < 0 ? undefined : nextHeading,
  );
  const blocks = [...section.matchAll(/```text\n([\s\S]*?)```/gu)].map((row) =>
    row[1].trim(),
  );
  if (!blocks[0] || !blocks[1])
    throw new Error(`${clipId} must have prompt and timeline blocks.`);
  const splitSlots = (label: string) => {
    const raw =
      new RegExp(`\\*\\*${label}\\*\\*：(.+)`, 'u').exec(section)?.[1] ?? '';
    return raw
      .split(/[,，]/u)
      .map((value) => value.trim())
      .filter(
        (value) =>
          value && !value.includes('无对白') && !value.includes('（无'),
      );
  };
  return {
    clipId,
    title: match[1].trim(),
    positive: blocks[0],
    timeline: blocks[1],
    imageSlots: splitSlots('参考图'),
    audioSlots: splitSlots('声纹卡'),
  };
}
