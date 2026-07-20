# 文游创作端 · 关键剧情锚点化设计(v0.1)

> 2026-07-19。目标:把 text_adventure 的"文字场景"升级为"关键剧情"锚点,创作者写骨架,LLM 演旅程。
> 兼容底线:**自由度默认 0 = 完全等价于今天的静态播放**,老项目零迁移,LLM 逐节点显式开启。

## 1. 心智转变

|            | 今天(文字场景)     | 目标(关键剧情)                                                      |
| ---------- | ------------------ | ------------------------------------------------------------------- |
| 节点是什么 | 玩家读到的全部内容 | 故事**必经的锚点**,必达事件+约束                                    |
| 节点之间   | 直接跳转           | LLM 即兴的"自由段"(0~N 回合)                                        |
| 玩家输入   | 点预设选项         | 自由文本 + 快捷选项;自由输入由 LLM **归并**到作者选项或段内自由行动 |
| 作者控什么 | 每一个字           | 骨架、事实、边界、节奏                                              |

## 2. 节点字段演进(关键剧情)

```
title            索引标题(兼作播放端章节卡)         ← 现有 title
body → opening   定场文本(可选):到达锚点时原文渲染;   ← 现有 body 原样迁移
                 留空则由 LLM 依据锚点事件叙述
anchorEvent      锚点事件(必达):此节点必须发生什么     ★ 新增,自由度>0 时必填
musts[]          必达事实:离开此锚点时已成立的事实      ★ 新增(≤10 条)
convergenceHint  收束提示:引导 LLM 从自由态收拢的过渡指令 ★ 新增(可选)
freedom          自由度 {min,max}:到下一锚点的自由回合区间 ★ 新增,默认 {0,0}
exit             出口(auto/choice/checkpoint/ending)   ← 不变
```

**自由度 0 的语义**:定场文本照本宣科 → 直接出口,即今天的行为。这使 P1(schema+文案)可以先行发布而不欺骗创作者。

## 3. 圣经层(2026-07-19 简化定案:零新增,反而删三)

用户拍板走极简:**不加 voice/bans**(文风与禁忌写进 worldview 即可),并且**删除 storyRules/locations/props**(查证为运行时零消费者、UI 编辑器早已孤儿化)。圣经最终 = logline/synopsis/worldview + characters(name/summary/形象图/音色) + stateVariables + endings。节点层同样零新增字段:锚点信息写在正文里,自由回合数做运行时全局参数(呼应"步数=玩家入场设置"决策)。

## 4. LLM 发挥的控制面(运行时契约,借 ip-direct 的 turn 模式)

每个自由回合一次调用,结构化输出四段:

1. `narration` 叙事文本(高温自由);
2. `effects[]` 声明式状态变更(引擎校验,复用现有 effects 体系;LLM 无权直改状态);
3. `converged` 是否满足去往下一锚点的条件(布尔+理由);
4. `suggestions[3]` 下回合快捷选项(锚点处则替换为作者的 choice)。

硬约束:回合数到 `freedom.max` 强制收束;musts/bans/storyRules/voice 每回合注入;自由输入先经归并判定(命中作者选项→走图;否则段内自由行动)。重 roll 只重生成 narration,已结算 effects 不回滚。

## 5. 画布与检查器表达

- 节点卡:eyebrow 从"文字场景"→"关键剧情";卡上显示自由度徽标("自由 2–6 回合"/"直接衔接");
- 锚点间连线:自由度>0 时渲染为**虚线**(即兴区间),0 为实线(硬衔接);
- 检查器:新字段分组"锚点约束"(锚点事件/必达事实/收束提示/自由度滑块)。

## 5.5 已落地(2026-07-19,创作者试玩 · Nest only)

**玩家端归 Java**——公开游玩运行时由 Java 实现;下面这套是 studio 内创作者对草稿的试玩,且是 Java 玩家端照抄的**参考契约**。

- **服务** `story-text-play.service.ts`:静态引擎(router 条件解析/choice 门控/effects 结算/ending)+ 自由回合(复用 patch-author 的 qwen 调用栈)。`freeTurnLimit:0` = 零 LLM,退化为纯静态播放。
- **turn 契约**(events 序列):`anchor`(锚点定场)/`narration`(自由叙事)/`choices`(带门控过滤)/`suggestions`(LLM 建议行动)/`ending`/`end`。action:`{choice}` / `{free}` / `{continue}`。state 无服务端会话——客户端持有 state 每回合回传(与 ip-direct 一致,便于 Java 无状态实现)。
- **LLM 约束**:narration 结构化输出 `{narration, effects[], converged, suggestions[]}`;effects 经 `effectAllowed` 白名单(只认已声明的状态变量/角色),LLM 无权直改状态;到 `freeTurnLimit` 强制收束。
- **接口** `POST /aurora/story-projects/:id/text-play/{start,turn}`(仅 text_adventure,复用 story.read 鉴权)。
- **UI** studio playtest 路由按 format 分流:text_adventure 草稿 → `StoryTextPlayPanel`(小说流 + 锚点卡 + 选项 + 自由输入 + 建议 chips + 状态角标 + 结局),其余走原 manifest runtime。
- **测试**:静态引擎 6/6(server 355 全绿),studio 256 全绿。⬜ 自由回合的 LLM 路径需起 Nest + ALIBABA_API_KEY 做真机 E2E(单测未覆盖真实模型)。

## 6. 落地三阶段

- **P1 创作端**(先行,零运行时风险):schema 新字段(默认值兼容)+ 三语言文案改名 + 检查器/画布 UI + AI 编剧契约扩展(代理起草锚点而非全文);
- **P2 播放端**:turn loop 服务(契约同 §4,骨架借 ip-direct)+ 玩家 UI(小说流 + 自由输入 + 三选 chips + 状态角标 + 章节卡 + 结局收集);
- **P3 创作调试**:创作端试玩(带 LLM 的 working preview)+ 收束轨迹视图(每回合的判定/耗时/成本)。

## 7. 不变的东西(刻意)

图拓扑工具、router 条件路由、choice 条件/效果、endings、状态变量、角色资产(形象图/音色)——全部原样复用。这是扩展,不是重写;文游与互动影视共享同一张图,只是节点的"演出方式"不同。
