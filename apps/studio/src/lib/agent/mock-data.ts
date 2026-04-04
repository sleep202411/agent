import type { StoryOutlineResult, CharactersAndScenesResult, StoryboardResult } from "./schemas";

export const MOCK_OUTLINE: StoryOutlineResult = {
  title: "末世：废柴觉醒",
  genre: "科幻 / 动作 / 末世",
  background:
    "2045年，一场全球性的异能风暴席卷地球，90%的人类灭亡。幸存者聚集在各地基地中苟延残喘，而异兽横行于废墟之间。林萧，一个被基地所有人嘲笑的废柴，意外激活了隐藏在体内的SSS级异能核心。",
  conflict: "林萧必须在基地内斗、异兽围攻和神秘组织的阴谋中保护家人并拯救人类最后的希望。",
  oneLiner: "一个末世废柴少年意外觉醒SSS级异能，踏上逆袭之路。",
  videoStyle: "3D, CG动画",
  aspectRatio: "9:16",
  episodes: [
    {
      title: "第1集：废柴逆袭 兽王降临",
      summary: "林萧在基地被欺凌，意外触发异能核心，首次展现惊人力量。",
      script:
        "开场：基地广场，众人嘲笑林萧。突然警报响起，S级异兽「铁甲狼王」突破防线。所有异能者束手无策之际，林萧体内金光爆发，一拳击飞狼王。全场震惊。",
    },
    {
      title: "第2集：徒手撼龙爪",
      summary: "更强的异兽来袭，林萧在战斗中逐渐掌握异能的使用方法。",
      script:
        "铁甲狼王只是先锋。真正的威胁——飞龙级异兽从天而降。林萧在系统引导下学会了能量聚集，徒手接住龙爪一击。但体力透支，昏倒在战场上。",
    },
    {
      title: "第3集：潜龙出渊 一拳擎天",
      summary: "林萧在异空间试炼中突破极限，回到现实世界力挽狂澜。",
      script:
        "昏迷中的林萧进入系统创造的异空间试炼。经历千锤百炼后实力暴涨。醒来时基地已被兽群包围，林萧一拳轰碎兽群，声震百里。",
    },
  ],
};

export const MOCK_CHARACTERS: CharactersAndScenesResult = {
  characters: [
    {
      name: "林萧",
      role: "main",
      personality: "外表冷静内心坚定，为保护家人不惜一切",
      appearance: "棕色短发，破旧战术背心，手臂有金色纹路",
    },
    {
      name: "王强",
      role: "supporting",
      personality: "霸道跋扈，基地队长，后期转变",
      appearance: "高大威猛，黑色战甲，伤疤脸",
    },
    {
      name: "苏晴",
      role: "supporting",
      personality: "温柔坚强，暗中支持林萧",
      appearance: "长发少女，白色防护服",
    },
  ],
  scenes: [
    { name: "基地广场", description: "末日基地中央的露天广场，四周是混凝土防御墙" },
    { name: "废墟外围", description: "基地外荒芜的废墟区，到处是坍塌建筑和锈蚀车辆" },
    { name: "异空间", description: "系统创造的虚拟试炼空间，无尽白色虚空" },
  ],
  props: [
    { name: "SSS级异能核心", description: "林萧体内的能量核心，金色光芒" },
    { name: "贡献点终端", description: "基地通用交易终端，全息屏幕" },
  ],
};

export const MOCK_STORYBOARD: StoryboardResult = {
  storyboards: [
    {
      episodeTitle: "第1集：废柴逆袭 兽王降临",
      shots: [
        {
          shotNumber: 1,
          description:
            "全景镜头：破败的末日基地广场，混凝土墙上布满裂痕，远处天空阴沉。林萧——棕色短发少年，穿着破旧战术背心——独自站在广场中央，四周人群投来嘲讽目光。",
          dialogue: "围观者：又是那个废柴，连E级异能都觉醒不了。",
          narration: "2045年，异能风暴之后，这个世界只尊重力量。",
          cameraAngle: "全景",
          cameraMovement: "推",
          duration: 8,
        },
        {
          shotNumber: 2,
          description:
            "特写：林萧的脸，眼神坚毅但隐忍，嘴角微微抿紧。背景虚化，只有他的面部清晰可见。",
          dialogue: "",
          narration: "林萧已经习惯了这些目光。但今天，一切将要改变。",
          cameraAngle: "特写",
          cameraMovement: "固定",
          duration: 4,
        },
        {
          shotNumber: 3,
          description:
            "中景：基地警报突然响起，红色警示灯闪烁。人群慌乱四散。一只体型巨大的铁甲狼王冲破防线，金属质感的毛发在红光下闪烁。",
          dialogue: "广播：S级异兽入侵！所有战斗人员就位！",
          narration: "",
          cameraAngle: "中景",
          cameraMovement: "摇",
          duration: 6,
        },
        {
          shotNumber: 4,
          description:
            "仰拍：林萧体内突然爆发金色光芒，金色纹路从手臂蔓延至全身。他缓缓抬起拳头，能量在拳头周围凝聚成漩涡。",
          dialogue: "林萧：住手！",
          narration: "",
          cameraAngle: "仰拍",
          cameraMovement: "推",
          duration: 5,
        },
        {
          shotNumber: 5,
          description:
            "侧面：林萧一拳击中铁甲狼王，巨大的冲击波向四面八方扩散。狼王被击飞数十米，撞碎了一面混凝土墙。尘土飞扬中，林萧的身影如战神般屹立。",
          dialogue: "",
          narration: "这一拳，震惊了所有人。",
          cameraAngle: "侧面",
          cameraMovement: "跟",
          duration: 6,
        },
      ],
    },
    {
      episodeTitle: "第2集：徒手撼龙爪",
      shots: [
        {
          shotNumber: 1,
          description:
            "俯拍：基地全景，一只巨大的飞龙型异兽从乌云中俯冲而下，翅膀展开遮蔽半个天空。基地防御炮台开火但毫无效果。",
          dialogue: "王强：所有人撤退！这不是我们能应付的！",
          narration: "",
          cameraAngle: "俯拍",
          cameraMovement: "拉",
          duration: 7,
        },
        {
          shotNumber: 2,
          description: "近景：林萧逆着人流跑向飞龙。他的手臂再次亮起金色纹路，双眼也变成金色。",
          dialogue: "林萧：我来！",
          narration: "",
          cameraAngle: "近景",
          cameraMovement: "跟",
          duration: 4,
        },
        {
          shotNumber: 3,
          description:
            "特写：飞龙巨爪落下，林萧双手举起硬接。地面在他脚下碎裂成蛛网状。两股力量对撞，金色与暗紫色能量交织。",
          dialogue: "",
          narration: "系统提示：能量输出已达临界值。建议立即撤退。",
          cameraAngle: "特写",
          cameraMovement: "固定",
          duration: 6,
        },
        {
          shotNumber: 4,
          description:
            "全景：林萧体力耗尽，金光消散，缓缓倒下。苏晴从远处跑来接住他。飞龙受伤后嘶吼着飞走。",
          dialogue: "苏晴：林萧！你没事吧！",
          narration: "他赢了，但代价是透支了一切。",
          cameraAngle: "全景",
          cameraMovement: "降",
          duration: 8,
        },
      ],
    },
    {
      episodeTitle: "第3集：潜龙出渊 一拳擎天",
      shots: [
        {
          shotNumber: 1,
          description:
            "全景：纯白色的异空间，无尽虚空中漂浮着半透明的蓝色人形全息投影——系统音的化身。林萧站在中央，身体半透明。",
          dialogue: "系统音：欢迎进入试炼空间。你的潜力远超想象。",
          narration: "",
          cameraAngle: "全景",
          cameraMovement: "摇",
          duration: 6,
        },
        {
          shotNumber: 2,
          description:
            "中景：林萧在异空间中与无数虚拟异兽战斗，每次倒下又站起来。金色纹路越来越亮，覆盖全身。",
          dialogue: "",
          narration: "千锤百炼，浴火重生。",
          cameraAngle: "中景",
          cameraMovement: "移",
          duration: 8,
        },
        {
          shotNumber: 3,
          description:
            "近景：林萧猛然睁眼，回到现实。基地外兽群黑压压一片。他站起身，全身金光大盛，脚下地面龟裂。",
          dialogue: "林萧：该结束了。",
          narration: "",
          cameraAngle: "近景",
          cameraMovement: "推",
          duration: 5,
        },
        {
          shotNumber: 4,
          description:
            "仰拍：林萧跃入空中，蓄力一拳。金色能量化作巨大的拳影，如流星般砸向兽群。冲击波席卷整个战场，尘烟百里。",
          dialogue: "",
          narration: "一拳擎天，声震百里。废柴少年的传说，从这一刻开始。",
          cameraAngle: "仰拍",
          cameraMovement: "升",
          duration: 10,
        },
      ],
    },
  ],
};
