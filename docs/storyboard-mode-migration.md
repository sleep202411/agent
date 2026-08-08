# 分镜表迁移重构方案：画布分镜节点 + 表格投影模式

**版本**：v1.0（2026-08-03）
**目标分支**：develop（本文档基于对 develop 等价工作树的全量代码梳理，四个区域交叉核对过 file:line）
**已拍板决策**：

1. 新分镜表运行在 **Creative Studio 项目外壳的预留模式**上，与画布"丝滑切换"；
2. 数据模型采用 **分镜节点（shot node）方案**：分镜是画布文档里的一等节点类型，表格模式是同一份文档的第二种渲染（讨论中的 D 方案）；
3. 后端 **零 Java**：一切走平台文档模型；
4. **不迁移老数据**：Java 侧存量分镜（shot/shotColumn/shotValue）不带过来，老入口隐藏退役。

---

## 〇、一句话架构

> 新增 `shot` 节点类型注册进画布；分镜表模式 = 打开**同一份 canvas 文档**（`ensure(projectId, "canvas")`），把所有 `shot` 节点按 fractional order 投影成表格。不新建服务端表、不新建文档类型、不新建同步机制——实时协同、离线缓存、版本历史、撤销重做全部继承自现有 CRDT 底座。

---

## 一、现状梳理（迁移涉及的四个区域）

### 1.1 项目外壳与模式系统（迁移目标宿主）

- 路由 `/project/[projectId]/[mode]`，模式注册表在 `apps/studio/app/[locale]/project/_modes/registry.ts:25-40`，当前注册 `canvas` + `brief`。注册表注释明确承诺："adding a mode (storyboard / timeline / …) is a new entry + an editor, with zero shell/routing changes"。
- **关键事实**：注册表里的 `type` 字段是死代码——真正的"模式→文档"映射硬编码在各编辑器内部（`brief-editor.tsx:51` 调 `useModeDocument(projectId,"brief")`；画布经 `use-canvas-document.ts:14` 调 `useModeDocument(projectId,"canvas")`）。文档解析走 `POST /aurora/projects/:id/documents/:type/ensure`（幂等、每项目每类型唯一主文档、advisory lock 防竞态，`documents.service.ts:137-222`）。
- **两个模式今天就能共享一份文档，服务端零改动**：ensure 按 (projectId, type) 取同一文档；presence、评论、版本历史都按 documentId 走，自动共享。
- 模式切换是兄弟路由导航，外壳 layout 不重挂载（`layout.tsx:18`）——"丝滑"的基础设施已经在。

### 1.2 画布内核（分镜节点要长进去的地方）

- 节点类型注册表：`components/canvas/authoring/media-authoring-canvas.tsx:49-57` 的 `NODE_TYPES`（现有 image / panorama / note / videoAsset / audioAsset / prompt / video）。**类型字符串永久存进 CRDT，只能新增不能改名**。
- 持久化：Yjs 文档，根 schema `CANVAS_ROOT_SCHEMA {meta,nodes,edges,groups,assets}`（`lib/collab/protocol.ts:17-26`）。每个节点是 `Y.Map{id,type,position,data:Y.Map<field,json>,width?,height?}`——**data 字段级合并、字段值 LWW**（`canvas-doc.ts:21-35`）。
- 图操作 API：`CanvasGraphStore`（`lib/canvas-core/canvas-graph-context.tsx:14-43`）——addNode/patchNodeData/removeNode/selectNodes/undo/redo；只读用户拿到 no-op 变更器。
- 连线契约：每张卡恰好两个 handle（target=`input`，source=`output`）；连线后 `bindEdgeReference` 把源的产出作为 `CardReference` 绑进目标的路由字段（`canvas-wiring.ts:89-119`）。**生成完成时 `applyJobUpdate` 自动把产物回填进所有下游连线卡片**（`use-canvas-generation.tsx:375-414`）——这是分镜"画面槽自动更新"的免费引擎。
- 选择是短暂态（awareness 广播，不进文档）；聚焦某节点用 `graph.selectNodes` + `fitView({nodes})`（`use-canvas-tidy.ts:79-84`）。

### 1.3 服务端文档模型（结论：v1 零改动）

- `PlatformDocument`：contentSnapshot JSONB + crdtState Bytes + 操作日志 + 版本表；CRDT 文档的 contentSnapshot 由 CompactionService 独占派生（`document-compaction.service.ts:8-40`）。
- **内容不做按类型校验**（`documents/dto.ts:10-11`，全是 `z.record(z.unknown())`）——新增节点类型不需要任何服务端 schema/迁移。
- ⚠️ 服务端存在一个**竞争性的 storyboard 身份**：`PlatformDocumentType.storyboard` 枚举值 + 遗留路由 `POST projects/:id/storyboard/ensure`（`documents.controller.ts:85`，老 web fizzstudio 在用）+ `document-modes.ts:12-14` 把它框成 patch 模型。**新功能完全绕开这三者**——调用它们会创造一份与画布悄悄分叉的第二文档。

### 1.4 老分镜表功能盘点（apps/web art-studio，Java 后端）

18 个内置列（镜号/场景/角色/画面/生图提示词/视频提示词/画风/台词/时长/景别/视角/运镜/状态/分镜图/分镜视频/对口型/配音/音乐）+ 自定义列系统；单元格富文本带 @提及（原始 HTML 入库）；多候选媒体 + 定稿（preferred）语义；客户端串行批量生成（10 秒 sleep，刷新即孤儿）；AI xlsx 导入带可编辑预览。

**值得继承的交互词汇**（在新底座上重表达，不搬实现）：定稿语义、行上下插入 + place-before 排序、提示词优先级（显式列 > 引用列 > 默认拼装）、批量跳过已定稿、导入预览。
**明确抛弃**：自定义列 CRUD + aiRef 接线（最大复杂度、最小价值）、value/values/files/richText 四镜像的单元格形状、HTML 提及标记、卡片视图（画布本身就是卡片视图）、双份保存层（cell-utils / storyboard-view 各一份 + storyboard-save.ts 1600 行——它还是 web 端 `ignoreBuildErrors` 的元凶之一）。

---

## 二、目标设计

### 2.1 `shot` 节点类型

```
type: "shot"
data (全部扁平顶层字段——CRDT 字段级合并要求，两人同时编辑不同字段互不覆盖):
  order:        string   // fractional index，表格排序的唯一事实
  shotSize?:    string   // 景别（远/全/中/近/特写）
  perspective?: string   // 视角
  movement?:    string   // 运镜
  durationSeconds?: number
  dialogue?:    string   // 台词/旁白（v1 纯文本；@提及结构化引用 v2）
  notes?:       string   // 备注
  references?:  object   // 画面槽：标准 CardReference 路由字段（复用连线机制）
  label?:       string   // 可选自定义镜头名
```

设计要点：

1. **镜号是投影不是存储**：表格按 `order` 排序后的 1-based 行号即镜号。插入/重排不触发任何"重编号"写操作（fractional index，Figma/Notion 验证过的方案）。
2. **画面槽 = 标准路由引用字段**：把 `shot` 接入 `canvas-wiring.ts` 的三张类型映射表（`sourceOutputKind :34-44` / `sourceMediaUrl :47-60` / `sourceMediaAssetId :63-76` 不需要——shot 无输出；只需 target 侧路由接受 image|video 产出进 `references`）。由此免费获得：连线即填画面、生成完成自动回填、删除自动解绑（`removeNodeCascade :198-207`）、blob: URL 拒绝。
3. **shot 节点只有 `input` handle，没有 `output`**——镜头是消费端不是素材源，这条约束同时把"镜头连镜头"这类无意义连线挡在 `isValidConnection` 外。
4. **叙事字段归节点、生产字段归生成卡**：提示词/模型永远住在连过来的 prompt/video 节点上。表内"编辑提示词"= 编辑连线的生成卡（见 2.3）。

### 2.2 画布侧渲染（胶片帧卡片）

新组件 `components/canvas/authoring/shot-node.tsx`，参照 `note-node.tsx:12-48` 的骨架：

- 帧式卡片：画面区（`references` 首个引用的预览 / 空槽占位）+ 镜号角标（对 shots 集合按 order 计算）+ 景别/时长 chips + 台词一行截断；
- 头部带 `CANVAS_NODE_DRAG_HANDLE_CLASS`（`canvas-interaction-policy.ts`），内部交互区 `nodrag/nowheel`；
- `CanvasNodeToolbar` 挂删除/评论 + 新增"在分镜表中查看"；
- 创建入口：add-menu + dock 各加一项（`add-node-menu.tsx:15,:41-49`、`canvas-authoring-chrome.tsx:146-157`、`use-media-authoring-canvas.ts:484-544` 种默认 data：order 取当前 shots 尾部 fractional next）。
- tidy 布局若帧卡高度显著异于 ~200px，给 `useCanvasTidy` 传 `estimateHeight`（`use-canvas-tidy.ts:44-49`），否则整理时会重叠。

### 2.3 分镜表模式（storyboard editor）

**注册**（`registry.ts`）：

```ts
storyboard: {
  type: "canvas",          // ← 语义改为"所用文档类型"；shot 表投影的就是 canvas 文档
  slug: "storyboard",
  labelKey: "modes.storyboard",   // 收窄联合类型要放开 + 三语言词条
  Icon: IconLayoutList,
  Editor: StoryboardEditor,
}
```

同时把 `registry.ts:17` 的 `type` 字段注释改写为 `documentType`——侦察确认它是死代码，但留着"mode 身份"的旧注释会诱导后人把它接进文档解析，恰好焊死我们要打破的 mode==own-document 假设。

**编辑器**（`_modes/storyboard-editor.tsx`）：

- `useProjectContext()` 拿 projectId/canEdit → **`useCanvasDocument(projectId)`**（绝不是 `useModeDocument(projectId,"storyboard")`）→ `useCanvasDoc(documentId, user)`（硬绑 CANVAS_ROOT_SCHEMA——schema 跟文档走，不跟模式走）；
- 读：订阅 nodes map，过滤 `type==="shot"`，按 `order` 排序成行；其余节点类型对表格不可见；
- 写：文本/选择单元格 → `patchNodeData(nodeId, updater)`（**必须用 updater 函数形式**做读改写，防 LWW 撞车）；行删除 → `removeNodeCascade`；行插入 → `writeNode`（order 取邻位 fractional 中值，position 落在画布"分镜区"网格——最后一个 shot 的右侧偏移，无 shot 则视口中心）；拖拽重排 → 只改 order；
- 文本单元格保存纪律继承老实现的教训（`richtext-cell.tsx:39-70` 注释里那套 caret 经验）：本地 state 即时渲染 + 800ms 尾随防抖 patch + blur/卸载冲刷。CRDT 天然多人合并，无需乐观回滚；
- awareness：只发 `user` 字段，**不发 `cursor`**（那是画布世界坐标语义，`collaborative-canvas-view.tsx:92-104`）；
- 只读角色（viewer）：单元格只读渲染——graph store 对 viewer 本来就发 no-op 变更器，双保险。

**v1 固定列**（来自老功能盘点的裁剪）：

| 镜号(计算) | 画面 | 景别 | 视角 | 运镜 | 时长 | 台词 | 备注 | 行操作 |

**画面单元格**：

- 空槽：占位 +「生成」/「从画布选择」两个动作；
- 「生成」→ 在该 shot 附近创建 prompt（或 video）节点 + 自动连线到 shot 的 input → 打开该生成卡的提示词/模型弹层（复用生成卡已有 UI）→ 提交即走现有 `/aurora/ai/jobs` 全链路，**完成时画面槽因连线自动出现产物，零新增生成代码**；
- 有画面：预览 + 点击跳画布聚焦源节点。

### 2.4 双向丝滑跳转

- **表 → 画布**：行点画面/跳转按钮 → `router.push(/project/:id/canvas?focus=<nodeId>)`；canvas 编辑器新增读取 `focus` 查询参数：挂载后 `graph.selectNodes([id])` + `fitView({nodes:[{id}], duration})`（`use-media-authoring-canvas.ts:195` 已有同款 API 使用）。这是本方案对画布编辑器唯一的功能性改动；
- **画布 → 表**：shot 节点工具栏「在分镜表中查看」→ `/project/:id/storyboard?row=<nodeId>`，表格滚动至该行并高亮两秒；
- 模式切换本身零数据转换：同一 Y.Doc、同一 IndexedDB 缓存（按 documentId 键控，`document-provider.ts:99`）、同一 WS 房间——切换即换渲染器。

### 2.5 Copilot 工具接入（v1.5，可与 v1 并行）

`add_node` 的 kind 枚举加 `"shot"`：服务端 `copilot.tools.ts:35` + 提示词 `copilot.prompt.ts:72`，客户端守卫与创建分支 `use-copilot-tools.ts:93-137`、`nodeLabel :39-46`、digest 标签。**服务端声明/客户端执行，两端必须同版发布**。不进 CONFIRM_TOOLS（创建镜头非花钱非破坏）。这一步做完，"帮我把这个故事拆成 8 个分镜"就是一句话的事。

---

## 三、服务端改动清单

**v1：零。** 逐项确认：

| 项              | 结论     | 依据                                             |
| --------------- | -------- | ------------------------------------------------ |
| 新文档类型/枚举 | 不需要   | 复用 canvas 文档                                 |
| 新表/迁移       | 不需要   | shot 存于文档 CRDT                               |
| ensure 路由     | 复用现有 | `documents.controller.ts:106-120` 对任意类型幂等 |
| 内容校验        | 不需要   | 画布内容 schema-agnostic（`dto.ts:10-11`）       |
| 权限            | 继承     | viewer 读 / editor 写，document 级已就位         |
| 实时            | 继承     | 同一 WS 房间                                     |

**明确的"不许碰"清单**：遗留 `projects/:id/storyboard/ensure` 路由、`PlatformDocumentType.storyboard`、patch 模型 `updateDocumentSnapshot`（CRDT 文档的 contentSnapshot 是压缩器独占的派生态，`document-compaction.service.ts:8-10`——表格编辑器必须走 Yjs 变更）。

v2 可选：若要服务端强校验 shot 形状，参照 Story Studio 生产画布的 Zod 模板（`story-production-canvas.schema.ts:108-207`），在 `documents/dto.ts:59-81` 的天然接缝挂按类型判别 schema。注意历史自由格式内容的兼容。

---

## 四、老入口退役

- `apps/web/(studio)/art-studio` 的分镜表 tab 隐藏（同文游选项的下线打法：拿掉入口、读路径暂留），整个 art-studio 属于 web 遗留清退大盘子，不在本方案展开；
- Java `shot/shotColumn/shotValue` 端点不动不调——随 art-studio 整体退役；
- **无数据迁移**（已拍板）。如运营侧后来反悔，唯一保留的后路是 Java 的 xlsx 导出（`/api/user/shot/export/:id`）→ 新表 v2 的导入预览，属人工搬运不属系统兜底；
- `src/lib/storyboard-save.ts`（1600 行、ignoreBuildErrors 元凶）随入口隐藏进入死代码候删名单。

---

## 五、风险与对策

| #   | 风险                                                                                                                                                           | 对策                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **LWW 撞字段**：两人同时编辑同一 shot 的同一字段互相覆盖                                                                                                       | data 全扁平字段（不同字段并发安全）；读改写一律 `patchNodeData(updater)`；台词这类长文本 v1 接受 LWW（真实并发概率低），v2 可升 Y.Text                            |
| 2   | **类型字符串散落联合**：`prompt\|video` 硬编码在 `use-canvas-generation.tsx:322/461/525/608`、`canvas-wiring.ts:81`、审核清扫 `:525-540` 等处，漏扫=静默无行为 | 实施清单逐点核对（§六 M1 验收含专项检查）；shot 不自带生成故不进 jobId 路由；**审核清扫必须覆盖 shot 的画面引用**（takedown 时清 references），此项列为 M4 硬验收 |
| 3   | **root schema 传错**：storyboard 模式误传自有 schema 会腐蚀文档根类型声明                                                                                      | 编辑器强制走 `useCanvasDoc`（硬绑 CANVAS_ROOT_SCHEMA），代码评审点名检查                                                                                          |
| 4   | **registry.type 被"补全"**：后人把死字段接进文档解析，焊死 mode==own-doc                                                                                       | 本次顺手改注释+改名 documentType（§2.3）                                                                                                                          |
| 5   | **单 provider 假设**：未来若做画布+表格分屏，双编辑器各起 provider 会撞（`use-collab-doc.ts:41-66`）                                                           | v1 只做兄弟路由切换；分屏留 v2，届时共享 provider 实例                                                                                                            |
| 6   | **版本历史是文档级**：从画布历史恢复版本会连分镜一起回滚                                                                                                       | 表格模式的历史入口沿用同一 UI 并在文案标注"项目画布整体版本"                                                                                                      |
| 7   | **viewer 首开 403**：画布文档尚不存在时 viewer 进 storyboard 会拿到创建权限错误（与画布模式今天行为一致）                                                      | 编辑器错误态给出明确文案（"项目尚未初始化画布"）                                                                                                                  |
| 8   | 帧卡与 tidy 布局重叠                                                                                                                                           | `estimateHeight` 传入（§2.2）                                                                                                                                     |

---

## 六、实施里程碑与实测验收

按"实测为主、单测为钉"的纪律，每个里程碑以真实浏览器双开操作为验收。

**M1 — shot 节点上画布**（node 组件 + NODE_TYPES 注册 + dock 入口 + i18n）
验收：双浏览器同项目，A 创建/拖动/编辑 shot 字段，B 秒级可见；刷新/离线重连数据完好；tidy 不重叠；`prompt|video` 联合点位核查记录在 PR 描述。

**M2 — storyboard 模式（只读投影）**（registry 项 + editor + 行渲染 + 排序）
验收：画布加 3 个 shot → 切表格模式行序正确；A 在画布改景别，B 表格实时变；模式来回切换无闪烁无重载（外壳不重挂载）。

**M3 — 表格编辑闭环**（单元格编辑 + 行增删 + 拖拽重排 + 保存纪律）
验收：表内改台词→画布帧卡同步；插入行的 order 落在邻位之间且画布出现新帧；双人同时改同一 shot 的不同字段互不覆盖；输入中文全程无 caret 跳动。

**M4 — 画面槽 + 表内生成**（wiring 路由接入 + 空槽生成流 + 审核清扫覆盖）
验收：画布连线 image→shot 画面即现；表内点生成→生成卡创建并连线→任务完成画面槽自动出现（全程不碰画布模式）；删除生成卡后槽位正确置空；**模拟 moderation takedown，shot 引用被清扫**。

**M5 — 双向跳转 + 退役 + 收尾**（focus/row 参数 + shot 工具栏入口 + web 端老分镜 tab 隐藏）
验收：表→画布聚焦动画正确；画布→表滚动高亮；web 端入口不可见且存量页面读路径不 500；三语言词条齐全。

粗估：M1≈1.5d，M2≈1d，M3≈2d，M4≈2d，M5≈1d，加联调余量 **~1.5 周单人**。M1/M2 可并行起步（M2 先只读，不依赖 M1 的创建入口）。

**v2 展望**（按老功能盘点的继承清单排期）：定稿/多候选（映射 generation outputs 选择）、批量生成（上服务端任务队列，对齐 AI job 观测方向）、配音列 + 合成、AI xlsx 导入预览、@提及结构化引用、台词 Y.Text 化、画布+表格分屏。

---

## 附：本方案落笔依据

四路并行代码侦察（外壳/画布内核/服务端文档模型/老功能盘点，约 53 万 token 阅读量），关键结论均带 file:line 锚点散布于正文；完整侦察 JSON 存于会话 scratchpad `recon/` 目录。实施前若 develop 相关区域有新提交，以 M1 开工时的再核对为准。
