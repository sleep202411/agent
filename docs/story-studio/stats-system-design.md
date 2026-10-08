# 影游数值系统设计定稿

> 2026-09-15。分支 `feat/interactive-film-stats-system`。为影游（interactive film，
> Runtime Manifest v2 通道）补齐**标准 GAL 数值能力**：数值变量（好感度 / 资源 /
> 属性 / 标记）、选择效果（加减）、条件分支门槛、条件结局、选项条件显隐。
>
> 范围决策（已确认）：
>
> - **仅影游**。现有文游（纯 LLM 对话）不动；但影游未来会支持图文节点并与文游
>   合并，本语法设计为**与呈现形态解耦**（作用于任意节点 kind），合并时直接继承。
> - **深度 = 标准 GAL 数值**：全部映射到已建好的运行时状态机，**不改
>   experience-engine**。
> - **持久化 = session 级**：单次游玩内有效，刷新重开重置；多章节每章独立。
> - player 级档案（跨会话/跨设备）明确非本期，见 §10。

> 实现状态（2026-09-20）：draft → release → manifest → 引擎的状态、效果、条件和结局链路已有测试；Studio 状态侧栏与情节树编辑、playtest 调试面板已接入。§11 Phase 3 的正式玩家状态 HUD 尚未实现；§9 所述 plot JSON 数值字段仍是目标设计，当前导入格式只接收节点、分镜和资产。下文的 Phase 3/4 描述按目标能力阅读。

后续方向（2026-10-05）：对话编程继续依托影游项目和现有剧情引擎。现有数值定义、条件、效果与 session 语义继续保留；Game SDK 后续通过受控接口连接这份状态，不增加平行数值系统。扩展边界见 [影游自定义与对话编程设计](game-vibecoding-production-design.md)；旧章节和已发布版本不得被静默改义。

## 1. 现状：三层链路与休眠状态机

数值要贯穿的三层（行号基于当前 `develop`）：

| 层           | 文件                                                                     | 现状                                                                                                                                |
| ------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 创作端 draft | `apps/server/src/story-studio/interactive-film.schema.ts`                | **零数值字段**：choice 是无条件指针（:132-138），auto exit 单目标（:251-256），hotspot outcomes 只有 continue/seek/goto（:185-194） |
| 中间产物     | `packages/shared/src/interactive-film-runtime.ts`                        | 结构镜像层：`RuntimeAutoExitSchema`（:257-263）/ `RuntimeChoiceExitSchema`（:265-271）/ `SceneNodeSchema`（:376-399）               |
| 运行时契约   | `packages/shared/src/experience-runtime/` + `packages/experience-engine` | **通用状态机已建成且完整**，但从未被喂过数据                                                                                        |

运行时已具备（全部有实现与校验，勿重复造）：

- 状态定义：`ExperienceStateDefinition`（key 路径 / valueType / scope / initialValue /
  constraints / sensitive），`state.ts:64-199`；作用域语义注释 `state.ts:250-262`。
- 条件：`compare`（7 操作符）+ `exists` + `all/any/not` 递归，`state.ts:201-242`；
  引擎求值 `evaluateExperienceCondition`（engine `runtime.ts:323`）。
- 动作：`state.set` / `state.increment`（`logic.ts:13-27`）；引擎执行
  `runtime.ts:397-418`（**increment 负数合法**，仅类型校验）。
- 事件路由：`when` 条件选路 + 恰一条无条件兜底且必须在最后（`logic.ts:112-168`）；
  导航动作（scene.goto / ending.complete）必须是 route 最后一个动作（`logic.ts:121-140`）。
  **纯效果 route（无导航）合法** —— actions ≥ 1 即可。
- 选项显隐：choice `visibleWhen`（`core-renderers.ts:139`），播放器按状态实时过滤
  （`experience-player.tsx:1583-1587`）。
- 快照恢复：`restoreExperienceRuntime`（engine `runtime.ts:143`）严格校验，未知
  状态/越约束一律拒绝。
- 结局累积：`ending.complete` 写 `completedEndingIds`（engine `runtime.ts:431-436`），
  多结局重复游玩天然支持。

**唯一的空转点**：编译器硬编码 `stateDefinitions: []`
（`story-experience-manifest-compiler.ts:244`），全部条件生成只有 choiceId 匹配一种
（:858-864，helper `eventValueEquals` :968-975）。缺口全在上游：draft 语法、中间层
镜像、编译发射、创作 UI、agent 协议、plot 导入。

前朝遗产（参考语法，不复活实现）：冻结原型
`apps/web/app/play/jinling-v2/_frozen/shared/interactive-film-runtime.ts:39-100`
有 `relationship-at-least` / `adjust_relationship` / `set_flag` / `increment_variable`
——其 UX 语法与本设计的窄语法 1:1 对应。金陵设计圣经的产品原则沿用：
**数值显式、可解释；不做隐藏分数随机改写**。

## 2. 设计原则

1. **窄语法**：创作者与 agent 只见「变量 + 加减 + 与阈值比较」，永不接触
   `ExperienceCondition` / `ExperienceValueExpression` 通用结构。编译器负责降级。
2. **引用只指向已注册 id**：效果/条件引用的变量必须在 `stateVariables` 注册表内
   （与 `authoring-pipeline-design.md` §3 骨架校验同一原则）。
3. **零引擎改动**：所有能力用现有状态机表达；表达不了的不进 v1（进 §10）。
4. **降级方向 = 放宽**：数值引用失效时运行时归一化选择「丢弃效果 / 剥离条件」，
   保游玩不断流；结构性失效沿用现有 flatten 规则。
5. **数值控制走向，不控制内容**：v1 数值只决定「走哪条边 / 能选什么 / 进哪个
   结局」三件事；不改写节点内容本身、不影响交互难度、与付费
   （communityPointPrice）完全隔离。没有隐藏分数随机改写（金陵圣经原则）。

## 3. 核心决策

| #   | 决策                                                                                                  | 理由                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 变量模型 = **扁平注册表**（点分 key，如 `favorability.lin`），放 `storyBible.stateVariables`          | 与运行时状态路径 1:1；好感度等分组只是命名约定 + UI 预设，不做结构化嵌套（YAGNI）。放 bible 与导演流水线第 1 棒产物（`authoring-pipeline-design.md` §2）对齐                                                           |
| D2  | v1 类型 = `number` + `boolean`                                                                        | 覆盖 GAL 标准（好感/资源/属性 + 标记）。string/json 运行时支持但创作端不开（allowedValues 复杂度不配收益）                                                                                                             |
| D3  | 效果挂载点 = choice / hotspot outcome / 节点 onEnter，**不挂路由**                                    | 三处覆盖 GAL 标准叙事；条件路由本身挂效果会让语法交叉爆炸                                                                                                                                                              |
| D4  | 条件 = 变量 vs 字面量比较（不做变量间比较）                                                           | 运行时表达式左右都支持 state，但窄语法收口；阈值比较是 GAL 数值的全部实际用法                                                                                                                                          |
| D5  | **v1 不提供最小值/最大值**                                                                            | 引擎越界会中断播放，而增量累积是路径敏感的；只存展示边界却不限制实际值会误导创作者。v1 状态定义无约束，边界与钳制语义留待有真实需求时一并设计。                                                                        |
| D6  | 条件路由重构 auto exit 为 `routes[]`（有序首匹配），choice/auto 统一 `target: node \| ending \| null` | 与运行时 binding 规则（`logic.ts:150-166`：单一无条件兜底在最后）1:1；ending 作为一等路由目标是条件结局的最小完整表达。存量 draft 用预处理器迁移（仓库已有两次先例：`interactive-film.schema.ts:100-123`、`:396-442`） |
| D7  | 结局注册表放 `storyBible.endings`，编译进 manifest `endings[]`                                        | 与流水线第 1 棒对齐；`film.complete` 合成规则保留（自然收尾 target=null 的语义不变）                                                                                                                                   |
| D8  | 不新增 requiredCapabilities（Phase 3 HUD 除外）                                                       | 状态机是核心语义（semanticRulesVersion 1），老播放器可播带数值的新内容；HUD 渲染器将来按需带能力位                                                                                                                     |

## 4. 创作端窄语法（draft schema 扩展）

### 4.1 变量（`storyBible.stateVariables`，≤ 64 个）

**命名权完全在创作者**：`key` 是技术标识（引用/效果/条件用，稳定不变），`name`
是玩家可见文案——叫信誉值、成长值、友好度、灵力都行。系统对数值语义中立，只做
「数值 + 加减 + 阈值比较」；语义由创作者的命名与剧情设计赋予。变量之间不自动联动
（要联动就在同一挂载点的效果列表里同时 add 多个变量）。

```ts
const StoryStateVariableSchema = z
  .object({
    // 语法 = ExperienceStatePathSchema（common.ts:19-36：点分标识符、≤240、禁保留段）。
    // 实现直接复用 shared 导出，单一来源。
    key: StoryStateKeySchema,
    name: DraftLocalizedTextSchema, // 状态展示名（创作端 / 未来玩家 HUD）
    valueType: z.enum(["number", "boolean"]),
    initialValue: z.union([z.number().finite(), z.boolean()]),
    note: z.string().max(2_000).optional(), // 变量描述，仅用于创作，不进播放器
  })
  .strict()
  .superRefine(/* initialValue 类型匹配 */);
```

当前 UI 通过单一「添加状态变量」入口创建条目，填写名称和类型，自动分配稳定 key；不提供资源、属性、标记预设按钮。

### 4.2 效果（`StoryStateEffect`，每挂载点 ≤ 6 条，同 key 可重复、按声明序执行）

```ts
const StoryStateEffectSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("set"),
        key: StoryStateKeySchema,
        value: z.union([z.number().finite(), z.boolean()]),
      })
      .strict(),
    z
      .object({ kind: z.literal("add"), key: StoryStateKeySchema, amount: z.number().finite() })
      .strict(), // 负数 = 扣减（引擎 :408-418 合法）
  ])
  .superRefine(/* add/set 的 key 必须是 number 型变量；set 值类型匹配 valueType */);
```

挂载点：

```ts
// choice（选中即结算，先效果后导航 —— 导航最后是运行时硬规则）
{ choiceId, label, effects?: StoryStateEffect[], visibleWhen?: StoryCondition,
  target: StoryRouteTarget | null }                     // null = 未连线（画布元数据，语义不变）

// hotspot interaction outcomes（success / failure / timeout 各自可挂）
outcomes: { success: { ...action, effects?: StoryStateEffect[] }, ... }

// 节点 onEnter（clip / world / decision 皆可挂；进入场景即结算）
node.onEnterEffects?: StoryStateEffect[]
```

### 4.3 条件（`StoryCondition`，深度 ≤ 3、比较叶 ≤ 12）

```ts
type StoryCondition =
  | {
      kind: "compare";
      variableKey: StoryStateKeySchema;
      operator:
        | "equals"
        | "not-equals" // boolean 只允许这两个
        | "greater-than"
        | "at-least"
        | "less-than"
        | "at-most"; // number 全集
      value: number | boolean;
    }
  | { kind: "all" | "any"; conditions: StoryCondition[] }
  | { kind: "not"; condition: StoryCondition };
```

挂载点：auto exit 路由的 `when`、choice 的 `visibleWhen`。

### 4.4 路由与结局

```ts
type StoryRouteTarget =
  | { kind: 'node'; nodeId: StoryStableIdSchema }
  | { kind: 'ending'; endingId: StoryStableIdSchema };

type StoryExitRoute = {
  when?: StoryCondition;
  target: StoryRouteTarget | null;   // null = 自然收尾 → 合成 film.complete（现状语义）
};

// auto exit（替换 nextNodeId）：
{ kind: 'auto', routes: StoryExitRoute[] }   // ≤ 8 条；恰一条无 when 且在最后（镜像 logic.ts:150-166）

// hotspot goto 动作：
{ kind: 'goto', target: StoryRouteTarget }   // 无 null：写了 goto 就是连了线

// 结局注册表（storyBible.endings）：
{ endingId: StoryStableIdSchema, title: DraftLocalizedTextSchema,
  kind: z.enum(['success', 'failure', 'neutral', 'hidden', 'custom']) }
```

**存量迁移预处理器**（`InteractiveStoryDraftContentSchema.parse` 时透明改写，同
`:396-442` 模式；存量 build 的 manifest 已冻结在 OSS，不受影响）：

- `choice.nextNodeId: X | null` → `target: { kind:'node', nodeId: X } | null`
- `autoExit.nextNodeId: X | null` → `routes: [{ target: { kind:'node', nodeId: X } | null }]`
- world 节点 exit 同 auto。

## 5. 编译映射（draft → 中间层 → Runtime Manifest）

中间层 `InteractiveFilmRelease` 镜像新增字段（`stateVariables` / `endings` /
choice `effects`+`visibleWhen` / exit `routes` / 节点 `onEnterEffects`），形状同
draft（编译器 `compileIntermediateRelease` 是投影，不发明语义）。

manifest 编译（`story-experience-manifest-compiler.ts`）：

| draft 字段                | manifest 产物                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stateVariables`          | `stateDefinitions`：`{ key, valueType, scope: 'session', initialValue }` —— **无 constraints、不 sensitive**（D5）                                                                                                                |
| choice `effects`          | 该 choice 路由 `actions` 头部插入 `state.set { value: literal }` / `state.increment { amount: literal }`，导航保持最后（`logic.ts:131-140`）                                                                                      |
| choice `visibleWhen`      | choice renderer config `visibleWhen`（播放器已实时过滤）                                                                                                                                                                          |
| auto exit `routes`        | 对应 binding（video → `media-ended`；preview 文本 → `scene.clock-ended`；decision → `scene.entered`）的 `routes`：`when: compileCondition(r.when)` + actions（ending target → `progress.unlock-ending` + `ending.complete` 收尾） |
| 节点 `onEnterEffects`     | 新增 `binding:{nodeId}:enter`（`on: scene.entered`）的纯效果 route —— 无导航 route 合法（`logic.ts:117` actions ≥ 1 即可）；引擎在 `scene.goto` 后自动派发下一场景的 `scene.entered`，链路已通                                    |
| hotspot outcome `effects` | 该 gesture outcome binding route 的 actions 头插（seek/continue 编译出的 renderer.command 不是导航，顺序无碍，统一效果在前）                                                                                                      |
| `storyBible.endings`      | `manifest.endings[]` 全量发射；存在 `target: null` 或未声明任何 endings 的 finite 影片继续合成 `film.complete`（:269-277 现状）                                                                                                   |

条件编译：`compare` → `{ kind:'compare', left: {kind:'state', path: variableKey}, operator, right: {kind:'literal', value} }`；`all/any/not` 直译。manifest 层校验
（state 引用必须已注册）已有（`manifest.ts` 静态校验引用完整性），编译产物天然满足。

## 6. 校验与运行时归一化

**lock 校验**（扩展 `validateInteractiveStoryGameplayReadiness`，
`interactive-film.schema.ts:683-804`）：

- 变量：key 唯一/合法、数量 ≤ 64、类型与初值匹配（boolean 不允许 ordering
  操作符）。
- 引用闭合：effects / conditions / visibleWhen 的 variableKey ∈ 注册表；ending 引用
  ∈ `endings` 注册表；exit route 与 choice 的 node target ∈ 节点集（沿用现有
  unknown-target 检查的位置扩展）。
- 路由结构：routes ≤ 8、恰一条无条件且在最后。
- lint 警告（不阻塞）：孤儿结局（注册未引用）；**一个 decision 的全部 choice 都带
  visibleWhen**（运行时可能全隐藏导致卡死 —— 引擎无兜底，靠警告 + playtest 拦截）。
- locale：变量 `name`、结局 `title` 进入 `runtimeLocalizedCopies` /
  `collectInteractiveStoryRuntimeLocales`（`interactive-film.schema.ts:459-519`），
  缺翻译走现有覆盖检查。

**多语言边界一览**：玩家可见文案（变量 `name`、结局 `title`）全部
`DraftLocalizedTextSchema`，与选项 label 同机制、同覆盖检查、同播放端回退链（同语言
→ 项目默认 → 第一个可用）；数值与阈值语言无关。**故意不本地化**的两处——`key` 是
技术 id（效果/条件引用它，翻译不破坏引用，玩家不可见）；`note` 是创作者备忘（不进
播放器）。

**运行时归一化**（`normalizeInteractiveFilmRuntimeDraft` :816-1016 扩展，降级方向 =
放宽，保游玩）：

- 效果引用被删变量 → 丢弃该效果（记录于归一化结果）。
- 条件引用被删变量 → 剥离该 `when` / `visibleWhen`（选项恢复常显、路由并入兜底）。
- 路由 target 失效 → 丢弃该路由；条件路由全部失效 → 只剩无条件路由；无条件路由也
  缺 → 自然收尾。半成品分支沿用现有 flatten / preview-terminal 规则。
- 未引用的结局保留在注册表（结局列表照发）。

## 7. 运行时行为说明

- **作用域**：全部 session。`scene.goto` 只重置 scene 桶（engine :427），数值跨场景
  存活；重开 = 新 seed 全量重置。充值暂停桥的 checkpoint 快照含完整 state，数值随
  之暂停/恢复，无需额外处理。
- **数值范围**：状态定义无 constraints；v1 数值按效果持续累积，不宣称上限或钳制行为。
- **多结局**：`ending.complete` 累积 `completedEndingIds`（engine :431-436）；
  `hidden` 类结局靠条件路由可达性控制，天然支持。
- **兼容**：无新 requiredCapabilities（D8）—— 已发布播放器无需升级即可播放带数值
  的新 build；数值不改变引擎 API/experience API 版本。

## 8. Studio 创作端（Phase 2）

- 状态侧栏管理**变量列表**（key / 展示名 / 类型 / 初值 / 描述），通过单一新增入口填写名称和类型，不生成预设变量。
- choice inspector：**效果编辑器**（变量下拉 + set/add + 值）与 **visibleWhen 条件
  构建器**（变量 + 操作符 + 阈值；all/any/not 组合，深度受语法上限约束）。
- auto exit inspector：**有序条件路由列表**（上移/下移排序、条件构建、目标选择器
  node/ending/自然收尾）。
- 命名结局在情节树的路线终点直接创建与编辑；底层 `storyBible.endings` 仍保存稳定 ID、标题与类型，供编译和复用。条件边标注 chip（如「好感·林 ≥ 80」）。
- **playtest 调试 HUD**：按技术 key 显示实时变量值（数值变化高亮）。playtest 走同一 manifest
  通道（`story-playtest-source.ts`），零播放器改动即可拿到。

## 9. Agent 创作与 Plot 导入（Phase 4）

- patch 协议（`packages/shared/src/story-agent.ts:479-542`）新增：
  `story_bible.put_state_variable` / `remove_state_variable`、
  `story_bible.put_ending` / `remove_ending`；choice/exit/onEnter 数值字段随
  `put_node` 完整节点载荷自动流经。
- 导演流水线对齐：第 1 棒 `StoryBibleDraft.stateVariables/endings` 与本设计命名
  一致，叶子 schema 收敛 shared（`authoring-pipeline-design.md` §6 既有清理项）。
- plot JSON 导入（`story-plot-import.ts`）新增可选字段：顶层 `stateVariables[]`、
  decision choices `effects[]`、scene 可选 `routes[]`（`when` + `next`）；
  引用闭合校验复用 lock 规则；限流沿用现有（2MB / 500 节点）。

## 10. 明确非 v1（未来扩展）

1. **player 级持久化**：跨会话/跨设备档案依赖尚不存在的 Java player-data 服务
   （`state.ts:250-254` 仅注释提及）。落地时 manifest 增 player-scope 定义 + 合并
   策略，draft 语法加 scope 字段即可，窄语法向前兼容。
2. **跨章继承**：Game Manifest v-next —— 章 N+1 用章 N 结局状态 seed 覆盖初值。
3. **灰显锁定选项**（看得见点不了的「好感不足」提示）：需要 choice renderer 扩展
   （enabledWhen / locked 展示元数据）+ 能力位 bump，按 D8 独立发版。
4. **变量间比较 / 算术表达式 / 钳制增量**：引擎扩展（`state.increment { clamp }` 或
   守卫路由编译）。触发条件：出现真实的「双数值互相约束」叙事需求。
5. **图文节点 / 文游合并**：本语法与呈现解耦（effects/conditions 作用于任意节点
   kind），合并时直接继承；文游侧 LLM 结构化状态是另一份独立设计。
6. **数值遥测**：`telemetryDefinitions` 发射变量变化事件 → 创作者漏斗分析
   （哪条分支没人走、好感分布）。注意 sensitive 语义（`manifest.ts` 禁止 sensitive
   状态进 telemetry）。

## 11. 落地顺序

1. **Phase 1 协议层**：shared 窄语法（effect / condition / route / ending / variable）
   - draft schema 扩展 + 存量迁移预处理器 + 中间层镜像 + manifest 编译器发射 + lock
     校验与 lint + 归一化降级。**引擎往返测试**（用 experience-engine 验收编译产物：
     好感累积 → 门槛路由 → 多结局）。不改引擎一行。**这一步拿到全部语义**。
2. **Phase 2 创作端**：状态变量侧栏 / 效果与条件编辑器 / 条件路由编辑器 /
   情节树内命名结局编辑 / 画布标注 / playtest 调试 HUD + i18n 三语。
3. **Phase 3 播放端**：`core.state-hud` 渲染器（config：entries[] =
   `{ label( localized ), path, format: 'raw' }`，随状态
   实时更新）+ 数值变化浮层（+2 好感）。带新 requiredCapabilities，按「声明了 HUD
   才发射能力位」保证老内容零影响。
4. **Phase 4 Agent / 导入**：patch ops + 流水线对齐 + plot 导入字段。

Phase 1 是语义正解且不依赖任何 UI；Phase 2/3 可并行；Phase 4 独立。

## 12. 测试策略

- **schema 矩阵**：窄语法合法/非法全矩阵（类型不匹配、boolean 用排序操作符、深度
  超限、routes 结构错）；存量迁移黄金样本（对齐 `:396-442` 迁移测试模式）。
- **编译器快照**：draft → manifest 黄金样本（含 stateDefinitions / 条件路由 / 效果
  插入顺序 / 结局注册表）。
- **引擎往返**：场景脚本驱动 —— 初始化 → 连续 choice 结算效果 → 条件路由首匹配 →
  ending 累积；断言状态值与 completedEndingIds。不改引擎，用引擎做验收方。
- **归一化降级矩阵**：删变量后效果/条件/路由的每一种失效组合。
- **lint**：全条件选项警告、孤儿结局警告。
- 双端 `tsc` + `lint` + 既有测试全绿。
