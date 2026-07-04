/**
 * 起承转合 × 10-genre act templates — the fizzstory-v3 structure engine
 * (docs/story-studio-creator-v3-refactor.md §D3, PPT slide 7).
 *
 * Play pacing (step counts, interaction density) is deliberately absent:
 * it is a player-side runtime setting chosen when the player enters a story,
 * so the creation side carries no step vocabulary at all.
 *
 * This module is PROMPT DATA, not runtime logic: the generation service
 * injects the relevant template into the LLM prompt so act plans follow the
 * house structure instead of free-form improvisation. Keys are locale-neutral
 * (`setup/development/turn/resolution`); zh labels live beside them so every
 * consumer renders 起/承/转/合 consistently.
 *
 * Every generated artifact is stamped with GENERATOR_VERSION — bump it on ANY
 * template or prompt change so persisted drafts stay attributable.
 */

export const GENERATOR_VERSION = 'fizzstory-gen-2';

export type StoryActKey = 'setup' | 'development' | 'turn' | 'resolution';

export const ACT_KEYS: readonly StoryActKey[] = [
  'setup',
  'development',
  'turn',
  'resolution',
] as const;

export const ACT_LABELS: Record<StoryActKey, { zh: string; en: string }> = {
  setup: { zh: '起', en: 'Setup' },
  development: { zh: '承', en: 'Development' },
  turn: { zh: '转', en: 'Turn' },
  resolution: { zh: '合', en: 'Resolution' },
};

export type StoryGenreKey =
  | 'suspense'
  | 'two_hander'
  | 'power_play'
  | 'survival'
  | 'coming_of_age'
  | 'romance'
  | 'tragedy'
  | 'underdog'
  | 'road_trip'
  | 'detective';

export const STORY_GENRE_KEYS: readonly StoryGenreKey[] = [
  'suspense',
  'two_hander',
  'power_play',
  'survival',
  'coming_of_age',
  'romance',
  'tragedy',
  'underdog',
  'road_trip',
  'detective',
] as const;

interface ActTemplate {
  /** 剧情锚点 — what happens in this act (creator-facing guidance). */
  anchor: string;
  /** 情绪曲线 — the feeling this act must land. */
  emotionArc: string;
  /** 收口钩子 — the pull the act must end on. */
  exitHook: string;
}

export interface GenreTemplate {
  key: StoryGenreKey;
  label: { zh: string; en: string };
  acts: Record<StoryActKey, ActTemplate>;
  /** 附表B — per-act emotional keyword. */
  emotionKeywords: Record<StoryActKey, string>;
}

export const GENRE_TEMPLATES: Record<StoryGenreKey, GenreTemplate> = {
  suspense: {
    key: 'suspense',
    label: { zh: '悬疑', en: 'Suspense' },
    acts: {
      setup: {
        anchor: '反常现象侵入日常（1个无法解释的细节）',
        emotionArc: '困惑+轻微不安',
        exitHook: '抛出“这件事跟我有关”的暗示',
      },
      development: {
        anchor: '线索堆积（3-5条碎片），嫌疑人/势力浮出水面',
        emotionArc: '焦虑+猜疑',
        exitHook: '发现关键证据，但指向两个相反方向',
      },
      turn: {
        anchor: '真相反转（颠覆之前所有认知）',
        emotionArc: '震惊+认知崩塌',
        exitHook: '主角被迫在“新真相”下立即行动',
      },
      resolution: {
        anchor: '真相大白（闭环）或永远成谜（开放式）',
        emotionArc: '释然/悲凉/细思极恐',
        exitHook: '最后一个画面留有微量余味',
      },
    },
    emotionKeywords: {
      setup: '不安',
      development: '猜疑',
      turn: '崩塌',
      resolution: '寒意/释然',
    },
  },
  two_hander: {
    key: 'two_hander',
    label: { zh: '双男主', en: 'Two-Hander' },
    acts: {
      setup: {
        anchor: '两人在特殊情境下相遇（立场不同/有天然冲突）',
        emotionArc: '好奇+戒备',
        exitHook: '产生一个“必须共同面对”的外部压力',
      },
      development: {
        anchor: '羁绊与对抗交替升级，彼此试探底线',
        emotionArc: '拉扯+暧昧张力',
        exitHook: '其中一方做出“越界”行为',
      },
      turn: {
        anchor: '信任破裂（秘密暴露）或升华（牺牲/告白）',
        emotionArc: '心碎/热血',
        exitHook: '局势因两人的关系变化而彻底翻转',
      },
      resolution: {
        anchor: '分道扬镳（遗憾）或并肩作战（圆满）',
        emotionArc: '释然/意难平',
        exitHook: '最后一句话是两人之间的暗号/暗语',
      },
    },
    emotionKeywords: {
      setup: '碰撞',
      development: '拉扯',
      turn: '撕裂/凝结',
      resolution: '余味',
    },
  },
  power_play: {
    key: 'power_play',
    label: { zh: '权谋', en: 'Power Play' },
    acts: {
      setup: {
        anchor: '展示权力格局（谁在上谁在下，谁想动谁）',
        emotionArc: '冷眼观察+计算',
        exitHook: '一个“棋子”被当众牺牲，主角意识到自己也可能是棋子',
      },
      development: {
        anchor: '各方布局与暗中博弈，主角开始落子',
        emotionArc: '紧张+步步为营',
        exitHook: '主角下了一步“险棋”，后果未知',
      },
      turn: {
        anchor: '关键棋子暴露真实身份（叛徒/卧底/底牌）',
        emotionArc: '意外+破局',
        exitHook: '权力天平彻底倾斜，主角必须在“止损”和“反杀”之间选',
      },
      resolution: {
        anchor: '上位（胜）或败亡（负）或双输',
        emotionArc: '畅快/苍凉',
        exitHook: '新的权力格局形成，但留有隐患',
      },
    },
    emotionKeywords: {
      setup: '冷眼',
      development: '紧绷',
      turn: '惊雷',
      resolution: '苍凉/畅快',
    },
  },
  survival: {
    key: 'survival',
    label: { zh: '生存', en: 'Survival' },
    acts: {
      setup: {
        anchor: '危机突然降临（天灾/人祸/封锁），切断退路',
        emotionArc: '恐慌+求生本能',
        exitHook: '第一个同伴死亡或失踪',
      },
      development: {
        anchor: '资源（食物/水/药品/信任）争夺，规则崩塌',
        emotionArc: '疲惫+道德挣扎',
        exitHook: '出现“人吃人”的迹象',
      },
      turn: {
        anchor: '有人牺牲自己救别人，或主角被逼做出极端选择',
        emotionArc: '绝望+悲壮',
        exitHook: '希望出现（救援信号/逃生路线），但代价极大',
      },
      resolution: {
        anchor: '存活（部分人）或全灭',
        emotionArc: '劫后余生的平静/虚无',
        exitHook: '幸存者面对新世界的第一个早晨',
      },
    },
    emotionKeywords: {
      setup: '恐惧',
      development: '疲惫',
      turn: '悲壮',
      resolution: '虚空/平静',
    },
  },
  coming_of_age: {
    key: 'coming_of_age',
    label: { zh: '成长', en: 'Coming-of-Age' },
    acts: {
      setup: {
        anchor: '主角处于“无能”状态（被保护/被忽视/自卑）',
        emotionArc: '压抑+不甘',
        exitHook: '一个“不得不自己扛”的事情砸到头上',
      },
      development: {
        anchor: '反复受挫→反复爬起，逐渐获得技能/盟友',
        emotionArc: '疼痛+微弱成就感',
        exitHook: '取得第一次真正意义上的“小胜”',
      },
      turn: {
        anchor: '大失败（失去重要的人/物），主角濒临崩溃',
        emotionArc: '至暗时刻',
        exitHook: '主角在废墟中做出“最后一次尝试”的决定',
      },
      resolution: {
        anchor: '完成蜕变（不一定成功，但已不是从前的自己）',
        emotionArc: '温暖/坦然',
        exitHook: '主角回头看一眼起点，笑了一下，继续往前走',
      },
    },
    emotionKeywords: {
      setup: '压抑',
      development: '疼痛',
      turn: '至暗',
      resolution: '温暖',
    },
  },
  romance: {
    key: 'romance',
    label: { zh: '爱情', en: 'Romance' },
    acts: {
      setup: {
        anchor: '两人在特殊场合相遇（有误会/有偏见）',
        emotionArc: '好奇+别扭',
        exitHook: '被迫绑定（同桌/搭档/邻居）',
      },
      development: {
        anchor: '日常相处中细节打动彼此，好感积累',
        emotionArc: '甜蜜+忐忑',
        exitHook: '第一个“差点捅破”的瞬间',
      },
      turn: {
        anchor: '外部阻力介入（家庭/时代/身份差异）或误会爆发',
        emotionArc: '心碎+拉扯',
        exitHook: '一方做出“为你好所以离开”的决定',
      },
      resolution: {
        anchor: '在一起（克服困难）或错过（时代悲歌）',
        emotionArc: '圆满/遗憾',
        exitHook: '最后一个镜头是两人（或一人）的背影',
      },
    },
    emotionKeywords: {
      setup: '别扭',
      development: '甜蜜',
      turn: '心碎',
      resolution: '圆满/遗憾',
    },
  },
  tragedy: {
    key: 'tragedy',
    label: { zh: '悲剧', en: 'Tragedy' },
    acts: {
      setup: {
        anchor: '展现美好的日常/亲密的关系',
        emotionArc: '温暖+安心',
        exitHook: '埋下1个不易察觉的隐患',
      },
      development: {
        anchor: '隐患开始显现，主角试图修正但无力',
        emotionArc: '无力感+预感',
        exitHook: '第一次“不可逆的损失”发生',
      },
      turn: {
        anchor: '命运重锤落下，所有努力失效',
        emotionArc: '心碎+苍白',
        exitHook: '主角面对“已经无法挽回”的现实',
      },
      resolution: {
        anchor: '悲剧完成（死亡/分离/梦想破灭）',
        emotionArc: '平静的绝望',
        exitHook: '最后一句台词是“那天天气很好”一类的反讽',
      },
    },
    emotionKeywords: {
      setup: '温暖',
      development: '无力',
      turn: '心碎',
      resolution: '平静绝望',
    },
  },
  underdog: {
    key: 'underdog',
    label: { zh: '逆袭', en: 'Underdog' },
    acts: {
      setup: {
        anchor: '主角被踩到泥里（公开羞辱/夺走一切）',
        emotionArc: '屈辱+愤怒',
        exitHook: '获得一个“翻盘的机会”（线索/工具/盟友）',
      },
      development: {
        anchor: '暗中积蓄力量，伪装服从',
        emotionArc: '隐忍+步步为营',
        exitHook: '第一次反击，小胜一局',
      },
      turn: {
        anchor: '被反扑，底牌暴露，陷入更大危机',
        emotionArc: '凶险+抉择',
        exitHook: '主角亮出真正的“杀招”',
      },
      resolution: {
        anchor: '逆袭成功（夺回一切）或玉石俱焚',
        emotionArc: '痛快/苍凉',
        exitHook: '主角站在高处，底下是曾经的施暴者',
      },
    },
    emotionKeywords: {
      setup: '屈辱',
      development: '隐忍',
      turn: '凶险',
      resolution: '痛快/苍凉',
    },
  },
  road_trip: {
    key: 'road_trip',
    label: { zh: '公路', en: 'Road Trip' },
    acts: {
      setup: {
        anchor: '主角上路（逃离/寻找/被迫出发）',
        emotionArc: '茫然+期待',
        exitHook: '第一个同行者加入',
      },
      development: {
        anchor: '沿途遇见各种人和事，小队关系变化',
        emotionArc: '丰富+颠簸',
        exitHook: '目的地出现变数（已消失/被封锁/不是想象的样子）',
      },
      turn: {
        anchor: '核心矛盾爆发（队伍内讧/目标幻灭）',
        emotionArc: '动摇',
        exitHook: '主角重新定义“为什么要走”',
      },
      resolution: {
        anchor: '抵达或不再需要抵达',
        emotionArc: '释然',
        exitHook: '最后一段路是主角一个人走的，但脸上有笑',
      },
    },
    emotionKeywords: {
      setup: '茫然',
      development: '丰富',
      turn: '动摇',
      resolution: '释然',
    },
  },
  detective: {
    key: 'detective',
    label: { zh: '侦探', en: 'Detective' },
    acts: {
      setup: {
        anchor: '案件/谜题出现（尸体/失踪/不可能事件）',
        emotionArc: '好奇+冷静',
        exitHook: '发现第一个“矛盾点”',
      },
      development: {
        anchor: '走访、取证、推理，嫌疑人名单形成',
        emotionArc: '抽丝剥茧的爽感',
        exitHook: '某个“铁证”被推翻，一切回到原点',
      },
      turn: {
        anchor: '真凶/真相浮出水面，但出人意料',
        emotionArc: '震惊+道德困境',
        exitHook: '主角与真凶对峙',
      },
      resolution: {
        anchor: '结案（正义/妥协/秘密封存）',
        emotionArc: '沉重/如释重负',
        exitHook: '最后一个镜头是案件档案被盖上“已结”章',
      },
    },
    emotionKeywords: {
      setup: '好奇',
      development: '爽感',
      turn: '震惊',
      resolution: '沉重',
    },
  },
};

/** Compact one-line-per-genre overview injected when genre = auto. */
export function genreOverviewTable(): string {
  return STORY_GENRE_KEYS.map((key) => {
    const template = GENRE_TEMPLATES[key];
    const acts = ACT_KEYS.map(
      (actKey) => `${ACT_LABELS[actKey].zh}:${template.acts[actKey].anchor}`,
    ).join(' | ');
    return `${key}(${template.label.zh}): ${acts}`;
  }).join('\n');
}

/** Full per-act template for ONE genre, injected when the genre is known. */
export function genreTemplateBlock(genre: StoryGenreKey): string {
  const template = GENRE_TEMPLATES[genre];
  const lines = ACT_KEYS.map((actKey) => {
    const act = template.acts[actKey];
    return [
      `${ACT_LABELS[actKey].zh}(${actKey}):`,
      `  剧情锚点: ${act.anchor}`,
      `  情绪曲线: ${act.emotionArc} (关键词: ${template.emotionKeywords[actKey]})`,
      `  收口钩子: ${act.exitHook}`,
    ].join('\n');
  });
  return [`类型: ${template.label.zh} (${genre})`, ...lines].join('\n');
}
