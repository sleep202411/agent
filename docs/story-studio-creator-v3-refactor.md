# Story Studio 创作者端 v3 重构方案(fizzstory 逻辑设计 v3 对齐)

> 输入:老板 PPT《fizzstory的整个逻辑设计3》(2026-07-03,7 页)。
> 方法:差距评估 → 方案 → 3 视角对抗评审(生成时机 / 真源归属 / 管线宿主),
> 全部 SOUND_WITH_FIXES,修正已合入本文。
> 前提:主权数据模型(story_projects / story_drafts / story_releases)**零改动**——
> 草稿是整包 JSONB 快照,内容结构演进对表结构无感。

## 0. PPT 要求 → 本方案的映射

| PPT 要素                                                          | 落点                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| 世界观模板(故事核/人物/道具/场景/地理/历史)                       | analysis schema 补字段(P1/P4)                                         |
| AI 分析文档 + 修改、确认                                          | 现有 Generate + 节点编辑;确认 gate 见 P4                              |
| 高概念 15 HC + 5 对标(logline/钩子/爽点/宣传语/trailer 文案/评级) | 新「概念挑选」阶段(P3)                                                |
| 观众三选:改编方向 / 扮演角色 / 开场方式                           | 创作者端预生成**变体矩阵**(P2),玩家端只做选择                         |
| 起承转合 × 10 类型模板(每幕 4 层 + 步数预算 ~70)                  | 幕(act)结构 + 模板提示词库(P1);步数预算不落创作侧(玩家入场运行时设置) |
| 前 3 步黄金开局                                                   | 开场 = 起幕入场 beats 变体(P2)                                        |
| 衍生品/收藏/trailer                                               | 商业元数据字段 + 既有 IP commerce 管线(P4)                            |

## 1. 三个定调决策(评审确认)

### D1 · 结构生成时机 = 创作者时预生成「变体矩阵」

玩家三选**不触发**任何结构生成;运行时只从发布物中**选择**。理由(评审确认
play-time 生成严格更差):trailer 文案在逻辑上要求方向预先存在(PPT 自身要求);
不可变 release + session 钉版会被打破;每会话结构生成成本无界 + 开局停顿 10-30s;
创作者审阅/预先送审是本产品的质量承诺。

预生成单元(评审修正,比"每方向一份"更宽):

```
变体矩阵 = 方向(≤3) × 开场入场beats(每方向 2-3) × 可扮演角色 POV overlay(≤3)
```

- **开场 ≠ 皮肤**:开场只影响「起」幕的入场 beats + 第一个钩子,承/转/合共享
  ——既让第三选真实存在,又把审阅量控制在 ~6-9 份小 beat 列表;
- **POV overlay**:幕锚点/情绪曲线/收口钩子是按主角视角写的,换扮演角色必须
  在创作者时生成该角色视角的锚点重述(或先标记 POV-中性锚点,仅对主角特定锚点
  出 overlay)。可扮演角色数量必须封顶(2-3)保持可审阅;
- **千人千面的正确来源**:结构是策展的(创作者审过、可预先送审、可出 trailer),
  每个玩家的独特性来自回合引擎在钉死的锚点内**即兴表层文本**,节奏/步数由
  玩家入场时的运行时设置决定。
  ⚠️ 此口径需老板签字确认,避免实现后被以"每人不同结构"重新翻案。

> **课程修正(2026-07-03,已落地)**:起承转合最终定位为**纯生成侧 skill**——
> 模板只进 prompt,acts 计划静默存于 `storyAnalysis`(供第二批编译器读取),
> **画布上没有 act 节点、没有幕徽标**。创作者可见的画布 = root(16:9,右缘
> 角色/剧情/结局/线索四端口)+ 四条横向 lane;剧情链 A→B→C 顺 act 排序,
> beat 的 `actKey` 是不可见结构元数据。本节以下关于"act 节点上画布"的设计
> 按此修正阅读。生成同时改为异步管线(POST 秒回 running 标记 → 后台执行 →
> 客户端轮询草稿;根因:studio Next 代理 ~30s 硬超时 < 模型 45-90s)。
>
> **同判(2026-07-04)**:**步数预算/交互密度整体移除**——玩法节奏是玩家
> 入场时的运行时设置,创作侧模板、契约、校验里零步数词汇(stepBudget/
> interactionCount 已从 act-templates、analysis schema、prompt 删除,
> GENERATOR_VERSION → fizzstory-gen-2)。本文其余提及处按此阅读。

### D2 · 画布 = 结构真源;storySpec 只装画布装不下的

新增节点类型 `act`(幕):data 携带 {actKey 起/承/转/合, anchor, emotionArc,
exitHook, directionKey};plot 节点增加 {actKey, directionKey};
编译器(第二批)读画布节点 + storySpec 附件 ——一并终结「编译真源:画布 vs 分析 blob」
的历史悬案。`storySpec` 段仅存:概念卡候选与选中项、各方向 trailer 文案、开场清单、
POV overlays、世界观补充(道具/场景/历史)、pipeline 状态、generator 版本戳。

评审修正(三条 high 必须做):

1. **storySpec 必须进 autosave**:提升为 React state、进 autosave effect deps 和
   快照签名(现 snapshotBaseRef 是 ref,纯 spec 编辑零保存、必丢数据);懒创建触发
   从「首个节点」扩展为「首个有意义动作」(选中概念 OR 首节点 OR 启动生成);
2. **方向 tab 是瞬态 UI 状态**:hidden 在 render 时由 activeDirectionKey +
   node.data.directionKey 派生,**序列化剥离 hidden**——否则切 tab = 草稿写入 +
   revision bump + 列表 updatedAt 污染;切 tab 清空选区;
3. **schemaVersion 升 v2 + 服务端降级写保护**:parse 会把未知节点 kind 强转
   storyRoot(旧客户端打开 v2 草稿会静默毁坏 act 节点),PUT /draft 需拒绝
   schemaVersion 低于已存版本的写入(409/422)。

其余:act 节点 `deletable:false`(幕完整性是结构不变量,删幕走显式操作而非 canvas
删键);节点 id 带 directionKey 命名空间(`plot-${directionKey}-${ts}-${i}`);
快照签名计算挪进 700ms debounce 内(现在每次拖拽 render 都全量 stringify,变体
矩阵会放大该成本);共享节点(root/角色/线索)不按方向复制,无 directionKey =
全方向可见。

### D3 · 生成管线 = 分段 + **宿主搬到 Nest**

分段(评审确认这是被 UX 强制的——概念挑选/方向确认是人肉决策点,单次大调用
不可行且必爆 max_tokens):

```
S1 世界观提取(现 analyze,保留) → S2 概念 15+5 → [创作者挑选]
→ S3 每方向幕结构(10 类型模板注入 prompt) → S4 每幕 beats(可与 S3 合并)
S3 各方向并行调用;S2-S4 输入 = S1 的 digest + 选中概念,不再重传原文档
(S1 的输出就是压缩——评审确认,否则 60K 原文 × 每段重传,token 成本数倍)。
```

**宿主从 studio Next route 迁到 Nest story-studio 模块**(评审 high +
better-alternative):`STORY_STUDIO_LLM_*` 目前只在 `.env.local`,studio pod 在
helm 里明确无 secretRef——是已知的 prod 500 隐患;Nest 已拥有草稿域和密钥管道,
生成端点放在 `/aurora/story-projects/:id/generate/*` 下,阶段产物直接持久化进
draft.storySpec(pipeline {stage, status, error}),天然可断点续跑。
「启动生成」即懒创建项目,使阶段产物有处可存。

工程纪律(评审修正):共享 llm-call helper 先行(AbortSignal.timeout ~90s、
一次有界重试、统一错误形状、requestId)——现 analyze 路由零超时,禁止复制三份;
Zod 双层校验:宽松 shape 层(coerce/默认值)+ 严格语义层(.refine:幕数=4、
概念数=15+5)+ 一次带校验错误的修复重试(即 LLM Output Compliance
备忘里的 layer-3 配方);`GENERATOR_VERSION` + templateId + model 戳进每段产物
(现在不戳,以后无法追溯);模板表用 locale 中性 key(setup/development/…)+
每 locale 标签,输出语言在每段 prompt 显式声明(storyboarder 63f4b03 配方)。

## 2. v1 → v2 兼容

- 存量 v1 草稿 **upgrade-on-open**:首次以 v3 客户端打开时,在客户端合成默认
  方向(取 storyAnalysis.adaptationDirection)+ 4 个 act 节点,按链位把既有 plot
  归幕,schemaVersion 升 v2 —— 与 normalizeLegacyStoryRootLayout 同类的一次性
  迁移惯例;
- 服务端 PUT /draft 降级写保护(见 D2-3);
- 新客户端 parse 对未知 kind 保留原样(不再强转 storyRoot)。

## 3. 对第二批(编译/发布)契约的前置要求

- runtimeJson v2 携带完整变体矩阵;session 钉 (releaseId, directionKey,
  openingId, povOverlayId?);
- **R6 发布前置校验升级为逐 cell**:每个 (方向×开场×POV) 单元独立校验
  线索/结局可达性、幕字段完整性,400 指明失败 cell——否则一个方向
  的坏编辑会借另一方向的通过静默上线;
- 每个变体带 reviewed/confirmed 标记,未全确认不可发布(防"只看了方向 A 就
  发布,玩家抽到没人看过的方向 C");
- 试玩编译重建时以「当前方向的可见节点」为输入,兼作发布前结构自检。

## 4. 分期

| 期              | 内容                                                                                                                               | 备注                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **P1 幕结构**   | act 节点 + acts 进 analysis + 10 类型模板库 + 画布按幕分组 + v1→v2 升级 + **生成宿主迁 Nest + llm helper** + storySpec 进 autosave | 单方向;宿主搬迁是后续所有 stage 的地基,且顺手修 prod 密钥隐患 |
| **P2 变体空间** | 方向×开场×POV 预生成 + 方向 tab(瞬态)+ 逐变体 review 标记 + **契约文档更新**                                                       | 必须在编译器动工前完成                                        |
| **P3 高概念**   | S2 概念端点 + 挑选 UI + 概念入 storySpec                                                                                           | 与 P2 相互独立,可并行/先做                                    |
| **P4 收尾**     | 商业字段(爽点/宣传语/评级)、道具/场景生成、修改后确认 gate                                                                         | 商业字段直接喂 IP 封面/trailer 管线                           |

## 5. 待拍板(2 项,阻塞点标注)

1. **千人千面口径**(阻塞 P2 对外承诺):结构=策展、表层=即兴,需老板确认;
2. **线索的地位**(阻塞 analysis schema 定稿):建议从"常驻第四组"降为
   悬疑/侦探类型的组内要素;P1 期间保持现状不阻塞。
