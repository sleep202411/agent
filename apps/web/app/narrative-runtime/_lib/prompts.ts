/**
 * LLM prompts for the two stages: architect (IP seed → story bible) and writer
 * (bible + state + player action → next turn). Chinese content.
 *
 * The system prompts abstract a "high-concept interactive short-drama"
 * methodology: want-vs-need core conflict, charismatic characters with secrets,
 * 起承转合 four-act pacing with per-act emotion curve + closing hook, a
 * disciplined "golden opening", and personality-diverging choices.
 */

import type { ChatMessage } from "./llm";
import type { IpSeed } from "./ip-seed";
import type { Bible, LiveState, PlaySetup, TurnAction } from "./types";

const ARCHITECT_SYSTEM = `你是顶级互动短剧的「故事架构师」。给你一部 IP 的基本信息,把它设计成一套可玩、可反复游玩的「故事圣经」,供回合引擎驱动。用"高概念"的方式思考,只输出 JSON,字段如下:
- logline: 一句话说清 主角 + 核心冲突 + 赌注。
- coreConflict: 用「想要 vs 需要」写核心冲突——主角表面"想要"的外部目标,与他真正"需要"面对的内在真相,二者矛盾。
- secretTruth: 藏到最后才揭开的隐藏真相,是全剧引擎(绝不开局说破)。
- styleGuide: 一句调性与文风(视觉钩子 + 情绪基调)。
- genre: 2-3 个类型标签(如 悬疑/成长/公路)。
- characters: 3-5 个有魅力的人物 {id, name, role, playable(能否作主角视角), public(是否公开可选), tagline(极具记忆点的一句人设), secret(隐藏动机/秘密), llmBehavior(说话方式与行为逻辑)}。至少 1 个 playable && public 的主角候选,主角要有清晰的"想要"与"需要";配角各有独立动机,非工具人。
- acts: 起承转合四幕,每幕 {stage(qi/cheng/zhuan/he), anchor(本幕核心事件,1句), density(本幕建议关键选择次数,数字), emotionArc(情绪曲线,如 "好奇→慌乱→惊艳"), exitHook(收口钩子)}。起=引入世界观+主角处境+核心冲突的种子;承=堆线索、势力浮现;转=颠覆认知的大反转,呼应 secretTruth;合=闭环或余味。
- clues: 4-6 个 {id, title, detail(揭示的事实), unlockHint(玩家怎样才能挣得)}。关键线索必须玩家行动挣得,不能白给。
- endings: 3-4 个 {id, type, title, condition(触发条件), review(复盘)};至少一个 type 为 "truth" 的真相结局。
据这部剧的世界观、人物、冲突设计,可合理原创扩展。每个字段简洁(一两句),不写长文。全部中文,只输出 JSON。`;

const WRITER_SYSTEM = `你是顶级互动短剧的「回合写手」——集小说家、编剧、导演、游戏主持人于一身。你依据钉死的「故事圣经」、玩家的扮演视角与选择、最近回合,写出下一回合。

【叙事】第二人称中文,像拍电影:先给一个有画面感的场景(视觉钩子),再落到具体动作、细节、情绪,约 120–260 字。每回合至少推进一个戏剧动作(新细节/新阻力/新态度/新代价/新线索),绝不原地复述。只引用圣经里已有的人物、线索、结局;关键线索必须玩家合理行动挣得,不凭空揭示;绝不提前说破 secretTruth。

【节奏·起承转合】按当前幕控制情绪与推进,参考该幕的 emotionArc 与 exitHook:起=引入处境+冲突种子(好奇/不安);承=堆线索/羁绊/阻力(焦虑/步步为营);转=颠覆认知的反转(震惊/崩塌);合=收束或余味。每回合结尾都留一个钩子,让玩家不想停。

【黄金开局·仅 start 回合】开局第一屏决定第一印象,必须同时做到三件事:①让玩家瞬间共情主角处境(他是谁、在哪、被什么困住);②秀出主角的核心能力/最大看点(一个视觉奇观);③埋下核心冲突的种子。给最诱人的选项。

【选项设计】options:2–4 个玩家此刻自然会做的行动 {id, label, intent}。每个选项是一条"不同的人格/路线向量"——在态度、代价、风险上有真实分歧(如 合作示好 / 保持边界 / 顺从好奇去冒险),不要同质化。label 是干净的行动描述(玩家视角),不带括号后果标注;intent 用一个词标该选项走向(如 合作/对抗/冒险/回避/共情)。也可给空数组,让玩家自由输入。

【判定】endingId:仅当某结局 condition 真正满足时填该 id,否则 null。unlockClueIds:本回合玩家新挣得的线索 id(∈ 圣经 clues 且此前未解锁),否则空数组。

只输出 JSON:{"narrative","options","endingId","unlockClueIds","reason"}。`;

export function architectMessages(seed: IpSeed): ChatMessage[] {
  const seedText = [
    `标题: ${seed.title}`,
    seed.subtitle ? `副标题: ${seed.subtitle}` : "",
    seed.summary ? `简介: ${seed.summary}` : "",
    seed.description ? `详情: ${seed.description}` : "",
    seed.genres.length ? `类型: ${seed.genres.join("、")}` : "",
    seed.ageRating ? `分级: ${seed.ageRating}` : "",
    seed.episodes.length
      ? `分集: ${seed.episodes.map((e, i) => `${i + 1}.${e.title}`).join(" / ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: ARCHITECT_SYSTEM },
    { role: "user", content: `IP 信息:\n${seedText}\n\n请据此设计「故事圣经」。只输出 JSON。` },
  ];
}

export function writerMessages(args: {
  bible: Bible;
  live: LiveState;
  setup: PlaySetup;
  action: TurnAction;
  playerText?: string;
  choiceLabel?: string;
}): ChatMessage[] {
  const { bible, live, setup, action, playerText, choiceLabel } = args;
  const role =
    bible.characters.find((c) => c.id === setup.roleId) ??
    bible.characters.find((c) => c.playable && c.public) ??
    bible.characters[0];
  const act = bible.acts.find((a) => a.stage === live.stage) ?? bible.acts[0];

  const biblePrompt = {
    genre: bible.genre,
    logline: bible.logline,
    coreConflict: bible.coreConflict,
    secretTruth: bible.secretTruth,
    styleGuide: bible.styleGuide,
    acts: bible.acts,
    characters: bible.characters,
    clues: bible.clues,
    endings: bible.endings.map((e) => ({ id: e.id, title: e.title, condition: e.condition })),
  };
  const recent =
    live.recentTurns
      .slice(-10)
      .map((tn) => `${tn.role === "player" ? "玩家" : "旁白"}: ${tn.text}`)
      .join("\n") || "(开局)";

  let actionText: string;
  if (action === "start") {
    actionText = "这是开局(起幕)——写黄金开局,严格照【黄金开局】三条来。";
  } else if (action === "continue") {
    actionText = "玩家点了「继续」——推进场景让局势发生新变化,不要复述上一回合。";
  } else if (action === "choice") {
    actionText = `玩家选择了:「${choiceLabel ?? ""}」。据此推进。`;
  } else {
    actionText = `玩家自由输入:「${playerText ?? ""}」。先判断它在当前场景是否成立(合理/受阻/跳跃/无关/破坏规则),再写反馈。`;
  }

  const state = `【玩家扮演】${role?.name ?? "主角"}(${role?.role ?? ""})
【改编方向】${setup.directionKey ?? "suspense"}　【节奏】${setup.pace ?? "standard"}
【当前幕】${live.stage}${act ? ` · ${act.anchor}` : ""}
【本幕情绪曲线】${act?.emotionArc ?? ""}　【本幕收口钩子】${act?.exitHook ?? ""}
【回合数】${live.turnCount}　【已解锁线索】${live.unlockedClueIds.join("、") || "无"}
【最近回合】
${recent}`;

  return [
    { role: "system", content: WRITER_SYSTEM },
    {
      role: "user",
      content: `故事圣经(仅你可见,含隐藏真相):\n${JSON.stringify(biblePrompt)}\n\n${state}\n\n【本回合动作】${actionText}\n\n只输出 JSON。`,
    },
  ];
}
