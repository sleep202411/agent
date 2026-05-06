/**
 * Mock data for the Produce wizard while the consult endpoint isn't
 * wired yet. Lets us iterate on layout / interaction patterns without
 * waiting on the backend. Replace with real data sources tab-by-tab
 * once `/aurora/assistant/consult` ships.
 */

export interface ScriptSummary {
  videoStyle: string;
  aspectRatio: string;
  protagonist: string;
  storyType: string;
  synopsis: string;
  background: string;
  setting: string;
  oneLiner: string;
}

export interface EpisodeMock {
  no: number;
  title: string;
  fullScript: string;
}

export interface AssetCardMock {
  id: string;
  name: string;
  description: string;
  imagePrompt: string;
  /** Solid color hex used as the placeholder thumbnail until image-gen runs. */
  thumbColor: string;
}

export interface EpisodeVideoMock {
  no: number;
  title: string;
  /** Solid color stand-in for the per-episode hero image until video gen runs. */
  thumbColor: string;
  /** Duration shown overlaid on the thumbnail, MM:SS. */
  durationDisplay: string;
  characterCount: number;
  sceneCount: number;
  shotCount: number;
  storyboardStatus: "not-started" | "draft" | "ready";
  videoStatus: "not-started" | "generating" | "ready";
}

/** Mock project title — would come from project metadata in real wiring. */
export const MOCK_PROJECT_TITLE = "重返1999：错过你二十年";

// ─── Script ─────────────────────────────────────────────

export const MOCK_SCRIPT_SUMMARY: ScriptSummary = {
  videoStyle: "都市写实, 暖色调, 电视剧风格",
  aspectRatio: "9:16",
  protagonist: "林知遥",
  storyType: "都市言情 / 时光重启",
  synopsis:
    "三十岁的林知遥在一次车祸后醒来，发现自己回到了 1999 年的高三教室。窗外是十七岁那年的夏天，前排坐着她错过了二十年的少年陆衍之。带着前世的全部记忆，她决定不再走那条让所有人遗憾的旧路——这一次，她要把他们都留下。",
  background:
    "故事时间回到 1999 年中国南方小城。主要场景包括县一中老校区、林家面馆、城南录像厅、陆家旧宅、毕业晚会礼堂。",
  setting:
    "重生设定：知遥保留了重生前所有记忆，但身体素质回到 17 岁。她无法改变重大历史事件（地震、洪水），但可以改变身边人的命运。",
  oneLiner: "她带着二十年的遗憾醒来，要把那个只想说一句喜欢的少年，重新留在自己身边。",
};

export const MOCK_EPISODES: EpisodeMock[] = [
  {
    no: 1,
    title: "回到那年夏天",
    fullScript: `第1集
1-1 日 内 县一中高三(2)班教室
人物：林知遥, 陆衍之, 王老师, 同学若干

△窗外夏蝉鸣叫，吊扇吱呀作响。墙上的挂历停在 1999 年 6 月 4 日。
△林知遥猛地睁开眼睛，呼吸急促，环顾四周。
△她低头看见自己穿着白衬衫蓝裙子的校服，桌上摊着一本卷了角的《五年高考三年模拟》。
林知遥OS：这是……我十七岁那年的教室？
△她颤抖着抬头，看见前排那个穿白衬衫的少年正回头看她。
陆衍之（皱眉）：你脸怎么这么白？是不是又熬夜看小说了？
△林知遥死死盯着他，眼眶瞬间通红。
林知遥（声音颤抖）：陆衍之……
陆衍之（不解）：怎么了？
△林知遥伸手隔着课桌握住他的手腕，眼泪砸在课本上。
林知遥OS：上一次我醒来，是在你三十二岁的葬礼上。
`,
  },
  {
    no: 2,
    title: "二十年的眼泪",
    fullScript: `第2集
2-1 夜 内 林家面馆
人物：林知遥, 林父, 林母

△蒸汽从锅里翻涌，林父在灶前下面，林母在小桌上数当天的零钱。
△林知遥走进来，怔怔地看着两个人。
林父（笑）：今天怎么这么早回来？尝尝你妈新做的辣酱。
△林知遥眼眶一热，扑上去抱住林母。
林母（吓一跳）：哎哟，怎么了这是？
林知遥（声音哽咽）：妈，我以后不去深圳了。
△林父和林母对视一眼，都笑了。
林父：你这孩子，离高考还有四十天，先把书念好。
△林知遥用力点头，把脸埋在母亲肩上。
林知遥OS：这一次，我哪里都不去。
`,
  },
  {
    no: 3,
    title: "录像厅的夜晚",
    fullScript: `第3集
3-1 夜 内 城南录像厅
人物：林知遥, 陆衍之, 录像厅老板

△昏暗的厅里在放《重庆森林》，烟雾混着汽水味。
△陆衍之坐在最后一排，手里捏着两张退票。
△林知遥推门进来，目光直接锁定他。
陆衍之（小声）：你怎么来了？
林知遥（坐下）：你不是约我？
陆衍之（怔住）：……我没说出口。
△林知遥看着屏幕上的王菲笑了。
林知遥（轻声）：那这次我就当你说了。
`,
  },
  {
    no: 4,
    title: "你也爱我吗",
    fullScript: `第4集
4-1 黄昏 外 江边小路
人物：林知遥, 陆衍之

△夕阳把江面染成金色，两个人推着自行车并排走。
△陆衍之忽然停下来。
陆衍之：知遥，高考完之后，你想去哪？
林知遥（看着江面）：北京。
陆衍之：那……我也去北京。
△林知遥转过头看他，眼里有水光。
林知遥（一字一顿）：陆衍之，你也爱我吗？
△陆衍之愣住，半晌，把车把扔在地上，伸手抱住她。
陆衍之（声音闷在她肩上）：我从十二岁就爱你。
`,
  },
  {
    no: 5,
    title: "毕业晚会的夜",
    fullScript: `第5集
5-1 夜 内 县一中礼堂
人物：林知遥, 陆衍之, 全体同学

△舞台灯光闪烁，同学们抱着彼此哭笑。
△林知遥站在舞台一侧，身上是水蓝色的连衣裙。
△陆衍之穿着白衬衫上台，对着话筒。
陆衍之（认真）：今天我想唱一首歌，给一个女孩。
△琴声响起，是 1999 年最流行的那首。
△林知遥红着眼睛，从台下慢慢走上台。
△她接过他递来的话筒，跟着他一起合唱。
林知遥OS：上一次我没听完这首歌就跑回家了。
林知遥OS：这一次，我一句一句和他唱完。
`,
  },
];

// ─── Asset library ──────────────────────────────────────

export const MOCK_CHARACTERS: AssetCardMock[] = [
  {
    id: "char-1",
    name: "林知遥",
    description: "30 岁的灵魂回到 17 岁的身体；外表青涩，眼神却带着二十年的疲惫与决心。",
    imagePrompt: "黑色长发, 校服白衬衫蓝裙子, 沉静的眼神, 略带疲惫的微笑, 暖光逆光",
    thumbColor: "#fda4af",
  },
  {
    id: "char-2",
    name: "陆衍之",
    description: "县一中前桌少年，瘦高，微微卷的黑发，手指上有写字磨出的薄茧。",
    imagePrompt: "白衬衫, 微卷黑发, 单眼皮, 安静专注的侧脸, 夏日午后教室光",
    thumbColor: "#93c5fd",
  },
  {
    id: "char-3",
    name: "林母",
    description: "面馆老板娘，常年系着洗得发白的围裙，刀工利落，话不多但藏着温柔。",
    imagePrompt: "中年女性, 浅蓝色围裙, 头发简单挽起, 灶台前的暖黄灯光",
    thumbColor: "#fcd34d",
  },
  {
    id: "char-4",
    name: "林父",
    description: "面馆师傅，沉默寡言但手上功夫了得；女儿是他生活里少有的话题。",
    imagePrompt: "中年男性, 朴素白衬衫卷起袖口, 黝黑手臂, 厨房蒸汽里的剪影",
    thumbColor: "#a3e635",
  },
];

export const MOCK_SCENES: AssetCardMock[] = [
  {
    id: "scene-1",
    name: "县一中高三(2)班教室",
    description:
      "1999 年风格的中学教室；木课桌、绿色黑板、老式吊扇，墙上贴着高考倒计时和泛黄海报。",
    imagePrompt:
      "前景课桌堆满辅导书, 中景吊扇与黑板, 远景窗外蝉鸣中的香樟树, 暖光斜照, 颗粒感胶片质感",
    thumbColor: "#fbbf24",
  },
  {
    id: "scene-2",
    name: "林家面馆",
    description: "南方小城的临街老面馆；蒸汽腾腾，木桌油亮，门口挂着褪色的红色塑料门帘。",
    imagePrompt: "前景面碗与酱油醋瓶, 中景灶台火光, 远景临街灯火, 蒸汽朦胧, 暖橘色调",
    thumbColor: "#f97316",
  },
  {
    id: "scene-3",
    name: "城南录像厅",
    description: "九十年代末的小型录像厅；烟雾缭绕，前后排都是塑料折叠椅，墙上贴满港台电影海报。",
    imagePrompt: "前景观众剪影, 中景投影中的王家卫式画面, 远景墙上的发哥海报, 烟雾光束, 颗粒感",
    thumbColor: "#a78bfa",
  },
  {
    id: "scene-4",
    name: "江边小路",
    description: "傍晚的小城江边步行道；夕阳把江面染金，远处有零星的渔船灯火。",
    imagePrompt: "前景两辆自行车, 中景江面金色波光, 远景渔船灯, 夕阳逆光, 长焦虚化",
    thumbColor: "#fb923c",
  },
];

export const MOCK_PROPS: AssetCardMock[] = [
  {
    id: "prop-1",
    name: "1999 年挂历",
    description: "教室墙上的挂历，停在 6 月 4 日；红色字体的高考倒计时在边角。",
    imagePrompt: "1999 年风格挂历, 红色高考倒计时, 黄色纸面, 顶光",
    thumbColor: "#ef4444",
  },
  {
    id: "prop-2",
    name: "卷边的五年高考三年模拟",
    description: "知遥的桌上书；扉页有她重生前从未留意的少年留言。",
    imagePrompt: "卷边的高考辅导书, 蓝色封皮, 翻开的扉页有铅笔字, 浅景深",
    thumbColor: "#3b82f6",
  },
  {
    id: "prop-3",
    name: "两张录像厅退票",
    description: "陆衍之手里没说出口的那次邀约；票面是手写编号。",
    imagePrompt: "两张电影退票, 手写编号, 微微卷边, 浅木桌面, 顶光",
    thumbColor: "#facc15",
  },
];

// ─── Per-episode video ──────────────────────────────────

export const MOCK_EPISODE_VIDEOS: EpisodeVideoMock[] = [
  {
    no: 1,
    title: "回到那年夏天",
    thumbColor: "#fda4af",
    durationDisplay: "01:25",
    characterCount: 6,
    sceneCount: 1,
    shotCount: 8,
    storyboardStatus: "ready",
    videoStatus: "ready",
  },
  {
    no: 2,
    title: "二十年的眼泪",
    thumbColor: "#93c5fd",
    durationDisplay: "01:34",
    characterCount: 7,
    sceneCount: 1,
    shotCount: 8,
    storyboardStatus: "ready",
    videoStatus: "ready",
  },
  {
    no: 3,
    title: "录像厅的夜晚",
    thumbColor: "#a78bfa",
    durationDisplay: "01:10",
    characterCount: 10,
    sceneCount: 2,
    shotCount: 7,
    storyboardStatus: "ready",
    videoStatus: "ready",
  },
  {
    no: 4,
    title: "你也爱我吗",
    thumbColor: "#fcd34d",
    durationDisplay: "01:55",
    characterCount: 2,
    sceneCount: 1,
    shotCount: 10,
    storyboardStatus: "ready",
    videoStatus: "ready",
  },
  {
    no: 5,
    title: "毕业晚会的夜",
    thumbColor: "#fb923c",
    durationDisplay: "01:22",
    characterCount: 4,
    sceneCount: 1,
    shotCount: 7,
    storyboardStatus: "ready",
    videoStatus: "ready",
  },
];
