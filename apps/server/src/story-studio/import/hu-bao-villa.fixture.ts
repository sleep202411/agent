/**
 * Canonical authored content for the first real Story Studio project.
 * Production prompts are imported separately from the locked prompt pack;
 * this object owns the story/choice/endings truth and contains no media URLs.
 */
export type HuBaoVillaChoiceEffect =
  | { readonly variable: string; readonly add: number }
  | { readonly flag: string; readonly set: string };

export type HuBaoVillaLocalizedText = Readonly<
  Record<'en-US' | 'zh-CN' | 'zh-HK', string>
>;

export interface HuBaoVillaAuthoredChoice {
  readonly key: string;
  readonly prompt: HuBaoVillaLocalizedText;
  readonly sourceClipKey?: string;
  readonly sourceClipKeys?: readonly string[];
  readonly options: readonly {
    readonly key: string;
    readonly label: HuBaoVillaLocalizedText;
    readonly effects: readonly HuBaoVillaChoiceEffect[];
  }[];
}

export const HU_BAO_VILLA_PROJECT_ID = '01980f10-7a20-7c01-8000-000000000001';
export const HU_BAO_VILLA_FRAME_PROFILE = 'landscape_16_9' as const;

export const HU_BAO_VILLA_DRAFT_CONTENT = {
  title: '虎豹别墅：龙口入夜',
  subtitle: "Haw Par Villa: Nightfall at the Dragon's Mouth",
  format: 'interactive_film',
  genre: ['urban_folklore_mystery', 'moral_choice', 'light_horror'],
  logline:
    '闭园后的虎豹别墅里，一盘失真的旧磁带唤醒早已消失的巨龙入口；少女必须在六声开园锣结束前，决定应当保存一段不光彩的真实，还是留下一个更动听的传说。',
  coreQuestion: '纪念一个人，是替他修饰过去，还是允许真实连同羞耻一起被记住？',
  player: {
    characterKey: 'cheng',
    perspective: 'fixed_protagonist',
  },
  experience: {
    targetRuntimeMs: 120_000,
    maxContinuousMs: 15_000,
    choiceCount: 6,
    endingCount: 4,
    clipCount: 21,
    fullPathCount: 64,
    frame: { aspectRatio: '16:9', width: 1920, height: 1080, fps: 24 },
  },
  worldRules: [
    '1994 年最后一场闭园广播母带在园内播放时，已拆除的 Dragon World 与当下重叠 120 秒。',
    '每完成一次选择，远处响一声开园锣；第六声后，龙口吞下被舍弃的版本。',
    '雕塑只能复述磁带中的旧台词或玩家刚说过的话，不能说新话。',
    '林国声是母带、广播系统与陈澄记忆共同拼出的回声人格，不知道 1994 年之后的事。',
    '保全完整母带必须同时公开林国声的失误；替他洗清则会剪掉 Salmah 救人的证据。',
    '最坏后果是记忆被改写、关系破裂或角色困在循环中，不使用写实死亡惩罚。',
  ],
  characters: [
    {
      key: 'cheng',
      name: '陈澄',
      englishName: 'Cheng',
      age: 19,
      role: 'player_protagonist',
      objective: '数字化外公遗留母带，把最后开园曲交给口述史展。',
      innerNeed: '从替外公证明无错，走向决定真实应由谁承担、如何被听见。',
      visualLock:
        '深灰短袖衬衫、旧牛仔裤、红色有线耳机挂在颈间、银色便携卡带机。',
      performanceGuardrail: '不尖叫失控；恐惧通过屏息、吞咽和握紧机器表现。',
    },
    {
      key: 'maya',
      name: 'Maya Rahman',
      age: 20,
      role: 'companion_and_reality_anchor',
      objective: '拍下毕业短片并确保两人安全离园。',
      secret: '已经听过未剪母带，知道林国声漏报设备故障。',
      visualLock: '橄榄绿防雨外套、黑色相机背带、小型手持 DV。',
      performanceGuardrail:
        '不是只会劝退的工具人；会主动救人，也会为保存证据冒险。',
    },
    {
      key: 'lin',
      name: '林国声',
      englishName: 'Lim Guo Sheng',
      age: 29,
      role: 'echo_personality',
      objective: '让外孙女记住自己让乐园活过，而不是差点害了人。',
      visualLock: '只通过控制室玻璃反影、CRT 或远处剪影出现，永不拍清正脸。',
      keyLine: '好听的故事，才有人肯记。',
    },
    {
      key: 'salmah',
      name: 'Salmah Binte Yusof',
      role: 'absent_truth_witness',
      objective: '通过原始录音和事故日志取回被剪掉的名字。',
      visualLock: '不以鬼魂实体出现，只通过母带原声、工牌和检修日志存在。',
      keyLine: '国声，音乐可以停，人要先出去。',
    },
  ],
  stateVariables: [
    { key: 'truth', label: '真相', initial: 0, hidden: true },
    { key: 'bond', label: '同行', initial: 0, hidden: true },
    { key: 'echo', label: '回声', initial: 0, hidden: true },
  ],
  choices: [
    {
      key: 'C1',
      prompt: {
        'en-US': 'Which track should play first?',
        'zh-CN': '先播放哪一轨？',
        'zh-HK': '先播放哪一軌？',
      },
      sourceClipKey: 'S00',
      options: [
        {
          key: 'A',
          label: {
            'en-US': "Grandpa's marked opening song",
            'zh-CN': '外公标记的开园曲',
            'zh-HK': '外公標記的開園曲',
          },
          effects: [{ variable: 'echo', add: 1 }],
        },
        {
          key: 'B',
          label: {
            'en-US': 'The unlabelled B-side',
            'zh-CN': '没有标签的 B 面',
            'zh-HK': '沒有標籤的 B 面',
          },
          effects: [{ variable: 'truth', add: 1 }],
        },
      ],
    },
    {
      key: 'C2',
      prompt: {
        'en-US': 'The broadcast calls your childhood name. Who do you answer?',
        'zh-CN': '广播叫出乳名，回应谁？',
        'zh-HK': '廣播叫出乳名，回應誰？',
      },
      sourceClipKeys: ['S01A', 'S01B'],
      options: [
        {
          key: 'A',
          label: {
            'en-US': 'Answer Grandpa',
            'zh-CN': '回应外公',
            'zh-HK': '回應外公',
          },
          effects: [{ variable: 'echo', add: 1 }],
        },
        {
          key: 'B',
          label: {
            'en-US': 'Tell Maya the truth first',
            'zh-CN': '先告诉 Maya 真相',
            'zh-HK': '先告訴 Maya 真相',
          },
          effects: [{ variable: 'bond', add: 1 }],
        },
      ],
    },
    {
      key: 'C3',
      prompt: {
        'en-US': 'The ride is flooding. What do you save first?',
        'zh-CN': '船道进水，先抢什么？',
        'zh-HK': '船道進水，先搶救甚麼？',
      },
      sourceClipKeys: ['S02A', 'S02B'],
      options: [
        {
          key: 'A',
          label: {
            'en-US': 'Grab Maya',
            'zh-CN': '拉住 Maya',
            'zh-HK': '拉住 Maya',
          },
          effects: [{ variable: 'bond', add: 1 }],
        },
        {
          key: 'B',
          label: {
            'en-US': 'Recover the master tape',
            'zh-CN': '抢回母带',
            'zh-HK': '搶回母帶',
          },
          effects: [{ variable: 'truth', add: 1 }],
        },
      ],
    },
    {
      key: 'C4',
      prompt: {
        'en-US': 'Who should answer for the accident?',
        'zh-CN': '谁该为事故负责？',
        'zh-HK': '誰該為事故負責？',
      },
      sourceClipKeys: ['S03A', 'S03B'],
      options: [
        {
          key: 'A',
          label: {
            'en-US': 'Admit Grandpa hid the fault',
            'zh-CN': '承认外公隐瞒故障',
            'zh-HK': '承認外公隱瞞故障',
          },
          effects: [{ variable: 'truth', add: 1 }],
        },
        {
          key: 'B',
          label: {
            'en-US': 'Say no one had a choice',
            'zh-CN': '说当年没人有选择',
            'zh-HK': '說當年沒有人有選擇',
          },
          effects: [{ variable: 'echo', add: 1 }],
        },
      ],
    },
    {
      key: 'C5',
      prompt: {
        'en-US': 'Only one track can survive. Whose voice stays?',
        'zh-CN': '只够保留一条声轨，留下谁？',
        'zh-HK': '只夠保留一條聲軌，留下誰？',
      },
      sourceClipKeys: ['S04A', 'S04B', 'S04C'],
      options: [
        {
          key: 'A',
          label: {
            'en-US': "Keep Salmah's original voice",
            'zh-CN': '留下 Salmah 的原声',
            'zh-HK': '留下 Salmah 的原聲',
          },
          effects: [{ variable: 'truth', add: 1 }],
        },
        {
          key: 'B',
          label: {
            'en-US': "Keep Grandpa's opening song",
            'zh-CN': '留下外公的开园曲',
            'zh-HK': '留下外公的開園曲',
          },
          effects: [{ variable: 'echo', add: 1 }],
        },
      ],
    },
    {
      key: 'C6',
      prompt: {
        'en-US': 'Before the sixth gong, how do you end the playback?',
        'zh-CN': '第六声锣前，怎么结束回放？',
        'zh-HK': '第六聲鑼前，怎樣結束回放？',
      },
      sourceClipKeys: ['S05A', 'S05B', 'S05C'],
      options: [
        {
          key: 'A',
          label: {
            'en-US': 'Release the complete tape',
            'zh-CN': '公开完整母带',
            'zh-HK': '公開完整母帶',
          },
          effects: [{ flag: 'finalAction', set: 'release' }],
        },
        {
          key: 'B',
          label: {
            'en-US': 'Eject it and leave with Maya',
            'zh-CN': '拔带，带 Maya 离开',
            'zh-HK': '拔帶，帶 Maya 離開',
          },
          effects: [{ flag: 'finalAction', set: 'leave' }],
        },
      ],
    },
  ] satisfies readonly HuBaoVillaAuthoredChoice[],
  variantRules: [
    {
      stage: 'S01',
      priority: 1,
      when: { choice: 'C1', option: 'A' },
      target: 'S01A',
    },
    {
      stage: 'S01',
      priority: 2,
      when: { choice: 'C1', option: 'B' },
      target: 'S01B',
    },
    {
      stage: 'S02',
      priority: 1,
      when: { choice: 'C2', option: 'A' },
      target: 'S02A',
    },
    {
      stage: 'S02',
      priority: 2,
      when: { choice: 'C2', option: 'B' },
      target: 'S02B',
    },
    {
      stage: 'S03',
      priority: 1,
      when: { choice: 'C3', option: 'A' },
      target: 'S03A',
    },
    {
      stage: 'S03',
      priority: 2,
      when: { choice: 'C3', option: 'B' },
      target: 'S03B',
    },
    {
      stage: 'S04',
      priority: 1,
      when: { variable: 'bond', gte: 2 },
      target: 'S04A',
    },
    {
      stage: 'S04',
      priority: 2,
      when: {
        all: [
          { variable: 'bond', lt: 2 },
          { choice: 'C4', option: 'A' },
        ],
      },
      target: 'S04B',
    },
    {
      stage: 'S04',
      priority: 3,
      when: {
        all: [
          { variable: 'bond', lt: 2 },
          { choice: 'C4', option: 'B' },
        ],
      },
      target: 'S04C',
    },
    {
      stage: 'S05',
      priority: 1,
      when: { variable: 'truth', gte: 3 },
      target: 'S05A',
    },
    {
      stage: 'S05',
      priority: 2,
      when: { variable: 'echo', gte: 3 },
      target: 'S05B',
    },
    { stage: 'S05', priority: 3, when: { otherwise: true }, target: 'S05C' },
  ],
  endings: [
    {
      key: 'E01',
      title: {
        'en-US': 'The Name Returned',
        'zh-CN': '名字归还',
        'zh-HK': '名字歸還',
      },
      summary: {
        'en-US':
          'At the morning entrance, the oral-history exhibit credits “Salmah Binte Yusof and the original voices of the 1994 night-shift staff”; Lim Guo Sheng is listed as an interviewee, not a hero. Cheng and Maya listen together to the end.',
        'zh-CN':
          '清晨入口。口述史展的音频页面标题为“Salmah Binte Yusof 与 1994 夜班员工原声记录”；林国声列为受访者而非英雄。陈澄和 Maya 并肩听完。',
        'zh-HK':
          '清晨入口。口述史展的音頻頁面標題為「Salmah Binte Yusof 與 1994 夜班員工原聲記錄」；林國聲列為受訪者而非英雄。陳澄和 Maya 並肩聽完。',
      },
      priority: 1,
      condition: {
        all: [
          { flag: 'finalAction', eq: 'release' },
          { variable: 'truth', gte: 3 },
        ],
      },
      consequenceClipKey: 'S06A',
      endingClipKey: 'E01',
    },
    {
      key: 'E02',
      title: {
        'en-US': 'The Last Opening',
        'zh-CN': '最后开园',
        'zh-HK': '最後開園',
      },
      summary: {
        'en-US':
          'The exhibit plays the restored, magnificent opening song while visitors smile for photos. In a corner of the original waveform, a short female voice is marked “irreparable noise”. Cheng stands alone behind the crowd.',
        'zh-CN':
          '展览播放修复后的华丽开园曲，观众微笑拍照。屏幕角落的原始波形里，一小段女声被标红为“不可修复噪声”。陈澄独自站在人群后。',
        'zh-HK':
          '展覽播放修復後的華麗開園曲，觀眾微笑拍照。屏幕角落的原始波形裡，一小段女聲被標紅為「不可修復噪聲」。陳澄獨自站在人群後。',
      },
      priority: 2,
      condition: {
        all: [
          { flag: 'finalAction', eq: 'release' },
          { variable: 'truth', lt: 3 },
        ],
      },
      consequenceClipKey: 'S06B',
      endingClipKey: 'E02',
    },
    {
      key: 'E03',
      title: {
        'en-US': 'Leaving Together',
        'zh-CN': '两人出园',
        'zh-HK': '兩人出園',
      },
      summary: {
        'en-US':
          'The two sit in a morning MRT station with the uncut tape sealed in a clear evidence bag. Maya switches off the DV camera while Cheng writes both names on the bag.',
        'zh-CN':
          '两人坐在清晨地铁站，未剪母带封在透明证物袋中。Maya 关掉 DV，陈澄在袋上写下两个人名。',
        'zh-HK':
          '兩人坐在清晨地鐵站，未剪母帶封在透明證物袋中。Maya 關掉 DV，陳澄在袋上寫下兩個人的名字。',
      },
      priority: 3,
      condition: {
        all: [
          { flag: 'finalAction', eq: 'leave' },
          { variable: 'bond', gte: 2 },
        ],
      },
      consequenceClipKey: 'S06C',
      endingClipKey: 'E03',
    },
    {
      key: 'E04',
      title: {
        'en-US': 'The Seventh Gong',
        'zh-CN': '第七声锣',
        'zh-HK': '第七聲鑼',
      },
      summary: {
        'en-US':
          'Time jumps back to the S00 camera position. The entrance is empty as Cheng presses play alone; on the DV screen, Maya has become the afterimage of a 1994 visitor. The seventh gong falls.',
        'zh-CN':
          '时间跳回 S00 的机位。入口空无一人，陈澄独自按下播放；DV 屏幕里 Maya 成了 1994 年的游客残影。 第七声锣落下。',
        'zh-HK':
          '時間跳回 S00 的機位。入口空無一人，陳澄獨自按下播放；DV 屏幕裡 Maya 成了 1994 年的遊客殘影。第七聲鑼落下。',
      },
      priority: 4,
      condition: {
        all: [
          { flag: 'finalAction', eq: 'leave' },
          { variable: 'bond', lt: 2 },
        ],
      },
      consequenceClipKey: 'S06D',
      endingClipKey: 'E04',
    },
  ],
  source: {
    storyBibleVersion: '1.1',
    promptPackVersion: '1.1',
  },
} as const;

export const HU_BAO_REFERENCE_SLOTS = [
  [
    'REF-01',
    'location',
    '现实入口母版',
    '闭园入口台阶、钠灯、潮湿地面、无巨龙。',
  ],
  [
    'REF-02',
    'location',
    '龙口回声母版',
    '同机位的已拆巨龙入口、褪色橙绿与建筑材质。',
  ],
  [
    'REF-03',
    'character',
    '陈澄角色包',
    '全身、头像、服装、红色耳机与银色卡带机。',
  ],
  [
    'REF-04',
    'character',
    'Maya 角色包',
    '全身、头像、橄榄绿外套、相机背带与手持 DV。',
  ],
  [
    'REF-05',
    'location',
    '龙腹船道／控制室母版',
    '潮湿船道、控制室玻璃、旧喇叭、栏杆与检修门。',
  ],
  [
    'REF-06',
    'character',
    '林国声回声包',
    '只允许玻璃反影、CRT 或远处剪影，不提供清晰正脸。',
  ],
  [
    'REF-07',
    'prop',
    '核心道具板',
    '卡带机、母带、Salmah 工牌、事故日志、DV 与证物袋。',
  ],
  [
    'REF-08',
    'location',
    '展览与清晨母版',
    '无机构 logo 的口述史展、清晨入口与地铁站。',
  ],
  [
    'JF-01',
    'join_frame',
    'C2 合流帧',
    '陈澄居中持卡带、Maya 左侧持 DV、控制室玻璃在右。',
  ],
  [
    'JF-02',
    'join_frame',
    'C3 合流帧',
    '湿滑门槛、Maya 靠栏杆失去一步、卡带将滑落。',
  ],
  [
    'JF-03',
    'join_frame',
    'C4 合流帧',
    '两人面对事故日志；湿卡带与 Maya 右掌轻伤统一。',
  ],
  ['JF-04', 'join_frame', 'C5 合流帧', 'Salmah 工牌、双轨控制与两人的手同框。'],
  [
    'JF-05',
    'join_frame',
    'C6 合流帧',
    '陈澄中央、Maya 左、林倒影右，公开与拔带动作清楚。',
  ],
  [
    'S00-FIRST',
    'first_frame',
    'S00 审核首帧',
    '从已审批 S00 Take 提取并独立审核的精确首帧。',
  ],
  [
    'S00-LAST',
    'last_frame',
    'S00 审核末帧',
    '从已审批 S00 Take 提取并独立审核的精确末帧。',
  ],
  [
    'E04-PREBLACK-END',
    'last_frame',
    'E04 黑场前锁定构图',
    '第七声锣结局在最终黑场前到达的锁定尾帧。',
  ],
] as const;
