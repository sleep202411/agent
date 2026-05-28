# FizzDragon 平台核心产品技术设计

状态：草案
负责人：FizzDragon Platform
目标后端：`apps/server` + PostgreSQL + Redis
Legacy 后端：Java + MySQL
目标前端：`apps/web`

## 1. 文档目标

这份文档定义 FizzDragon 下一代平台核心的产品与技术架构。

目标不是先上线一个半成品 MVP，而是一次性按完整平台底座设计，开发按阶段推进，等核心闭环完整后再上线。

这套平台核心需要支撑：

- Workspace 和团队归属
- Project-based 创作
- 项目资产和个人资产
- 存储容量和资产保留策略
- 工具积分和社区积分
- 会员系统和团队套餐
- AI 生成队列和多供应商路由
- StoryOS 多人协作
- 协同分镜表
- 时间线和未来画布模式
- IP / 剧集定价、购买、权益
- 课程购买和学习权益
- 创作者服务包、订单、站内沟通
- 后台管理、财务、审计、故障排查

## 2. 架构方向

### 2.1 目标系统

```text
Web
  |
  | /aurora/*
  v
NestJS Server
  |-- PostgreSQL：核心业务数据
  |-- Redis：队列、锁、在线状态、pub/sub
  |-- Object Storage：OSS / Azure Blob / S3-compatible storage
  |-- AI Providers：Fal、Replicate、Suno、OpenAI、Azure 等
  |-- Java Adapter：legacy 只读 / 登录态桥接
  v
Admin / Ops / Workers
```

### 2.2 Java 边界

Java + MySQL 在迁移期保留为 legacy 系统。它可以继续维护老用户、老 IP / 项目 / 剧集、老生成记录、老素材、老接口。

Java 不应该继续承载新的平台核心领域：

- Wallet / Ledger
- 会员系统
- 团队系统
- 新 AI 生成任务
- 新队列系统
- 新协同分镜
- 时间线
- 项目资产归属
- 新 IP 购买 / 权益
- 课程购买 / 权益
- 创作者服务订单
- 订单聊天

长期方向：

```text
Java bugfix + legacy read
  -> Java 数据和接口盘点
  -> Nest/PG 承接新系统
  -> legacy 数据迁移 / adapter
  -> Java 只读
  -> Java 下线或仅归档
```

### 2.3 不做双写

同一个业务动作不要同时写 Java MySQL 和 Nest PG。

错误示例：

```text
剧集购买
  -> Java 写订单
  -> Nest 写积分流水
  -> Java 写访问权益
  -> Nest 写会员折扣
```

这种模式会导致跨系统事务和对账问题。新系统必须以 Nest + PG 作为准源。

## 3. 产品原则

1. Workspace 是归属、容量、套餐、账单边界。
2. Project 是创作和协作边界。
3. 项目内创建的资产默认归项目。
4. 资产归属、资产创建者、存储计费、算力计费是不同概念。
5. AI 输出必须先进入 proposal 或 job result，不能直接覆盖正式内容。
6. 生成任务必须支持报价、冻结、排队、执行、成功扣费、失败退款、重试、审计。
7. Document 是项目里的编辑视图和协作边界，例如分镜表、时间线、画布、剧本、StoryOS 会话上下文。
8. 核心实体只存一份，不同 document 通过引用共享。
9. 被引用资产不能物理删除。
10. 前端错误反馈必须展示可操作的后端细节。
11. 后台管理和运维排障能力是生产级上线前提。

## 4. 核心概念

### 4.1 Workspace

Workspace 是账户边界。

类型：

- `personal`：个人空间，权益来自用户个人会员。
- `team`：团队空间，权益来自团队套餐。

Workspace 承载：

- 存储容量
- Wallet 账户
- 会员 / 团队权益
- 团队或项目预算
- 审计范围

### 4.2 Project

Project 是创作业务容器。

Project 承载：

- 项目资产
- 项目 documents
- StoryOS conversations
- AI generation jobs
- 项目成员
- 项目设置
- 项目审计事件

Project 可以在 workspace 之间转移。项目转移只改变未来容量和账单责任，不重写历史审计或历史流水。

### 4.3 Asset

资产类型包括：

- 图片
- 视频
- 音频
- 文件
- Prompt / output bundle
- 缩略图 / proxy / derived object

项目资产和个人资产是不同产品概念。

用户在项目内生成、上传、导入的资产，默认成为项目资产，不自动进入个人图库。

用户从个人图库选择资产加入项目时，产品上应该创建项目资产副本或永久项目授权。原始个人资产仍属于个人。

### 4.4 Document

Document 是项目里的编辑工作区和协作边界，不是 MongoDB 那种单 JSON 文档。

例子：

- 分镜表 document
- 时间线 document
- 画布 document
- 剧本 document
- StoryOS 会话关联 document

不同 document 存储不同视图 / 编辑状态，同时引用同一份项目核心内容。

例子：

```text
StoryboardShot：镜头内容
TimelineClip：这个镜头在时间上的编排
CanvasNode：这个镜头在画布上的位置
Conversation：围绕这个镜头的讨论
```

镜头内容不会在这些地方重复存多份。

### 4.5 Proposal

Proposal 是一个待确认的变更建议。

来源：

- StoryOS
- AI 生成
- 手动批量操作
- 导入 / 迁移

所有 AI 驱动的正式内容修改，都必须先进入 proposal，再由用户确认应用。

## 5. 目标领域模型

### 5.1 Workspace 和 Project

```text
workspaces
workspace_members
projects
project_members
project_settings
project_transfers
audit_logs
```

### 5.2 资产和存储

```text
storage_objects
project_assets
personal_assets
asset_variants
asset_references
asset_retention_policies
```

### 5.3 Document 和协作

```text
project_documents
document_operations
document_versions
document_locks
document_presence
```

### 5.4 分镜表

```text
storyboard_shots
storyboard_columns
storyboard_cells
storyboard_asset_refs
storyboard_revisions
```

### 5.5 时间线

```text
timeline_tracks
timeline_clips
timeline_transitions
timeline_markers
```

### 5.6 画布

```text
canvas_nodes
canvas_edges
canvas_groups
canvas_view_states
```

### 5.7 StoryOS 和 AI 协作

```text
conversations
conversation_messages
agent_runs
proposals
proposal_events
```

### 5.8 AI 生成

```text
ai_model_catalog
ai_provider_catalog
generation_jobs
generation_outputs
generation_attempts
provider_events
generation_costs
```

### 5.9 Wallet、积分、会员

```text
wallet_accounts
ledger_transactions
membership_plans
membership_subscriptions
membership_entitlements
team_plans
```

### 5.10 商业化

```text
orders
order_events
entitlements
ip_price_rules
course_price_rules
creator_services
creator_service_orders
order_conversations
```

## 6. Workspace 和团队设计

### 6.1 Personal Workspace

每个用户都有一个 personal workspace。

Personal workspace 的能力来自用户个人会员：

- 存储容量
- 每日免费额度
- 工具积分发放
- 队列优先级
- AI 模型权限
- 并发数
- 项目协作者数量
- 个人项目数量

Personal project 可以支持轻协作。

### 6.2 Team Workspace

Team workspace 的能力来自团队套餐：

- 团队存储容量
- 团队 wallet
- 团队席位
- 团队资产库
- 团队项目预算
- 高级角色和权限
- 审计和财务报表
- 共享模型设置

团队项目属于团队，不属于某一个个人。

### 6.3 Project Transfer

项目转移本质是 workspace 迁移：

```text
project.workspaceId：source workspace -> target workspace
project.ownerUserId：source owner -> target owner/admin
```

转移规则：

- 完整项目转移包含所有项目资产和 documents。
- 接收方 workspace 必须有足够容量。
- 历史 ledger 和 audit 不重写。
- 项目资产仍然是项目资产。
- 原 owner 默认失去 owner 权限，除非被保留为成员。
- 原个人资产不会被转让；项目副本或授权继续有效。

如果接收方容量不足：

- 扩容 / 购买容量包。
- 转移到 team workspace。
- 创建轻量交付副本，而不是完整项目转移。

## 7. Asset 和 Storage 设计

### 7.1 资产归属规则

在 project 上下文：

- 生成资产 -> project asset
- 上传资产 -> project asset
- 导入个人资产 -> project asset copy/license
- AI 编辑结果 -> project asset
- 时间线输出 -> project asset

资产不会自动进入用户个人图库。

如果项目策略允许，用户可以显式保存个人副本。

### 7.2 存储计量

存储按 workspace 计量。

```text
Personal workspace
  project A：3 GB
  project B：4 GB
  personal gallery：1 GB

Team workspace
  project X：120 GB
  project Y：200 GB
  team library：60 GB
```

Project 可以有用量上限，但不是独立账单账户。

### 7.3 保留和删除

资产状态：

```text
active
protected
hidden
over_quota_expiring
trash
deleted
```

规则：

- 被引用资产进入 protected。
- hidden 资产从图库隐藏，但引用它的项目内容仍然可用。
- 超额清理只处理未引用、未锁定、低价值资产。
- 物理删除必须先做引用扫描，并且通过保留期。

## 8. StoryOS 协作

### 8.1 多成员同时使用 StoryOS

一个 project 可以有多个 StoryOS 会话：

- 项目主会话
- 项目内个人工作会话
- 对象级会话，例如 shot、character、scene、timeline clip

成员可以同时使用 StoryOS。各自会话不会互相覆盖。

### 8.2 Proposal 流程

AI 输出不能直接修改正式内容。

流程：

```text
用户向 StoryOS 提问
  -> AgentRun
  -> Proposal(diff)
  -> UI 预览变更
  -> 用户应用
  -> 写 DocumentOperation
  -> 正式内容更新
  -> 写 AuditLog
```

Proposal 支持：

- 新增镜头
- 删除镜头
- 修改单元格
- 调整镜头顺序
- 添加资产引用
- 修改剧本块
- 创建时间线 clip
- 添加画布节点

## 9. 分镜表设计

### 9.1 产品定位

分镜表是结构化创作规划 document，不是时间线。

分镜表负责：

- 镜头顺序
- 镜头号
- 场景
- 角色
- 画面描述
- 台词
- 镜头运动
- 景别
- 计划时长
- 状态
- 参考资产
- 生成结果资产

### 9.2 数据模型

推荐混合模型：

```text
storyboard_shots
  核心可查询镜头字段

storyboard_columns
  自定义 / 可配置列

storyboard_cells
  灵活 cell value

storyboard_asset_refs
  镜头资产引用
```

不要把整张分镜表存成一个 JSON blob。

### 9.3 实时编辑

每次编辑写一条 document operation：

```text
insertShot
deleteShot
moveShot
updateCell
updateColumn
addAssetRef
removeAssetRef
applyProposal
```

这样支持：

- WebSocket 广播
- 断线追更
- 版本历史
- 审计
- 撤销 / 重做基础
- 未来 CRDT 集成

## 10. 时间线设计

分镜表和时间线分开。

```text
StoryboardShot = 叙事规划
TimelineClip = 播放和剪辑编排
```

在时间线移动 clip，不自动改变分镜顺序。修改 timeline duration，也不自动改变 storyboard planned duration。

推荐字段：

```text
StoryboardShot.plannedDurationMs
TimelineClip.durationMs
TimelineClip.startMs
TimelineClip.sourceStartMs
TimelineClip.sourceDurationMs
TimelineClip.durationSource: storyboard_planned | manual | asset_native
TimelineClip.orderSource: storyboard | manual
```

如果用户希望把时间线调整同步回分镜表，系统应该创建 proposal，让用户确认。

## 11. 画布设计

画布是 project entities 和 assets 的空间视图。

画布存储：

- 节点位置
- 节点尺寸
- 分组
- 连线
- 视图状态
- 布局 metadata

Canvas node 引用核心实体：

```text
CanvasNode.linkedEntityType = storyboard_shot | asset | character | scene
CanvasNode.linkedEntityId = target id
```

画布不复制底层 shot / asset / character 内容。

## 12. AI 生成平台

### 12.1 统一 Job 模型

所有生成入口使用统一 job 模型：

- 图片
- 视频
- 音乐
- 语音
- Agent
- 编辑 / 转换

Job 生命周期：

```text
quoted
  -> frozen
  -> queued
  -> running
  -> succeeded
  -> failed
  -> refunded
```

### 12.2 Outputs

一个 job 可能返回多个 outputs。

例如音乐供应商一次请求可能返回两首歌：

```text
generation_job
  -> generation_output A
  -> generation_output B
```

定价和资产归属必须同时理解 job 和 output。

### 12.3 Provider Routing

两种模式：

- FD managed route：平台根据质量、成本、容量、失败率选择 provider/model。
- Direct model route：高级用户选择具体模型 / provider。

FD managed route 可以做综合毛利优化。Direct model route 可以收较低服务费，但仍然计算基础设施、重试和存储成本。

### 12.4 Queue

队列优先级考虑：

- 会员等级
- 团队套餐
- 任务类型
- 模型稀缺度
- 供应商健康度
- retry count
- 成本风险
- 用户风控 / rate limit 状态

高级用户获得更高优先级和并发，不是无限插队。

## 13. Wallet、积分、会员

### 13.1 积分类型

```text
tool_credit
  AI 生成和工具算力。

community_point
  课程、IP、剧集、创作者服务、活动奖励、社区交易。
```

它们是不同 currency，但共享 Wallet/Ledger 基础设施。

### 13.2 Ledger 规则

所有余额变化都必须有 ledger：

- grant
- freeze
- charge
- refund
- expire
- adjustment

任何服务都不能绕开 ledger 直接改余额。

### 13.3 会员

会员是权益包，不是余额字段。

会员可以发放或影响：

- 每月工具积分
- 每日免费额度
- 队列优先级
- 并发
- 模型权限
- 存储容量
- 社区积分倍率
- 折扣
- 团队席位

## 14. IP 和剧集商业化

### 14.1 Java 边界

Java 可以维护 legacy IP content metadata：

- IP 标题
- IP 简介
- 剧集
- 封面
- 老内容 lookup

### 14.2 Nest 边界

Nest 负责商业化：

- IP 定价
- 剧集定价
- 购买订单
- 社区积分扣减
- 权益发放
- 退款
- 创作者收入
- 访问权限校验

剧集购买流程：

```text
Web -> Nest purchase endpoint
Nest -> Java lookup episode metadata
Nest -> pricing / membership discount
Nest -> order
Nest -> ledger charge
Nest -> entitlement
Nest -> response
```

## 15. 课程商业化

课程系统按新规范设计，不受现有 Java 接口限制。

Nest 负责：

- Course
- Chapter
- Lesson
- Course price
- Free preview
- Purchase entitlement
- Learning progress
- Admin management

课程优先使用 community_point 购买。

## 16. Creator Services 和订单

Creator Services 是交易入口，不是静态主页装饰。

Nest 负责：

- Service package
- Brief schema
- Order
- Order chat
- Deliverable
- Revision
- Acceptance
- Review
- Settlement

Java 只在需要时提供 identity / KYC / legacy lookup。

## 17. 后台和运维

生产上线必须有后台。

后台需要支持：

- Wallet 余额查询
- Ledger 查看
- 带审计的人工调整
- Generation job 搜索
- Retry / cancel / refund job
- Provider health
- 模型成本和毛利
- Queue 状态
- Storage usage
- Asset retention state
- IP / course / order entitlement 查询
- 用户会员状态
- 团队套餐状态
- Audit log 搜索
- Incident alert 查看

没有后台，这套系统不算生产级。

## 18. 可靠性要求

核心可靠性规则：

- 所有扣费 / 购买 / 生成 submit endpoint 都有 idempotency key。
- Job 状态机只能按合法状态迁移。
- Ledger transaction 必须在数据库事务内完成。
- 异步事件使用 outbox。
- Reconciliation jobs 修复 stuck queue、stuck ledger freeze、missing output。
- Provider callbacks 可重复处理。
- 资产上传记录 checksum。
- 所有关键动作写 audit log。
- 错误码结构化，并对 UI / admin 可见。

## 19. UI / UX 要求

每个生成入口必须展示：

- 资产保存到哪里：个人 / 项目
- 消耗谁的额度：个人 / 项目 / 团队
- 预计积分成本
- 队列预期
- 失败退款规则
- 模型 / provider 模式

每个项目必须展示：

- 当前 workspace
- 存储用量
- 项目成员
- 资产归属规则
- 最近任务
- 预算 / 积分来源

每个 AI proposal 必须展示：

- 将改变什么
- 影响哪个 document / entity
- 谁发起的
- Apply / reject controls
- 如果目标已变化，展示冲突提醒

每个购买动作必须展示：

- 价格
- 余额
- 折扣
- 购买后获得的权益
- 退款限制

## 20. 开发路线

开发路线是工程阶段，不是上线半成品路线。

### Phase 1：基础底座

- Workspace
- Project
- Project member
- Audit log
- Legacy Java adapter
- Permission guard

### Phase 2：资产和存储

- Storage object
- Project asset
- Personal asset
- Asset reference
- Storage quota
- Retention states

### Phase 3：Wallet 和 Membership

- Wallet account
- Ledger transaction
- Tool credit
- Community point
- Membership plan
- Entitlement snapshot

### Phase 4：AI Generation Core

- Model catalog
- Provider catalog
- Quote engine
- Generation job
- Queue
- Worker
- Output asset binding
- Refund and retry

### Phase 5：Storyboard V2

- Project document
- Storyboard shot
- Columns / cells
- Asset refs
- Operation log
- Versions
- WebSocket update path

### Phase 6：StoryOS Collaboration

- Conversation
- Agent run
- Proposal
- Apply proposal
- Entity-scoped sessions
- Multi-member collaboration rules

### Phase 7：Timeline 和 Canvas

- Timeline tracks / clips
- Timeline/storyboard sync proposal
- Canvas nodes / edges
- Entity references
- Version and operation support

### Phase 8：Commerce

- IP pricing
- Episode purchase
- Entitlement
- Course purchase
- Creator service orders
- Order chat

### Phase 9：Team

- Team workspace
- Team members
- Team wallet
- Team plan
- Project budget
- Team audit

### Phase 10：Admin 和上线加固

- Admin console
- Reconciliation jobs
- Incident alerts
- Cost / margin dashboard
- Load testing
- Migration scripts
- Production SOP

## 21. 上线标准

满足以下条件前，不应该上线：

- 资产归属清晰。
- Ledger 不会重复扣费。
- 失败任务可以正确退款。
- 项目转移会检查容量。
- 被引用资产不会被物理删除。
- StoryOS 不会绕过 proposal 覆盖正式内容。
- 分镜表支持 versioned operations。
- Queue 和 provider failure 可观测。
- Admin 可以检查和修复 stuck states。
- Java 不再是新核心领域的写入依赖。

## 22. 待决策问题

需要产品和工程确认：

1. 个人会员等级和具体容量。
2. 团队套餐等级和席位限制。
3. 项目协作者默认是否可以使用 owner / team 积分。
4. 项目成员是否可以保存项目资产的个人副本。
5. 团队管理员是否可以查看团队项目里的个人工作会话。
6. IP 购买退款策略。
7. 课程退款策略。
8. 音乐生成一次返回多个 output 时如何定价。
9. 不同套餐的存储 grace period。
10. 哪些 Java 数据表优先迁移。
