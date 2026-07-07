# 文字游戏 Narrative Play — 后端接口契约 v1(IP 直玩 · 无创作者版)

> 状态:需求草案,发后端前待确认(§10 开关未定)。
> 目标读者:后端、Web 玩家端。
> 版本变更:本文 **v1 取代 v0**。v0 是「创作者授权 → 编译 → 发布 runtimeJson release → 玩家端读 release」
> 的模型;v1 砍掉整条创作者/编译/发布链路,改为 **IP 直玩、无预设、每局实时生成**。
> v0 全文在 git 历史里(`git show HEAD~1:docs/narrative-runtime-java-api-v0.md`)。
> 玩家端 LLM 写作规则参考:`docs/narrative-player-runtime-writing-skill-v1.md`(其 `inputType` 与本文 `action` 一一对应)。

---

## 0. 模型:v0 → v1 的变化

**v1 的核心命题:没有创作者、没有编译、没有发布物。每个已上架 IP 直接有一个「开始游玩」入口;玩家进场前先生成并选择高概念候选;进场时,后端基于 IP 基本信息 + 选中的高概念用 LLM **实时生成本局故事**,钉在服务端会话里,玩家端只看到开场和逐回合渲染。**

- ❌ 不再有:创作者画布、`runtimeJson` 发布物、`StoryRelease`、编译器、`/internal/narrative/stories` 发布接口、story 详情/列表接口(IP 自己的列表/详情页复用现有 IP 模块)。
- ✅ 只剩三个玩家端接口:**概念候选**(进场前生成高概念选项)、**进场**(生成世界观 + 建会话 + 返回可选项清单)、**回合**(提交选择开局 + 逐回合推进)。
- 「本局故事」是 **机器生成、单会话、临时** 的 —— 不是人工授权、不落发布库、不跨玩家共享(是否缓存见 §10)。这就是「无预设」:没有任何人预先设定数据。

### 三个 LLM 调用点(后端各实现一次)

| 阶段   | 触发              | 角色           | 产物                                                                                                |
| ------ | ----------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| ⓪ 概念 | 进场前 `concepts` | **概念策划**   | 3–6 个玩家可见高概念候选。只用于选择创作方向,不创建会话。                                           |
| ① 架构 | 进场 `enter`      | **故事架构师** | 本局「故事圣经」(§6):secretTruth / 起承转合四幕 / 人物 / 线索 / 结局。生成即钉进会话,会话内不可变。 |
| ② 回合 | 每个回合 `turns`  | **回合写手**   | 单回合渲染:正文 + 选项 + 结束标记。线索揭示、结局正文都写进正文;只能引用①钉死的圣经。               |

### 链路

```mermaid
flowchart LR
  P["玩家在 IP 页点「开始游玩」"] --> C["POST /concepts"]
  C --> H["玩家选择一个高概念候选"]
  H --> E["POST /enter(带 selectedConceptMarkdown)"]
  E --> B["后端: 取 IP 种子 + 选中概念 → LLM① 生成圣经 → 钉会话 → 返回清单(角色/方向/节奏)"]
  B --> S["玩家选 setup → POST /turns (action:start, 带 setup)"]
  S --> F["后端: LLM② 写第一幕 → 返回回合"]
  F --> T["POST /turns (continue/choice/free)"]
  T --> W["后端: 读圣经+状态 → LLM② 写手 → 校验/归一化/脱敏 → 返回本回合"]
  W --> T
```

---

## 1. 名词

- **会话 session**:一次游玩。后端持有全部运行状态,前端只持 `sessionId`。
- **圣经 bible**:进场时生成、钉在会话里的本局故事结构(§6)。**含剧透,绝不下发前端。**
- **种子 seed**:后端喂给 LLM① 的 IP 基本信息(§2)。
- **高概念 concept option**:进场前生成的玩家可见创作方向。它是后续 `enter` 的创作策略,不是故事圣经,不含隐藏真相。
- **脱敏 redact**:凡是含答案的字段(secretTruth / 线索解锁提示 / 结局触发条件 / 人物隐藏行为 / LLM 日志)都不进任何前端响应。

---

## 2. 数据来源:IP 种子

`concepts` / `enter` 时调用方必须把 IP 内容作为 `ipStory` 传给 Java。`ipId` 只用于关联、权限校验、日志和埋点,不作为生成内容来源。

当前版本 `ipStory` 可以直接使用 IP 的 description。现有 Web 调用会把 IP title / subtitle / summary / description / episode summaries 拼成一个字符串后放进 `ipStory`;若后续有用户上传的小说/剧本文本,也放进同一字段。Java 不关心其内部字段结构。

> `ipStory` 越丰满,高概念和进场圣经质量越高。最小可用输入就是当前 IP description。

`concepts` 与 `enter` 使用同一份 `ipStory`。区别是:`concepts` 只产出玩家可见的方向候选;`enter` 必须读取玩家选中的候选,再生成服务端内部圣经。

---

## 3. 接口 ⓪ 高概念候选 `POST /api/player/narrative/concepts`

**进场前调用**:玩家点「开始游玩」后,前端先调用本接口生成高概念候选,展示给玩家选择。选中后再调用 `enter`。本接口不创建会话,不返回剧情回合,不返回隐藏真相。

### 3.1 请求

```jsonc
{
  "ipId": "018f...uuid", // 必填。必须是已上架/可玩 IP
  "locale": "zh-CN", // 必填。运行语言
  "ipStory": "IP description / 用户上传小说或剧本文本", // 必填。生成依据正文
  "count": 6, // 可选。默认 6,建议 3–6
}
```

> Java 不按 `ipId` 反查 IP 正文。调用方必须传 `ipStory`,Java 直接用 `ipStory` 生成高概念候选。

### 3.2 响应

```jsonc
{
  "ipId": "018f...uuid",
  "items": [
    {
      "id": "HC-01",
      "contentMarkdown": "【高概念 HC-01】\nLogline：...\n\n类型标签：...\n\n核心冲突：...",
    },
    {
      "id": "HC-02",
      "contentMarkdown": "【高概念 HC-02】\nLogline：...\n\n类型标签：...",
    },
  ],
}
```

字段约束:

| 字段              | 说明                                                       |
| ----------------- | ---------------------------------------------------------- |
| `items[].id`      | 本批内唯一即可,建议 `HC-01` / `HC-02`。不再单独返回 `code` |
| `contentMarkdown` | 玩家可见 Markdown。前端直接渲染,也可用于复制/分享          |

`contentMarkdown` 推荐包含:

```md
【高概念 HC-01】
Logline：...

类型标签：...

核心冲突：...

视觉钩子：...

爽点/卖点：...

反差与颠覆：...

一句宣传语：...

Trailer文案（15秒）：...
```

### 3.3 后端职责

1. 读取请求里的 `ipStory`(§2)。
2. **LLM⓪ 概念策划** → 生成 `count` 个高概念候选。
3. 校验 `items` 非空、`id` 本批唯一、`contentMarkdown` 非空。
4. 返回候选列表。候选内容均为玩家可见,不得包含隐藏真相、系统 prompt 或服务端日志。
5. 不要求后端缓存候选批次;前端在 `enter` 时回传用户选中的 `selectedConceptMarkdown`。

---

## 4. 接口 ① 进场 `POST /api/player/narrative/enter`

**重调用**:生成圣经并建会话,返回给玩家挑选的清单。玩家点「开始游玩」后等待此调用(前端显示「正在生成你的故事…」)。**不产出剧情** —— 剧情从第一个 `turns`(`action:start`)开始。

### 4.1 请求

```jsonc
{
  "ipId": "018f...uuid", // 必填。必须是已上架/可玩 IP
  "locale": "zh-CN", // 必填。运行语言
  "ipStory": "IP description / 用户上传小说或剧本文本", // 必填。生成依据正文
  "selectedConceptId": "HC-01", // 可选。来自 concepts.items[].id,供日志/埋点/展示用
  "selectedConceptMarkdown": "【高概念 HC-01】\nLogline：...\n\n类型标签：...", // 必填。来自 concepts.items[].contentMarkdown
}
```

> setup(观众三选)不在进场时传 —— 它从本接口返回的清单里选,随第一个 `turns`(`action:start`)提交。
> Java 不按 `ipId` 反查 IP 正文。调用方必须再次传 `ipStory`,Java 用 `ipStory + selectedConceptMarkdown` 生成本局圣经。
> `enter` 必须基于选中的高概念生成本局圣经。前端直接回传 `selectedConceptMarkdown`;`selectedConceptId` 只是同批候选里的编号,后端可用于日志/埋点,不得依赖它查回候选正文。

### 4.2 响应

进场只返回**给玩家挑选的清单**(观众三选),不含剧情回合。

```jsonc
{
  "sessionId": "sess_9f2c8b...", // 后续回合凭证
  "ipId": "018f...uuid",
  "locale": "zh-CN",
  "prologue": "开场氛围文字(玩家可见,可空)—— 供选择界面铺垫,不是剧情回合",
  "setupOptions": {
    "roles": [
      // 角色对象 list —— 取自圣经中 playable && public 的角色
      {
        "id": "role_lin",
        "name": "林风",
        "role": "转学生",
        "tagline": "刚转入这所诡异学校",
        "profileMarkdown": "### 角色定位\n转学生 / 调查者\n\n### 外表特征\n...\n\n### 背景故事\n...\n\n### 在故事中的处境\n...",
      },
      {
        "id": "role_sis",
        "name": "姐姐",
        "role": "陪读家属",
        "tagline": "对弟弟隐瞒着什么",
        "profileMarkdown": "### 角色定位\n陪读家属 / 隐瞒者\n\n### 外表特征\n...\n\n### 背景故事\n...\n\n### 在故事中的处境\n...",
      },
    ],
    "directions": [
      // 改编方向 list —— 后端按本 IP 从固定清单挑合适子集(§附.1)
      { "key": "suspense", "label": "悬疑" },
      { "key": "growth", "label": "成长" },
    ],
    "paces": [
      // 节奏 list(§附.2)
      { "key": "slow", "label": "慢热" },
      { "key": "standard", "label": "标准" },
      { "key": "compact", "label": "紧凑" },
    ],
  },
  "defaults": { "roleId": "role_lin", "directionKey": "suspense", "pace": "standard" }, // 玩家不选时的缺省
}
```

> **不返回结局清单**:进场就列出结局 = 剧透。若要「本局有 N 种结局待解锁」这类**非剧透诱饵**,见 §10 #8。

### 4.3 后端职责

1. 读取请求里的 `ipStory`(§2)。
2. 读取 `selectedConceptMarkdown`;如有 `selectedConceptId`,可记录到日志/埋点。
3. **LLM① 故事架构师** → 基于 IP 种子 + 选中高概念生成圣经(§6)。方向/节奏是**游玩期镜头**(writing-skill §4),不改核心事实,故此处一次生成与具体方向无关的核心圣经即可。
4. 校验圣经(§7.2);不过则带错误 **一次修复重试**,再不过 → 503。
5. 建会话,钉 `bible` + 初始 `live` 状态(`setup=null, stage=qi, risk=0, turnCount=0, unlockedClueIds=[]`)。
6. 从圣经派生 `setupOptions`:`roles`=`playable&&public` 人物;`directions`=按本 IP 从固定清单挑的合适子集;`paces`=固定三档。
7. 角色对象必须包含 `profileMarkdown`,供前端在角色选择界面直接 Markdown 渲染。
8. **脱敏**后返回清单。圣经绝不下发,第一幕不在此产出。

---

## 5. 接口 ② 回合 `POST /api/player/narrative/turns`

一个接口吃全部动作。`action` 四种(含开局),区别见 §5.3。

### 5.1 请求

```jsonc
{
  "sessionId": "sess_9f2c8b...", // 必填
  "action": "start", // start | continue | choice | free
  "setup": {
    // 仅 action=start:玩家从进场清单里选的三项;缺省用 enter 的 defaults
    "roleId": "role_lin",
    "directionKey": "suspense",
    "pace": "standard",
  },
  "choiceId": "a1", // 仅 action=choice 时必填,取自上一回合 options[].id
  "text": "我上前盘问保安", // 仅 action=free 时必填,玩家自由输入
}
```

### 5.2 响应(所有 action 同形状,含 start 返回的第一幕)

```jsonc
{
  "narrative": "本回合正文,前端直接渲染。线索揭示、结局正文都写在这里",
  "options": [{ "id": "a2", "label": "对比登记表和通知书日期" }], // 0–3 个;空=本回合只自由输入
  "finished": false, // false=可继续;true=已结束(结局正文即本回合 narrative)
}
```

> 只有三个字段。线索面板 / 风险表 / 结局卡 / 进度 / 说话人 / 媒体都不进 v1 契约 —— 线索与结局揉进 `narrative`,机制仍由服务端圣经保证(§6/§7)。

### 5.3 四种 action 的区别

| action       | 前端触发                              | 携带       | 后端处理                                                              | 有玩家行为待判定 |
| ------------ | ------------------------------------- | ---------- | --------------------------------------------------------------------- | ---------------- |
| **start**    | 进场选完 setup 点「开始」(每局仅一次) | `setup`    | 把 setup 记进 `live`,LLM② 写**第一幕**(起幕开场 + 首批选项)           | 无(开局)         |
| **continue** | 「继续」按钮                          | 无         | 纯推进:时间前进 / NPC 反应 / 压力升级,不重复上一回合                  | 无               |
| **choice**   | 点某个预设 `options` 芯片             | `choiceId` | 按该选项对应的**已知意图**推进(干净、可控)                            | 有,意图明确      |
| **free**     | 自由输入框                            | `text`     | 先判定该输入在当前场景成不成立(合理/受阻/跳跃/无关/破坏规则),再写反馈 | 有,开放,需先解析 |

### 5.4 后端职责

1. 取会话;不存在/过期 → 410。`action=start` 但已开局 → 409;非 `start` 但未开局 → 409。
2. `action=start`:把 `setup`(缺省用 `defaults`)写进 `live`;`roleId` 为空则取圣经主角。
3. 组 LLM② 输入:`bible` + `live`(setup / turnCount)+ `recentTurns`(最近 8–12 回合)+ 本次 `action/choiceId/text`。
4. **LLM② 回合写手** → 内部 output(§7.3)。
5. **校验 + 归一化 + 防作弊**(§7.4)。
6. 更新 `live`(`turnCount++`、append `recentTurns`)。配速由 LLM 依 `turnCount` + 圣经 `acts` 自行把握,后端不存 stage。
7. 设 `finished = (endingId != null)`。
8. 返回 `{ narrative, options, finished }`。

---

## 6. 会话圣经(服务端内部结构,绝不下发)

进场时 LLM① 生成,钉进会话,**会话内不可变**。

```jsonc
{
  "schemaVersion": "narrative-bible-v1",
  "genre": "suspense",
  "secretTruth": "隐藏真相 / 凶手 / 最终反转。🔒绝不下发",
  "styleGuide": "本局文风与调性。🔒绝不下发",
  "acts": [
    // 恰好 4 幕,顺序 qi→cheng→zhuan→he
    {
      "stage": "qi",
      "anchor": "建立处境、抛出第一个异常",
      "emotionArc": "不安",
      "exitHook": "收口钩子",
    },
    { "stage": "cheng", "anchor": "…", "emotionArc": "猜疑", "exitHook": "…" },
    { "stage": "zhuan", "anchor": "…", "emotionArc": "…", "exitHook": "…" },
    { "stage": "he", "anchor": "…", "emotionArc": "…", "exitHook": "…" },
  ],
  "characters": [
    {
      "id": "role_lin",
      "name": "林风",
      "role": "转学生",
      "tagline": "刚转入这所诡异学校",
      "playable": true,
      "public": true,
      "profileMarkdown": "### 角色定位\n转学生 / 调查者\n\n### 外表特征\n...\n\n### 背景故事\n...\n\n### 在故事中的处境\n...",
      "llmBehavior": "🔒隐藏动机/说话方式",
    },
    {
      "id": "npc_guard",
      "name": "保安",
      "role": "门卫",
      "playable": false,
      "public": true,
      "llmBehavior": "🔒",
    },
  ],
  "clues": [
    {
      "id": "c3",
      "title": "提前写好的姓名",
      "detail": "解锁后展示给玩家的事实",
      "unlockHint": "🔒查看登记表时可得",
    },
  ],
  "endings": [
    {
      "id": "e_truth",
      "type": "truth",
      "title": "真相",
      "condition": "🔒玩家集齐关键证据、指认真凶",
      "review": "结局复盘文案",
    },
  ],
}
```

字段说明:

| 字段           | 说明                                                                          | 下发?                                         |
| -------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `secretTruth`  | 本局隐藏真相,LLM② 据此控制信息释放,绝不提前泄露                               | 🔒 否                                         |
| `styleGuide`   | 本局文风,只进 LLM② prompt                                                     | 🔒 否                                         |
| `acts[]`       | 起承转合四幕锚点/情绪/收口钩子。`stage` ∈ {qi,cheng,zhuan,he},恰 4 幕         | 否(仅驱动)                                    |
| `characters[]` | `playable&&public` 者可作扮演角色;`public:false` 为隐藏角色。`llmBehavior` 🔒 | 部分(仅 id/name/role/tagline/profileMarkdown) |
| `clues[]`      | 线索集,LLM 只能揭示玩家挣得的;揭示时写进 `narrative`,不单列下发               | 🔒 否(揉进正文)                               |
| `endings[]`    | `condition` 🔒;触发时结局正文写进终局 `narrative`,不单列下发                  | 🔒 否(揉进正文)                               |

---

## 7. 三个 LLM 调用点的 output 契约与校验

### 7.1 概念策划 output(玩家可见候选)· 校验规则

后端对 LLM⓪ 的输出做基础校验,不过则带错误重试一次:

- `items` 数量 3–6 个(或符合请求 `count` 与后端上限);
- `items[].id` 本批唯一,建议 `HC-01` / `HC-02`;
- `items[].contentMarkdown` 非空,且不含隐藏真相、系统 prompt、模型日志;
- 每个 `contentMarkdown` 应包含 Logline、类型标签、核心冲突、视觉钩子、爽点/卖点、反差与颠覆、一句宣传语、15 秒 trailer 文案。

### 7.2 架构师 output(= 圣经 JSON,§6)· 校验规则

后端对 LLM① 的输出做严格校验,不过则带错误重试一次:

- `acts` 恰 4 项,`stage` 覆盖 {qi,cheng,zhuan,he} 各一;
- `characters` ≥1 且至少 1 个 `playable && public`;
- playable && public 角色必须有非空 `profileMarkdown`;
- `clues` ≥3,`id` 全局唯一;
- `endings` 1–4 个,含至少一个非 hidden;
- `secretTruth` 非空。

### 7.3 回合写手 output(内部,后端消费后归一化)

```jsonc
{
  "narrative": "…(线索揭示、结局正文都写在这里,依圣经措辞)",
  "options": [{ "id": "a2", "label": "…", "intent": "观察证据" }], // ≤3
  "endingId": null, // 非空=触发结局,必须 ∈ 圣经 endings → 后端据此置 finished
  "reason": "日志用,不下发",
}
```

> 线索/幕/风险不进 output:线索该不该揭示、当前哪一幕、节奏松紧,全由 LLM 依圣经 + `recentTurns` + `turnCount` 自行把握;后端只靠 `endingId` 判结束。

### 7.4 归一化 + 防作弊(后端强制)

| 规则                                                     | 处理                           |
| -------------------------------------------------------- | ------------------------------ |
| `narrative` 空                                           | 视为失败,重试或回退文案        |
| `endingId` ∉ 圣经 endings                                | 置 null                        |
| `finished`                                               | = `endingId != null`(单一真源) |
| `options` >3 / 重复 / 含隐藏信息(如"解锁线索""进入结局") | 截断去重、重写为场景内自然行动 |

> 防作弊核心:LLM② 只能引用**钉死的圣经**,不能临场发明真相或线索。圣经在服务端 prompt 里、不在浏览器里,是这条防线的物理基础。

---

## 8. 会话生命周期

- **概念候选**:`concepts` 不创建会话,也不要求缓存候选批次;前端在 `enter` 回传用户选中的 Markdown。
- **创建**:`enter` 时创建,生成 `sessionId`。
- **存储**:后端(建议 Redis)持有 `{ bible, live }`;`live = { setup, turnCount, recentTurns[] }`(无 stage/risk/线索表 —— 都由 LLM 依圣经 + recentTurns 内部把握)。
- **TTL**:建议空闲 2 小时过期。
- **重连(可选轻接口)**:`GET /api/player/narrative/sessions/{sessionId}` 返回最近一幕**脱敏快照**(narrative/options/finished),供玩家刷新续玩。不含圣经。v1 若不做,刷新即重开一局。
- **结束**:`finished=true` 后会话置终态;再来 `turns` 返回 409(应引导玩家重开或复盘)。

---

## 9. 错误码

| 场景                                              | HTTP | body                                           |
| ------------------------------------------------- | ---- | ---------------------------------------------- |
| IP 不存在 / 未上架 / 不可玩                       | 404  | `{ code, message }`                            |
| 选中的高概念缺失 / 内容为空                       | 422  | `{ code:"INVALID_CONCEPT" }`                   |
| 会话不存在 / 已过期                               | 410  | `{ code:"SESSION_EXPIRED" }` → 前端提示重开    |
| 动作与状态不符(未 enter 就 turns、结局后再 turns) | 409  | `{ code:"INVALID_ACTION" }`                    |
| 请求字段非法(缺 choiceId/text 等)                 | 422  | `{ code, fields }`                             |
| LLM 生成/校验失败                                 | 503  | `{ code:"GENERATION_FAILED", retryable:true }` |

---

## 10. 待确认开关(发后端前拍板;当前取默认)

| #   | 开关               | 当前默认                                                                | 备选                                                                      |
| --- | ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | **risk 风险机制**  | ✅ 已删(response 无 risk;结局靠证据/剧情判定,不靠数值)                  | 如需张力条再加回                                                          |
| 2   | **options 上限**   | 3                                                                       | 其他                                                                      |
| 3   | **roles 扮演角色** | 进场返回 `roles` 清单(圣经中 playable&&public),玩家选;不选用 `defaults` | 只给主角、不做选角                                                        |
| 4   | **media 媒体**     | ✅ v1 纯文字(response 无 media)                                         | 后续接 IP 分集视频/trailer 当转场再加                                     |
| 5   | **圣经缓存**       | 不缓存(每局重生,极致千人千面,成本高)                                    | 按 `(ipId, directionKey, pace)` 缓存圣经复用(省 token,回到"有共享版本")   |
| 6   | **内容审核**       | ⚠️ 未定                                                                 | 全 IP 开放 / 仅白名单 IP / 圣经生成后过一道审再放行(**.cn 监管必须先定**) |
| 7   | **接口前缀/宿主**  | `/api/player/narrative/*`                                               | 由后端定;前端按最终前缀接                                                 |
| 8   | **结局诱饵**       | 不返回任何结局信息(防剧透)                                              | 进场返回非剧透诱饵(如「本局 N 种结局待解锁」/ 结局标题,绝不含触发条件)    |
| 9   | **高概念数量**     | 6                                                                       | 3–6;前端可传 `count`,后端可设上限                                         |

---

## 附录

### 附.1 改编方向 `directionKey`(固定全集;进场按 IP 返回其中合适的子集)

`suspense` 悬疑 · `romance` 浪漫 · `adventure` 冒险 · `growth` 成长 · `cyberpunk` 赛博朋克 · `era_ensemble` 时代群像
(方向只改类型口味与叙事重点,不改核心事实;详见 writing-skill §4.2)

### 附.2 节奏 `pace`(固定清单)

`slow` 慢热 · `standard` 标准 · `compact` 紧凑
(节奏影响信息密度与推进速度,不改真相、不跳过必要线索)

### 附.3 起承转合 `stage`

`qi` 起(建立处境)· `cheng` 承(扩展压力)· `zhuan` 转(打破判断)· `he` 合(收束后果)
(内部节奏,不作为机械步数展示给玩家;详见 writing-skill §6)
