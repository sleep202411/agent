# Story Studio 文游运行时 — 后端接口契约 v1(作者化 · Java 持有运行时)

> 状态:需求草案,发后端前待确认(§8 开关未定)。
> 目标读者:Java 后端、Web 玩家端。
> 定位:本文补上 `docs/narrative-runtime-java-api-v0.md` 明确划到界外的那一半 ——
> **Story Studio 已发布作品的文字游戏运行时**。那份文档管的是 IP 直玩(无创作者、
> 每局实时生成),本文管的是**有作者的已发布作品**。
> 参考实现:`apps/server/src/story-studio/`(Nest 三接口 + 服务端会话,已上线,见 §7)。
> 路由名、请求/响应体、动作、收束规则与错误码以该实现为准。

---

## 0. 为什么需要这份契约

已商定的 Java 发布与发现 API v1(`contracts/experience-runtime/v2/java-release-api-v1.openapi.yaml`)
只覆盖**发布和查询**:Java 收下 manifest、原样托管、按 `gameId` 回当前版本。播放本身
不需要 Java —— 因为**影游**的播放是纯查表:manifest 里写死了每个选项跳到哪一幕,
浏览器引擎自己走完全程。

**文游不是这样。** 文游的节点是作者写的**锚点(必经事件)**,锚点之间由 LLM 即兴演绎,
并由 LLM 判断何时抵达下一个锚点。也就是说文游播放**每回合都要一次模型调用**,必须有
一个服务端运行时。

本文定义那个运行时的接口,并按决策归属 Java:**Java 持有会话、调用模型、沉淀数据;
Web 只做渲染。**

### 与 IP 直玩(narrative)的关系

**形态照抄,语义另立**:三个接口的名字、请求体、响应体与 IP 直玩逐字段对齐,
但**不能把作品塞进 IP 直玩的那三个接口**:

|          | IP 直玩 `/api/player/narrative/*` | 本文                                      |
| -------- | --------------------------------- | ----------------------------------------- |
| 内容来源 | 调用方把 IP 资料拼成文本传入      | **作者产物,随 manifest 发布时交付**       |
| 选项     | LLM 现编(`options`)               | **作者写死**,按 `choiceId` 路由到指定锚点 |
| 结局     | 一个布尔 `finished`               | **作者定义的集合**,必须收在其中之一       |
| 版本     | 只有 `ipId`                       | `(gameId, contentVersion)` 不可变发布身份 |

把作者的分支树塞进一段自由文本喂给 LLM,等于把**硬约束降级成提示词建议**——已发布
作品的分支和结局就失去保证了。所以 v1 另起契约。

但**契约另立不等于形状另立**。已上线的 Nest 实现(§7)就是照 IP 直玩的
`concepts / enter / turns` 一比一实现的,只在三处扩展,且都是"作者产物"直接逼出来的:

| 扩展                    | 为什么                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| 请求带 `contentVersion` | 发布身份是 `(gameId, contentVersion)`;开局后重新发布也不得换内容                                  |
| 选项带 `kind`,上限 6    | 作者选项(`choice`,按 id 路由)与 LLM 建议(`suggestion`,按文本发)必须可区分;作者选择出口允许 2–6 条 |
| 结局是对象不是布尔      | 结局是作者定义的集合,要回 `{ endingId, title, summary }`                                          |

这三处之外**一个字段都不加**——所以同一个播放器同时驱动两边,Java 上线后只换 base URL。

---

## 1. 名词

- **锚点 anchor**:作者写的必经节点 —— 是**方向路标**,不是必须一步一停的台阶:
  它只规定故事最终要经过哪里,锚点之间 LLM 可以任意扩展。带定场文本、出口
  (继续 / 选择 / 结局)。
- **自由回合 free turn**:两个锚点之间由 LLM 演绎的回合。**没有回合配额**,
  只有一个防跑飞的上限(§5.4)。
- **收束 converged**:LLM 判断"这一拍演完了",故事可以前往下一个锚点。
  **抵达与否由 LLM 判断,不由计数器决定。**
- **故事概念 concept**(内部即 direction):进场前生成的**切入角度**(不是新故事)。
  只影响叙事口吻与强调,**不得覆盖**作者的锚点、选项与结局。
- **会话 session**:一次游玩。**Java 持有全部运行状态,前端只持 `sessionId`。**

---

## 2. 数据来源:发布物必须携带叙事内容(前置改造)

Java 目前把 manifest 当**不透明 JSON**,不解析。文游要在 Java 侧运行,这条必须放开:
**Runtime Manifest v2 为 `metadata.experienceProfile === "narrative"` 的发布物增加一个
`narrative` 段**,Java 在开局时从**自己已托管的那份 manifest** 里读。

为什么不在开局时由调用方传内容(IP 直玩那样):

- 前端传 = 可篡改 = 直接对我们付费的模型做提示词注入;
- 由我们 Nest 传 = Nest 重新回到播放链路,与"我们只做渲染"矛盾;
- 随 manifest 走 = **一次交付、带版本、不可变、已经在 CDN 上**,零新增传输通道。

```jsonc
// manifest.narrative —— 仅 narrative profile 存在
{
  "bible": {
    "logline": "…",
    "synopsis": "…",
    "worldview": "…", // LLM 叙事的世界规则来源
    "characters": [{ "id": "c1", "name": "…", "summary": "…" }],
  },
  "entryAnchorId": "clip:scene-1",
  "anchors": [
    {
      "anchorId": "clip:scene-1",
      "title": "最后一个夜晚",
      "body": "定场文本;留空则由 LLM 依据上下文起笔",
      "exit": { "kind": "auto", "nextAnchorId": "clip:scene-2" },
    },
    {
      "anchorId": "clip:scene-2",
      "title": "凌晨两点",
      "body": "…",
      "exit": {
        "kind": "choice",
        "decisionId": "decision:letter",
        "prompt": "你怎么处理这封信？",
        "choices": [
          { "choiceId": "choice:send", "label": "下楼，投进邮筒", "nextAnchorId": "clip:sent" },
          { "choiceId": "choice:burn", "label": "点燃它", "nextAnchorId": "clip:burned" },
        ],
      },
    },
    {
      "anchorId": "clip:burned",
      "title": "灰烬",
      "body": "…",
      "exit": { "kind": "ending", "endingId": "ending:burned" },
    },
  ],
  "endings": [
    { "endingId": "ending:burned", "title": "信被烧掉", "summary": "有些话永远留在了那个夜里。" },
  ],
}
```

**不变量(Java 必须信任,发布前由我们的语义校验器保证)**:入口锚点存在;每条 `nextAnchorId`
指向存在的锚点;每个 `endingId` 在 `endings` 里;图无环;所有结局可达。Java 不需要重做这些
校验,但**必须拒绝执行任何不在 manifest 里的跳转**(§6 防作弊)。

---

## 3. 接口 ⓪ 故事概念 `POST {prefix}/narrative/concepts`

进场前生成玩家可见的切入角度。**不创建会话。**

### 3.1 请求

```jsonc
{ "gameId": "019f…", "contentVersion": "3ee4…", "locale": "zh-CN", "count": 6 }
```

### 3.2 响应

```jsonc
{
  "code": 200,
  "data": {
    "gameId": "019f…",
    "items": [
      {
        "id": "HC-01",
        "contentMarkdown": "【高概念 HC-01】\nLogline：以火为隐喻,讲述毁灭如何成为另一种形式的告白。\n\n类型标签：诗意现实 / 毁灭美学\n\n核心冲突：释放 vs. 永久抹除\n\n视觉钩子：火焰舔舐信纸边缘,字迹蜷曲成黑蝶\n\n反差与颠覆：烧掉信不是终结,而是将话语内化\n\n一句宣传语：灰烬比邮票更懂得抵达。",
      },
    ],
  },
}
```

结构化的方向字段(logline / tags / conflict / hook / twist / tagline)**拍平成一段
自包含 Markdown**:那段 Markdown 就是玩家读到的全部,也是进场时原样回传的全部
(§4)。字段名与顺序是契约的一部分,后端渲染与解析必须互为逆运算。

### 3.3 后端职责

- 素材只用 `manifest.narrative.bible` + 结局标题;**不得**泄露锚点正文以外的剧透。
- 每个概念必须是**同一个故事的不同角度**,不是另一个故事。提示词须明示:不得新增结局、
  不得与圣经冲突。
- **必须正好回 `count` 条**。玩家是在这批里挑一条,少给一条就是坏掉的选择屏;
  模型少写时按 `GENERATION_FAILED`(可重试)答,不要把残缺批次发出去。
- 玩家可「换一批」重摇 —— 这是**最贵且最易被刷**的调用,限流须比其它两个严(§8)。

---

## 4. 接口 ① 进场 `POST {prefix}/narrative/enter`

建会话,把玩家挑的概念钉进去,并交出设置屏需要的一切。**不出正文。**

### 4.1 请求

```jsonc
{
  "gameId": "019f…",
  "contentVersion": "3ee4…",
  "locale": "zh-CN",
  "selectedConceptId": "HC-01",
  "selectedConceptMarkdown": "【高概念 HC-01】…", // §3 那条原样回传
}
```

### 4.2 响应

```jsonc
{
  "code": 200,
  "data": {
    "sessionId": "sess_…",
    "gameId": "019f…",
    "locale": "zh-CN",
    "prologue": "有些话永远留在了那个夜里。", // 作者 logline,不是故事回合
    "setupOptions": {
      "paces": [
        { "key": "slow", "label": "慢热" },
        { "key": "standard", "label": "标准" },
        { "key": "compact", "label": "紧凑" },
      ],
    },
    "defaults": { "pace": "standard" },
    "music": {
      // 作品没有配乐时:enabled=false + 空数组(绝大多数作品),客户端不渲染音频控件
      "enabled": true,
      "tracks": [
        { "trackId": "audio:0197f4a2-…", "url": "https://media.…/theme.mp3", "gain": 0.6 },
      ],
    },
  },
}
```

### 4.3 配乐(背景乐)

配乐是**普通媒体引用**,不是冻结产物 —— 这是刻意的:丢了一段视频故事就断了,丢了一床
背景乐只是**安静**。所以整条链路的硬要求是:**配乐永远不能让发布失败**。

- manifest 的场景节点上直接挂 `music: { trackId, url }`,`url` 是普通公开媒体地址
  (不可猜、可缓存、不过期)。**不进 `assets[]`,不参与完整性校验,没有任何诊断码。**
- 绑定的资源被删/被封/换了工作区 → 该场景**没有 music 字段**,照常发布,播放时安静。
- 为什么不用签名 URL:一床背景乐要循环整局(会话空闲 TTL 2 小时),5 分钟有效期 +
  `no-store` 的链接根本服务不了它,也让预加载失去意义。
- `enter` 把该发布物引用到的**去重后的**全部轨道一次性下发,这样 cue 只带 `trackId`
  客户端也知道放什么(客户端不预下载:URL 本身可缓存,首个 cue 还有 1.5s 淡入);`turns` 只在
  **进入的锚点所绑轨道与当前在播的不同**时才带一条 cue(§5.2)。锚点本就稀疏,所以
  绝大多数回合没有 cue —— 一床乐可以覆盖很长一段自由叙事。

### 4.4 后端职责

- 从自己托管的 `(gameId, contentVersion)` manifest 读 `narrative` 段,**钉进会话**;
  会话期间即使作品重新发布也不得换内容(已开局的玩家看到的必须是同一版本)。
- **这里一个模型都不调**:第一拍属于 `turns(action:"start")`,玩家不该在设置屏前干等。
  `prologue` 直接用作者的 logline。
- **pace 目录由服务端下发**(`setupOptions.paces` + `defaults.pace`),客户端没有自己的
  节奏表;`label` 随 `locale` 本地化。
- `pace` 在**开局那一回合**提交(§5),不在这里 —— 设置向导可以来回改,只有按下"进入
  故事"的那个值算数。**pace 只改提示词,不改回合数**:它告诉叙述者向下一个锚点推进得
  多快(慢热 linger / 标准 steady / 紧凑 press on),抵达仍由 `converged` 决定。
- ⚠️ `paces[]` **只有 `key` + `label`**,不下发任何预算数字:每个 pace 都会调用模型、
  都提供自由输入框、都接受 `continue`,客户端没有需要按数字分支的东西。
  **没有"纯静态播放"这一档** —— 那正是被否掉的锚点幻灯片。

---

## 5. 接口 ② 回合 `POST {prefix}/narrative/turns`

一个接口吃全部动作,**开局也是一个动作**(`action: "start"`)。

### 5.1 请求

```jsonc
{
  "sessionId": "sess_…",
  "action": "continue", // start | continue | choice | free
  "setup": { "pace": "standard" }, // 仅 action=start;缺省用 enter 的 defaults
  "choiceId": "choice:burn", // 仅 action=choice;必须取自当前锚点的作者选项
  "text": "把信封凑到台灯下", // 仅 action=free
}
```

### 5.2 响应

```jsonc
{
  "code": 200,
  "data": {
    "narrative": "台灯的光晕昏黄…\n\n凌晨两点\n信摊在桌上…\n\n你怎么处理这封信？",
    "options": [{ "id": "choice:burn", "label": "点燃它", "kind": "choice" }],
    "finished": false,
    "ending": { "endingId": "ending:burned", "title": "信被烧掉", "summary": "…" },
    // 仅在配乐真的换了的那一回合出现;缺省 = 不变
    "music": { "action": "play", "trackId": "audio:0197f4a2-…", "fadeMs": 1500 },
  },
}
```

- **`narrative` 是一段连续正文**:锚点定场文、LLM 段落、作者的决策问句按发生顺序拼成
  一整块(段间空行),玩家看不出哪里是写好的、哪里是演的。客户端把它追加到正文流下方
  (**不是整屏替换**)。
- **`options` 是扁平表,最多 6 条**,一回合内**不混两种 `kind`**(见下表)。
- `music` **只有 `action: "play"`**:没有 `stop`。一局在结局卡下仍留着那床乐(收束
  段是玩家读到的最后一段文字,从它底下抽掉音乐更糟),玩家离开页面时客户端自行拆机。
- `ending` **仅在 `finished: true` 时出现**;`title` / `summary` 是作者的本地化文案,
  某个语言留空是合法的(发布只要求至少一个语言非空),客户端按有什么渲染什么。

| `kind`       | 来源                       | 点击后                                  |
| ------------ | -------------------------- | --------------------------------------- |
| `choice`     | **作者的**分支出口(2–6 条) | 回 `{ action: "choice", choiceId: id }` |
| `suggestion` | LLM 建议的自由行动(2–3 条) | 回 `{ action: "free", text: label }`    |

### 5.3 四种 action

| action     | 后端处理                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `start`    | 开局:把 `setup.pace` 定死进会话,进入入口锚点。**一局只能一次**(§5.5)。                            |
| `continue` | **永远不直接跳到下一个锚点**,一律交给 LLM 推进这一拍;只有 `converged`(或跑飞上限)才前往下一锚点。 |
| `choice`   | 按作者选项的 `nextAnchorId` 路由。**只接受当前锚点的 `choiceId`。**                               |
| `free`     | 玩家自由输入,LLM 在当前锚点内演绎并给出 `converged` 判定。**任何 pace 下都受理。**                |

⚠️ **决策点不得逼玩家选**:作者选项摆在屏幕上等着,`continue` 与自由输入在决策点
照常受理、照常出正文。任何"决策点限流 continue"的设计都是同一个节拍器错误。

### 5.4 收束与结局

- 每个自由回合 LLM 输出 `{ narration, converged, suggestions }`。
- `converged === true` → 走当前锚点的出口。**这是唯一的正常抵达路径。**
- 另有一个**跑飞上限**(参考实现:慢热 24 / 标准 18 / 紧凑 12 回合):它不是节奏旋钮,
  是"模型永不收束就会无限烧 token"的兜底。正常游玩永远碰不到;真触发时也必须**按普通
  抵达渲染**,不得把"配额用完"暴露给玩家。
- 抵达 `ending` 出口时,**先写一段收束叙事再发 `ending` 事件**:玩家刚读完几百字的
  叙事,不该直接掉进一张结局卡。收束段必须落在作者写的结局语义上,不得新增反转。
  生成失败时降级为只发 `ending`(**绝不因为文采问题吞掉一个已抵达的结局**)。

### 5.5 错误码:终局 vs 可恢复

失败体统一为 `{ code, message, retryable?, retryAfterSec? }`。玩家端只在**一个维度**上
分支:这一局还能不能玩下去。

| `code`               | HTTP | 会话     | 客户端                                                     |
| -------------------- | ---- | -------- | ---------------------------------------------------------- |
| `RELEASE_NOT_FOUND`  | 404  | —        | 作品不可玩,退回概念页且不给重试                            |
| `SESSION_EXPIRED`    | 410  | **已死** | 丢掉本局,重开                                              |
| `INVALID_ACTION`     | 409  | **已死** | 丢掉本局,重开                                              |
| `ACTION_NOT_ALLOWED` | 409  | **完好** | 只提示这一击被拒,原地继续                                  |
| `TURN_IN_FLIGHT`     | 429  | 完好     | `retryable: true`,同一会话已有回合在飞,等它落地            |
| `RATE_LIMITED`       | 429  | 完好     | `retryable: true` + `retryAfterSec`,限流在引擎之前就挡住了 |
| `GENERATION_FAILED`  | 503  | 完好     | `retryable: true`,模型没答上来,重试同一动作                |

- `INVALID_ACTION` **只用于会话本身不可用**:重复 `start`、未 `start` 就行动、已抵达
  结局还行动。这些重试多少次都不会成功,所以客户端有权丢掉整局。
- `ACTION_NOT_ALLOWED` 用于**引擎拒绝了这一个动作**:`choiceId` 不在当前锚点上,或在
  没有作者选项的锚点上发 `choice`。**回合没有落盘,剧情一步没动。**
- ⚠️ 这两个码合并 = 玩家一次误点丢掉整局。分开是硬要求,不是风格问题。
- 4xx 一律意味着**这一回合从未生效**(限流在引擎前、参数校验在引擎前、引擎拒绝时不落盘),
  客户端据此保留会话;只有超时 / 断网 / 5xx 是"可能已落地"的模糊态。

---

## 6. 防作弊与脱敏(后端强制)

会话在服务端,所以以下都由 Java 保证:

- **跳转只认 manifest**:`choiceId` 必须属于当前锚点;任何客户端指定的 `anchorId` 一律拒绝。
- **概念文本按自家模板解析,不当自由提示词**:`selectedConceptMarkdown` 由客户端回传
  (概念 id 每批都从 `HC-01` 开始,服务端缓存会让两个玩家互相串批,所以不能靠 id 取回),
  但后端**只解析 §3.2 那套字段**,解析结果再过一遍长度与结构校验才进提示词;模板之外的
  文本一律当作 logline 截断,不得整段透传给模型。
- **跑飞上限在服务端**:由 `setup.pace` 在开局那一回合定死,之后的回合请求不得携带。
- **未抵达的锚点/结局不下发**:响应里只出现玩家已经走到的内容。
- **模型输出即不可信文本**:落库前做长度、语言、注入清洗;`narration` 不得包含指令回显。

---

## 7. 参考实现与迁移

Nest 侧已有一份可运行实现(2026-07-21 上线),**它就是本契约的可执行版本**:

- 路由:`apps/server/src/story-studio/story-text-play.controller.ts`
- 引擎:`apps/server/src/story-studio/story-text-play.service.ts`
- 会话:`apps/server/src/story-studio/story-narrative-session.service.ts`
- 公开端点:`POST /aurora/story-experiences/narrative/{concepts,enter,turns}`
- 模型:DashScope qwen3-max(结构化输出)

**会话在服务端**(§4/§5 就是按这个写的),不再是早期那版"state 每回合由客户端回传":

- 运行状态存 Redis,客户端只拿 `sessionId`;玩家再也不能靠改 JSON 回档、分叉或伪造一局。
- 空闲 TTL 2 小时,每次写入续期 —— 一局只在玩家停手之后才死。
- 每回合 `SET NX` 取锁串行化;抢不到锁答 `TURN_IN_FLIGHT`(**不是**先花掉一次模型调用
  再发现冲突)。
- **回合失败不落盘**:处理函数抛出时会话原样保留,所以一个被拒的动作不会推进剧情 ——
  这正是 §5.5 那张表能成立的前提。
- 限流:concepts 10 / enter 30 / turns 60,每 5 分钟每客户端。actor 取
  `x-forwarded-for` 首段:这些路由在 Next 代理后面,`req.ip` 是代理自己的地址,
  按它计数等于给全站一个共享桶。

契约差异:**已无**。§3–§5 的路由名、请求体、响应体、错误码就是 Nest 现在的形状;
Java 按本文实现后,Web 播放器换个 base URL 即可,不需要改客户端逻辑。

迁移顺序:Java 上线 → Web 播放器切到 Java → Nest 的三个公开端点退役。
**`story-text-play` 服务本身必须保留**:创作者试玩玩的是**未发布草稿**,Java 永远看不到。

---

## 8. 待确认开关(发后端前拍板)

| #   | 待定                | 当前默认(Nest 实现)                                                            |
| --- | ------------------- | ------------------------------------------------------------------------------ |
| 1   | 模型与供应商        | DashScope qwen3-max                                                            |
| 2   | 算力成本归属        | 未定 —— 目前平台承担,玩家侧无扣减                                              |
| 3   | 玩家权益            | **无**。已发布作品对登录用户全开放,无会员/付费判断                             |
| 4   | 限流                | concepts 10 / enter 30 / turns 60,每 5 分钟每客户端(取 `x-forwarded-for` 首段) |
| 5   | 单回合超时          | 60s(叙事实测 20–40s)                                                           |
| 6   | 幂等                | **无**。超时重试会重复计费,建议加 `Idempotency-Key`                            |
| 7   | 会话 TTL / 断线续玩 | 空闲 2 小时,每次写入续期;**断线续玩未做**(`sessionId` 只活在内存里,刷新即弃局) |
| 8   | LLM 输出的内容审核  | 未定(公开分发的生成文本)                                                       |

---

## 9. 数据统计(本契约的主要动机之一)

会话归 Java 之后,以下数据天然沉淀在 Java 侧,无需额外埋点通道:

- 开局数、完成率、平均回合数、平均时长;
- **结局分布**(哪个结局最常被抵达)、分支选择分布;
- 自由输入率 vs 选项率、`converged` 命中率、强制收束率;
- 模型成本:每回合 token、失败与重试率。

字段形状可复用 `contracts/experience-runtime/v2/player-event-batch.draft.schema.json`
(带 `gameId / contentVersion / buildId` 归因)。⚠️ 该文件目前是**草案**,README 明确
写着不属于已商定 API;要用须先推成正式契约。

> 注:`docs/narrative-runtime-java-api-v0.md` 引用的
> `docs/story-experience-platform-rfc-v1.md`(本应定义发布/会话/存档/遥测全景)
> **在仓库中不存在**,git 历史里也没有。上述三份 `.draft.schema.json` 是目前仅存的线索。
