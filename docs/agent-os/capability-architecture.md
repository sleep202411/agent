# Agent OS 能力架构与影游接入方案

状态：草案，待评审。不含 UI 渲染注册表（已决定延后）。

---

## 1. 要解决的问题

Agent OS 支持 storyboard / canvas / brief 三种工作台，但**这三者的边界不是一个结构，只是散落在共享文件里的数据**。一处能力由五个地方隐式构成：

| 文件                                               | 行数 | 边界以什么形式存在                                              |
| -------------------------------------------------- | ---- | --------------------------------------------------------------- |
| `packages/agent-tools/src/definitions.ts`          | 373  | 工具 id 的命名前缀约定                                          |
| `apps/agent-os/src/graph/build-langchain-tools.ts` | 382  | 手写绑定 + `byRegistryId` 字典                                  |
| `packages/agent-skills/src/builtin.ts`             | 276  | 某条记录的 `surfaces: [...]` 字段                               |
| `apps/server/.../agent-os-domain.service.ts`       | 843  | `execute()` 的 switch + 方法内 `if (kind !== 'platform') throw` |
| `apps/studio/.../approval-payload.tsx`             | —    | `if (toolId === "storyboard.upsertShots")` 链                   |

没有任何目录可以指着说「这一块的能力在这」。加影游会让五处各自再长一倍，而 domain service 已经 843 行。

---

## 2. 根因：两个轴被压成了一个字段

`storyboard` / `canvas` / `brief` **不是三个业务域**，是同一个业务域下的三个工作台视图：

- `_modes/registry.ts` 明写 storyboard 的 `documentType: "canvas"`——「the board's document, projected as shot rows — never its own document」，与 canvas 是**同一份文档的两种渲染**
- 三者同在 `/project/[projectId]/`，同一个 `PlatformProject`，同一套 `requirePlatformRead`
- 影游在 `/story-studio/projects/[projectId]/story`，是 `StoryProject` + `StoryProjectMember` + `StoryDraft` 分支树

真实结构是 **2 个 projectKind × N 个 mode**：

| 轴                | 由什么定义                     | 决定什么                    | 取值                                                   | 谁来定                      |
| ----------------- | ------------------------------ | --------------------------- | ------------------------------------------------------ | --------------------------- |
| **`projectKind`** | 数据实体 + 权限体系 + 落地实现 | 工具打到哪个库、走哪套 ACL  | `platform` / `story`                                   | **服务端**从 projectId 解析 |
| **`mode`**        | 工作台视图                     | 这一轮挂哪些工具 + 什么指令 | platform: `canvas`/`storyboard`/`brief`<br>story: 待定 | 客户端（用户在界面选）      |

### 命名：不造新词，接上代码里已有的两个

两个名字**在仓库里各自已经存在，且含义精确就是这两个轴**：

- `resolveProjectKind(): Promise<'platform' | 'story'>` —— `agent-os-domain.service.ts:173`。「kind」是诚实的：这个轴的判别方式就是拿 projectId 去 `platformProject` / `storyProject` 两张表试，本就是一个实体判别式
- `mode` —— Studio `_modes/registry.ts`，就是工作台视图

**真正的 bug 是这两个词从未对齐**：一个住在 Nest、一个住在 Studio，而线上协议把两者压成了单一的 `surface`。所以不是「该起什么新名字」，是「把已有的两个接上」。

排除的候选：

| 词          | 为什么不用                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `domain`    | **已被占用且是核心概念**：`DomainPort` / `AGENT_OS_DOMAIN_URL` / `domainMode` 指的是「worker 打回去的业务侧」。一词二义 |
| `workspace` | 已占用：`packages/agent-protocol/src/workspace.ts`，协议里 `workspace.type`                                             |
| `scope`     | 通用语汇里指「可见范围 / 权限边界」（OAuth scope、词法作用域），回答的是「能看到多少」而非「在哪个产品里」              |
| `scenario`  | 第三个说法，无对应代码，纯增翻译层                                                                                      |

`surface` → `mode` 的改动面很小：仓库里 646 处 "surface" 绝大多数是注释里的动词用法（"the failure surfaces as…"），**Agent OS 语义只在 8 个文件、18 处类型引用**。

---

## 3. 架构原则

### 3.1 可拔插的是「声明」，不是「执行」

| 类别 | 内容                                 | 形态                            |
| ---- | ------------------------------------ | ------------------------------- |
| 数据 | 指令、工具组合、主题 token、渲染映射 | **运行时装卸**                  |
| 代码 | domain 事务、ACL、React 组件         | **编译期独立模块 + 运行时开关** |

能力实现要在生产库上开事务、查 ACL、比对 revision；做成运行时可装载等于执行不受信代码碰生产数据。它应当**结构上独立、按项目开关**，但不应当**不发版就装进来**。

技能（提示词 + 工具组合 + 知识）是纯数据，不执行代码，装错了最多是表现变差——**插件故事该在这里**，且已建成约八成（`registerSkill()` 已存在）。

不做真插件运行时：那需要沙箱、版本契约、故障隔离、租户隔离、权限模型。模块化 + 配置能拿九成收益，成本约十分之一。

### 3.2 工具按「意图」划分，不按「数据操作」划分

这条决定影游能否替掉起草流水线。

`story-agent-patch.executor.ts:325-342` 的完整性校验作用在**整份草稿上**：遍历全图，任一节点引用了不存在的目标就抛 `STORY_PATCH_DANGLING_NODE_REFERENCE`。它是后置不变量，不是逐操作校验。

因此：

- **粗粒度**（现状 `applyPatch`，agent 一次给出全部操作）→ 漏建一个被引用节点，整份作废。**这正是流水线诞生的原因**
- **细粒度按数据操作**（`addNode` / `linkChoice`）→ **更糟**：增量建图的中间态天然非法，先建引用 B 的 A，B 尚不存在，立刻 DANGLING
- **细粒度按意图** → 正确。`story.addBranch(afterNodeId, choices)` 由工具实现**原子地**创建分支节点与全部目标节点，悬空在构造上不可能发生

工具边界替代流水线阶段承担引用完整性。agent 拿到的是「一次合法的意图」，而非「一整份可能自相矛盾的文档」。写错了当场拒绝并说明原因，agent 在对话里重试——比整份作废的体验更好。

---

## 4. 目标结构

```
packages/agent-capabilities/
  src/
    types.ts                 ProjectKindDefinition / ModeDefinition 契约
    registry.ts              注册表
    platform/
      tools/                 工具契约，按能力族分
        script.ts
        characters.ts
        storyboard.ts
        canvas.ts
      modes/                 mode = 工具子集 + 指令
        canvas.ts
        storyboard.ts
        brief.ts
      index.ts
    story/                   ← 影游新增
      tools/
        bible.ts
        graph.ts
      modes/
        story.ts
      index.ts

apps/server/src/agent-os-gateway/capabilities/
  capability-handler.ts      Handler 接口
  platform.handler.ts        ← 三个 mode 共用
  story.handler.ts           ← 影游落地点
```

**handler 按 projectKind 分，不按 mode 分**——落地实现、ACL、数据实体都是 projectKind 级的。这正好解释了现有那些 `kind !== 'platform'` 判断为何存在：它们是被误放在方法内部的 projectKind 分派。

线上协议拆成两个字段：`projectKind`（服务端解析，**不接受客户端指定**）+ `mode`（客户端传，即现有 `surface`）。业务域由数据决定、视图由用户选——顺带堵掉「客户端谎报业务域」这条路。

`build-langchain-tools` 改为遍历 mode 声明的工具。副产物：`zod/v3` 兼容导入消失、`operationId` 那段重复的手写 coerce 消失（`definitions.ts` 已有 `z.preprocess(coerceOperationUuid, …)`）。

---

## 5. 分阶段执行

### 阶段一：能力模块化（零行为变更）

纯搬运 + 换分派方式，**不改任何业务逻辑**。

1. 新建 `packages/agent-capabilities`，定义 `ProjectKindDefinition` + `ModeDefinition`
2. 现有三个 mode 全部归入 `platform`；工具契约按能力族拆入 `platform/tools/`，指令拆入 `platform/modes/`；`definitions.ts` / `builtin.ts` 改为聚合
3. 协议增加 `projectKind`（服务端解析），`surface` 更名 `mode`；`resolveProjectKind()` 成为 `projectKind` 的唯一来源
4. `build-langchain-tools` 改为遍历（先保留手写 schema，仅换成循环）
5. Nest 新增 handler 接口与 `platform.handler`，`execute()` 改为查表分派；方法内 `kind !== 'platform'` 判断上移到分派层

**验收**：现有 Agent OS、model-router、agent-protocol 与 server 测试全绿；候选模型通过生产 Gateway/Worker durable HITL 集成测试；.com 上分镜与画布各跑一轮真实对话。

**风险**：低。无行为变更，回滚 = revert。

### 阶段二：绑定层数据化（建议做）

让工具契约同时产出严格校验版与模型可见版，绑定层不再手写 schema。

**前置验证**：v4 schema 经 LangChain 转 JSON Schema 后模型能否正常调用。`.strict()`（→ `additionalProperties: false`）与 `z.preprocess` 的转换行为必须通过生产 Gateway/Worker durable HITL 集成路径实测。

**若不通过**：保留手写模型可见 schema，但与契约同文件相邻，靠 review 而非跨文件记忆维持一致。

### 阶段三：影游接入

新建 `capabilities/story/`（一个 projectKind + 一个 `story` mode）+ `story.handler.ts`。

工具清单（按意图划分，初稿）：

| 工具                  | 意图                      | risk  | 原子性保证                          |
| --------------------- | ------------------------- | ----- | ----------------------------------- |
| `story.read`          | 读草稿：图 + bible + 章节 | read  | —                                   |
| `story.updateBible`   | 世界观 / 角色             | write | —                                   |
| `story.addScene`      | 线性追加一场              | write | 自动接上前驱出口                    |
| `story.addBranch`     | 在某节点后加分支          | write | **分支节点 + 全部目标节点一次创建** |
| `story.editNode`      | 改单节点内容              | write | 不动拓扑                            |
| `story.removeSubtree` | 删节点及其失联后继        | write | **不留悬空**                        |
| `story.setEntry`      | 设入口                    | write | 校验目标存在                        |
| `story.reorder`       | 重排                      | write | —                                   |
| `story.applyPatch`    | 逃生舱：整份操作数组      | write | 复杂重构用，保留现有语义            |

Handler 内一律转调 `story-studio` 现有 service（`StoryPatchExecutor`、草稿读写、章节），**不重写业务逻辑**。权限走 `story-access.module`，不是 `requirePlatformRead`。

Studio 在影游挂 Agent OS 面板并传 `mode="story"`；`projectKind` 由服务端解析，客户端无从指定。

**验收**：《21克》或同等复杂度剧本，端到端跑通「加分支 → 审批 → 落库 → 画布可见」，且**连续 20 次写入零 DANGLING**。这是替掉流水线的硬门槛。

### 阶段四：起草流水线下线

阶段三验收通过后执行。流水线当前**未提交**，下线成本低。

保留 `StoryPatchExecutor` 及全部完整性校验——此时它们是工具的实现基础，不是流水线的附属。

---

## 6. 已知隐患（不在本方案范围）

**技能注册表的租户隔离**。`packages/agent-skills/src/registry.ts` 是进程级全局 `Map`；`skillIds` 是客户端直传字段（`agent-os-gateway.service.ts:96` 原样透传）；worker 单副本单进程。

今天无害——表内只有 `source: "system"` 的内建技能，且按 mode 过滤后客户端能挂的本就是 alwaysOn 会给的。

但注释写明 `Future install path: registerSkill(catalogSkill)`。一旦按此实现项目级技能包：项目 A 的技能进全局表 → 客户端传 `skillIds` 查同一张表 → **项目 B 猜到 id 即可挂载他人技能包**。

根因：项目级的东西被装进了进程级容器。正确形状是技能内容随请求解析（网关按项目查出、连内容一起传给 worker），而非先注册进全局再按 id 查。

**必须在做项目级技能包之前修正。**

---

## 7. 明确不做

- 真插件运行时（沙箱 / 动态加载 / 第三方代码）
- UI 渲染注册表——已决定延后。记录现状：`approval-payload.tsx` 按 `toolId` 硬编码分支，影游接入时该文件仍需改动，属已知技术债
- 微前端式的面板可插拔
- 影游数据模型的任何变更
