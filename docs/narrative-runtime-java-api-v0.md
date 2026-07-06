# 文字游戏 Narrative Play — 后端接口契约 v1(IP 直玩 · 无创作者版)

> 状态:需求草案,发后端前待确认(§9 开关未定)。
> 目标读者:后端、Web 玩家端。
> 版本变更:本文 **v1 取代 v0**。v0 是「创作者授权 → 编译 → 发布 runtimeJson release → 玩家端读 release」
> 的模型;v1 砍掉整条创作者/编译/发布链路,改为 **IP 直玩、无预设、每局实时生成**。
> v0 全文在 git 历史里(`git show HEAD~1:docs/narrative-runtime-java-api-v0.md`)。
> 玩家端 LLM 写作规则参考:`docs/narrative-player-runtime-writing-skill-v1.md`(其 `inputType` 与本文 `action` 一一对应)。

---

## 0. 模型:v0 → v1 的变化

**v1 的核心命题:没有创作者、没有编译、没有发布物。每个已上架 IP 直接有一个「开始游玩」入口;玩家进场时,后端基于 IP 基本信息用 LLM **实时生成本局故事**,钉在服务端会话里,玩家端只看到开场和逐回合渲染。**

- ❌ 不再有:创作者画布、`runtimeJson` 发布物、`StoryRelease`、编译器、`/internal/narrative/stories` 发布接口、story 详情/列表接口(IP 自己的列表/详情页复用现有 IP 模块)。
- ✅ 只剩两个玩家端接口:**进场**(生成世界观 + 建会话 + 返回可选项清单)、**回合**(提交选择开局 + 逐回合推进)。
- 「本局故事」是 **机器生成、单会话、临时** 的 —— 不是人工授权、不落发布库、不跨玩家共享(是否缓存见 §9)。这就是「无预设」:没有任何人预先设定数据。

### 两个 LLM 阶段(后端各实现一次)

| 阶段   | 触发             | 角色           | 产物                                                                                                |
| ------ | ---------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| ① 架构 | 进场 `enter`     | **故事架构师** | 本局「故事圣经」(§5):secretTruth / 起承转合四幕 / 人物 / 线索 / 结局。生成即钉进会话,会话内不可变。 |
| ② 回合 | 每个回合 `turns` | **回合写手**   | 单回合渲染:正文 + 选项 + 结束标记。线索揭示、结局正文都写进正文;只能引用①钉死的圣经。               |

### 链路

```mermaid
flowchart LR
  P["玩家在 IP 页点「开始游玩」"] --> E["POST /enter"]
  E --> B["后端: 取 IP 种子 → LLM① 生成圣经 → 钉会话 → 返回清单(角色/方向/节奏)"]
  B --> S["玩家选 setup → POST /turns (action:start, 带 setup)"]
  S --> F["后端: LLM② 写第一幕 → 返回回合"]
  F --> T["POST /turns (continue/choice/free)"]
  T --> W["后端: 读圣经+状态 → LLM② 写手 → 校验/归一化/脱敏 → 返回本回合"]
  W --> T
```

---

## 1. 名词

- **会话 session**:一次游玩。后端持有全部运行状态,前端只持 `sessionId`。
- **圣经 bible**:进场时生成、钉在会话里的本局故事结构(§5)。**含剧透,绝不下发前端。**
- **种子 seed**:后端喂给 LLM① 的 IP 基本信息(§2)。
- **脱敏 redact**:凡是含答案的字段(secretTruth / 线索解锁提示 / 结局触发条件 / 人物隐藏行为 / LLM 日志)都不进任何前端响应。

---

## 2. 数据来源:IP 种子

进场时后端从 IP 现有数据取以下字段拼成种子喂 LLM①(不需要任何新表):

| 来源                          | 字段                                                      | 用途                                                 |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `ips`                         | `ageRating`、genre 分类(taxonomy)                         | 分级、类型基调                                       |
| `ip_localizations`(按 locale) | `title`、`subtitle`、`summary`(≤500)、`description`(长文) | 世界观、人物、冲突的主要来源                         |
| `ip_episodes` + 本地化        | 各集 `title`、`summary`                                   | 情节骨架参考(分集是**视频短剧**,非文本章节,仅作骨架) |
| `ips` / `ip_localizations`    | `coverAssetId`、`trailerAssetId`                          | 可作开场媒体(§9 media 开关)                          |

> 种子偏营销口吻且各 IP 厚薄不均 —— LLM① 的职责就是把「blurb + 类型」补全成一份可玩的、自洽的故事圣经。`description` 越丰满,质量越高。

---

## 3. 接口 ① 进场 `POST /api/player/narrative/enter`

**重调用**:生成圣经并建会话,返回给玩家挑选的清单。玩家点「开始游玩」后等待此调用(前端显示「正在生成你的故事…」)。**不产出剧情** —— 剧情从第一个 `turns`(`action:start`)开始。

### 3.1 请求

```jsonc
{
  "ipId": "018f...uuid", // 必填。必须是已上架/可玩 IP
  "locale": "zh-CN", // 必填。运行语言
}
```

> setup(观众三选)不在进场时传 —— 它从本接口返回的清单里选,随第一个 `turns`(`action:start`)提交。

### 3.2 响应

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
      { "id": "role_lin", "name": "林风", "role": "转学生", "tagline": "刚转入这所诡异学校" },
      { "id": "role_sis", "name": "姐姐", "role": "陪读家属", "tagline": "对弟弟隐瞒着什么" },
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

> **不返回结局清单**:进场就列出结局 = 剧透。若要「本局有 N 种结局待解锁」这类**非剧透诱饵**,见 §9 #8。

### 3.3 后端职责

1. 取 IP 种子(§2)。
2. **LLM① 故事架构师** → 生成圣经(§5)。方向/节奏是**游玩期镜头**(writing-skill §4),不改核心事实,故此处一次生成与具体方向无关的核心圣经即可。
3. 校验圣经(§6.1);不过则带错误 **一次修复重试**,再不过 → 503。
4. 建会话,钉 `bible` + 初始 `live` 状态(`setup=null, stage=qi, risk=0, turnCount=0, unlockedClueIds=[]`)。
5. 从圣经派生 `setupOptions`:`roles`=`playable&&public` 人物;`directions`=按本 IP 从固定清单挑的合适子集;`paces`=固定三档。
6. **脱敏**后返回清单。圣经绝不下发,第一幕不在此产出。

---

## 4. 接口 ② 回合 `POST /api/player/narrative/turns`

一个接口吃全部动作。`action` 四种(含开局),区别见 §4.3。

### 4.1 请求

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

### 4.2 响应(所有 action 同形状,含 start 返回的第一幕)

```jsonc
{
  "narrative": "本回合正文,前端直接渲染。线索揭示、结局正文都写在这里",
  "options": [{ "id": "a2", "label": "对比登记表和通知书日期" }], // 0–3 个;空=本回合只自由输入
  "finished": false, // false=可继续;true=已结束(结局正文即本回合 narrative)
}
```

> 只有三个字段。线索面板 / 风险表 / 结局卡 / 进度 / 说话人 / 媒体都不进 v1 契约 —— 线索与结局揉进 `narrative`,机制仍由服务端圣经保证(§5/§6)。

### 4.3 四种 action 的区别

| action       | 前端触发                              | 携带       | 后端处理                                                              | 有玩家行为待判定 |
| ------------ | ------------------------------------- | ---------- | --------------------------------------------------------------------- | ---------------- |
| **start**    | 进场选完 setup 点「开始」(每局仅一次) | `setup`    | 把 setup 记进 `live`,LLM② 写**第一幕**(起幕开场 + 首批选项)           | 无(开局)         |
| **continue** | 「继续」按钮                          | 无         | 纯推进:时间前进 / NPC 反应 / 压力升级,不重复上一回合                  | 无               |
| **choice**   | 点某个预设 `options` 芯片             | `choiceId` | 按该选项对应的**已知意图**推进(干净、可控)                            | 有,意图明确      |
| **free**     | 自由输入框                            | `text`     | 先判定该输入在当前场景成不成立(合理/受阻/跳跃/无关/破坏规则),再写反馈 | 有,开放,需先解析 |

### 4.4 后端职责

1. 取会话;不存在/过期 → 410。`action=start` 但已开局 → 409;非 `start` 但未开局 → 409。
2. `action=start`:把 `setup`(缺省用 `defaults`)写进 `live`;`roleId` 为空则取圣经主角。
3. 组 LLM② 输入:`bible` + `live`(setup / turnCount)+ `recentTurns`(最近 8–12 回合)+ 本次 `action/choiceId/text`。
4. **LLM② 回合写手** → 内部 output(§6.2)。
5. **校验 + 归一化 + 防作弊**(§6.3)。
6. 更新 `live`(`turnCount++`、append `recentTurns`)。配速由 LLM 依 `turnCount` + 圣经 `acts` 自行把握,后端不存 stage。
7. 设 `finished = (endingId != null)`。
8. 返回 `{ narrative, options, finished }`。

---

## 5. 会话圣经(服务端内部结构,绝不下发)

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
      "playable": true,
      "public": true,
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

| 字段           | 说明                                                                          | 下发?                     |
| -------------- | ----------------------------------------------------------------------------- | ------------------------- |
| `secretTruth`  | 本局隐藏真相,LLM② 据此控制信息释放,绝不提前泄露                               | 🔒 否                     |
| `styleGuide`   | 本局文风,只进 LLM② prompt                                                     | 🔒 否                     |
| `acts[]`       | 起承转合四幕锚点/情绪/收口钩子。`stage` ∈ {qi,cheng,zhuan,he},恰 4 幕         | 否(仅驱动)                |
| `characters[]` | `playable&&public` 者可作扮演角色;`public:false` 为隐藏角色。`llmBehavior` 🔒 | 部分(仅 name/role/public) |
| `clues[]`      | 线索集,LLM 只能揭示玩家挣得的;揭示时写进 `narrative`,不单列下发               | 🔒 否(揉进正文)           |
| `endings[]`    | `condition` 🔒;触发时结局正文写进终局 `narrative`,不单列下发                  | 🔒 否(揉进正文)           |

---

## 6. 两个 LLM 阶段的 output 契约与校验

### 6.1 架构师 output(= 圣经 JSON,§5)· 校验规则

后端对 LLM① 的输出做严格校验,不过则带错误重试一次:

- `acts` 恰 4 项,`stage` 覆盖 {qi,cheng,zhuan,he} 各一;
- `characters` ≥1 且至少 1 个 `playable && public`;
- `clues` ≥3,`id` 全局唯一;
- `endings` 1–4 个,含至少一个非 hidden;
- `secretTruth` 非空。

### 6.2 回合写手 output(内部,后端消费后归一化)

```jsonc
{
  "narrative": "…(线索揭示、结局正文都写在这里,依圣经措辞)",
  "options": [{ "id": "a2", "label": "…", "intent": "观察证据" }], // ≤3
  "endingId": null, // 非空=触发结局,必须 ∈ 圣经 endings → 后端据此置 finished
  "reason": "日志用,不下发",
}
```

> 线索/幕/风险不进 output:线索该不该揭示、当前哪一幕、节奏松紧,全由 LLM 依圣经 + `recentTurns` + `turnCount` 自行把握;后端只靠 `endingId` 判结束。

### 6.3 归一化 + 防作弊(后端强制)

| 规则                                                     | 处理                           |
| -------------------------------------------------------- | ------------------------------ |
| `narrative` 空                                           | 视为失败,重试或回退文案        |
| `endingId` ∉ 圣经 endings                                | 置 null                        |
| `finished`                                               | = `endingId != null`(单一真源) |
| `options` >3 / 重复 / 含隐藏信息(如"解锁线索""进入结局") | 截断去重、重写为场景内自然行动 |

> 防作弊核心:LLM② 只能引用**钉死的圣经**,不能临场发明真相或线索。圣经在服务端 prompt 里、不在浏览器里,是这条防线的物理基础。

---

## 7. 会话生命周期

- **创建**:`enter` 时创建,生成 `sessionId`。
- **存储**:后端(建议 Redis)持有 `{ bible, live }`;`live = { setup, turnCount, recentTurns[] }`(无 stage/risk/线索表 —— 都由 LLM 依圣经 + recentTurns 内部把握)。
- **TTL**:建议空闲 2 小时过期。
- **重连(可选,第 3 个轻接口)**:`GET /api/player/narrative/sessions/{sessionId}` 返回最近一幕**脱敏快照**(narrative/options/finished),供玩家刷新续玩。不含圣经。v1 若不做,刷新即重开一局。
- **结束**:`finished=true` 后会话置终态;再来 `turns` 返回 409(应引导玩家重开或复盘)。

---

## 8. 错误码

| 场景                                              | HTTP | body                                           |
| ------------------------------------------------- | ---- | ---------------------------------------------- |
| IP 不存在 / 未上架 / 不可玩                       | 404  | `{ code, message }`                            |
| 会话不存在 / 已过期                               | 410  | `{ code:"SESSION_EXPIRED" }` → 前端提示重开    |
| 动作与状态不符(未 enter 就 turns、结局后再 turns) | 409  | `{ code:"INVALID_ACTION" }`                    |
| 请求字段非法(缺 choiceId/text 等)                 | 422  | `{ code, fields }`                             |
| LLM 生成/校验失败                                 | 503  | `{ code:"GENERATION_FAILED", retryable:true }` |

---

## 9. 待确认开关(发后端前拍板;当前取默认)

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
