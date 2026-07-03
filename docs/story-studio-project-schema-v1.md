# Story Studio 数据模型 v2(主权版 — 2026-07-03 定稿)

> v1 → v1.1:3 视角对抗审查,16 confirmed。
> v1.1 → v2:按工程标准根治 —— **story 域与 Java 无关,Nest 完全主权**。
> 审查确认的三个 major(重发布覆盖 / 状态镜像漂移 / 下架端点缺失)全部源于
> "把 Java 当发布真源"的接缝设计;主权化后**整类问题不复存在**,无需任何契约增补。
> `docs/narrative-runtime-java-api-v0.md` 保留为未来 Java 侧(若接手玩家端)的接口
> 参考;对本模型而言 Java 至多是发布后的**可选投递适配器**(独立投递日志,零表影响)。

## 0. 分家理由(现状病灶)

1. 借宿 `PlatformProject`(`projectType` 字符串判别),读模型不透出类型 → 混进所有项目列表。
2. 草稿借宿 `PlatformDocument` 且与普通画布同用 mode key `canvas` → 两编辑器、两种不兼容
   格式争同一份文档,从普通入口点开可能**覆盖故事草稿**。
3. 发布生命周期在通用模型上无处安放;PlatformProject 的成员/邀请/演员表语义 story 域全不需要。

## 1. 设计原则

- **主权**:草稿、发布、上下架、审计、(将来)玩家端服务全在本域。没有镜像、没有对账、
  没有外部状态机。
- **草稿 = 画布快照 JSONB**,不做行级范式化(编辑器 700ms 整图防抖保存,真源是画布,
  编译器整份读;拆行零收益高摩擦 —— 明确拒绝)。
- **发布 = 本地事务产出不可变 release**(编译产物 runtimeJson 快照)。重发布 = 新
  release 版本;将来 session(第三批)钉在开局 release 上 —— 版本语义天然成立。
- 所有 DDL 纯增量,不碰现有表。

## 2. 表(Prisma)

```prisma
enum StoryProjectStatus { active  archived }

/// 本域自有的发布状态机(不镜像任何外部系统)。
/// unpublished → published ⇄ offline;republish 在 published 内滚 release 版本。
enum StoryPublishState { unpublished  published  offline }

enum StoryVisibility { private  public  unlisted }

model StoryProject {
  id           String             @id @default(uuid(7)) @db.Uuid
  ownerUserId  String             @map("owner_user_id") @db.VarChar(64)
  /// 仅为封面等 MediaAsset 对齐媒体管线;story 域无工作区协作语义。
  workspaceId  String?            @map("workspace_id") @db.Uuid
  /// 展示元数据唯一真源(R1:草稿保存写透至此);详情/列表/发布都读这里。
  /// 展示元数据可随时改、即刻生效(不需要重发布);运行内容只经 release 变更。
  title        String             @db.VarChar(160)
  summary      String?            @db.Text
  coverAssetId String?            @map("cover_asset_id") @db.Uuid
  locale       String             @default("zh-CN") @db.VarChar(16)
  visibility   StoryVisibility    @default(private)
  tags         Json               @default("[]") @db.JsonB // string[]
  status       StoryProjectStatus @default(active)
  sourceIpId   String?            @map("source_ip_id") @db.Uuid // bare,跨域不 FK

  // ── 发布指针(状态机归本域,无对账问题)──
  publishState     StoryPublishState @default(unpublished) @map("publish_state")
  liveReleaseId    String?           @unique @map("live_release_id") @db.Uuid
  publishedVersion Int?              @map("published_version")
  publishedAt      DateTime?         @map("published_at") @db.Timestamptz(6)

  version   Int       @default(0)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  /// 草稿保存写透 bump(R2)→ owner 列表排序键始终新鲜。
  updatedAt DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  draft       StoryDraft?
  releases    StoryRelease[] @relation("StoryProjectReleases")
  liveRelease StoryRelease?  @relation("StoryProjectLiveRelease", fields: [liveReleaseId], references: [id], onDelete: SetNull)
  cover       MediaAsset?    @relation("StoryProjectCover", fields: [coverAssetId], references: [id], onDelete: SetNull)

  @@index([ownerUserId, status, updatedAt(sort: Desc)], map: "story_projects_owner_idx")
  @@map("story_projects")
}

model StoryDraft {
  id             String @id @default(uuid(7)) @db.Uuid
  storyProjectId String @unique @map("story_project_id") @db.Uuid
  schemaVersion  String @default("story-studio-canvas-v1") @map("schema_version") @db.VarChar(40)
  /// {title, summary, storyAnalysis, canvas:{nodes,edges}}。title/summary 写透规则 R1。
  content        Json   @default("{}") @db.JsonB
  /// CAS 乐观锁;409 恢复契约 R5。
  revision           Int     @default(0)
  updatedBySessionId String? @map("updated_by_session_id") @db.VarChar(64)
  updatedByUserId    String? @map("updated_by_user_id") @db.VarChar(64)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  project StoryProject @relation(fields: [storyProjectId], references: [id], onDelete: Cascade)
  @@map("story_drafts")
}

/// 不可变发布快照 —— 本域的"已发布内容"真源(将来玩家端 detail/entry/turn 由此服务,
/// session 钉 releaseId)。同时天然是审计。Restrict:有发布史的项目不可静默硬删。
model StoryRelease {
  id             String  @id @default(uuid(7)) @db.Uuid
  storyProjectId String  @map("story_project_id") @db.Uuid
  releaseVersion Int     @map("release_version") // 1,2,3… 每项目递增
  schemaVersion  String  @db.VarChar(40) // narrative-runtime-v1
  /// 编译产物,写后不改。
  runtimeJson    Json    @map("runtime_json") @db.JsonB
  runtimeHash    String  @map("runtime_hash") @db.VarChar(64) // sha256
  /// 发布时的运行语言快照(服务端不解析 JSON 也能路由语言)。
  locale         String  @db.VarChar(16)
  publishedByUserId String   @map("published_by_user_id") @db.VarChar(64)
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  project     StoryProject  @relation("StoryProjectReleases", fields: [storyProjectId], references: [id], onDelete: Restrict)
  liveOf      StoryProject? @relation("StoryProjectLiveRelease")

  @@unique([storyProjectId, releaseVersion], map: "story_releases_version_unique")
  @@index([storyProjectId, createdAt(sort: Desc)], map: "story_releases_by_project_idx")
  @@map("story_releases")
}
```

发布 = **单个本地事务**:编译校验 → 插 release → 项目行更新
`publishState/liveReleaseId/publishedVersion/publishedAt`。无外部调用 → 无 pending/对账/
投递失败态。上下架 = 本域状态翻转 + `PlatformAuditLogService` 审计(复用平台审计,不造轮子)。
将来若向 Java 投递:独立 `story_release_deliveries` 日志表(额外增量,不回改本设计)。

## 3. API(Nest `/aurora`,新 `story-studio` 模块;owner-only)

| 方法   | 路径                            | 用途                                                           |
| ------ | ------------------------------- | -------------------------------------------------------------- |
| POST   | `/story-projects`               | 创建(空草稿)。编辑器路径**懒创建**:首个有意义动作才建,杜绝空行 |
| GET    | `/story-projects`               | 我的故事(轻量行,含发布指针,不含 JSONB)                         |
| GET    | `/story-projects/:id`           | 详情 + 草稿                                                    |
| PATCH  | `/story-projects/:id`           | 展示元数据(标题/简介/封面/tags/visibility/locale\*),即刻生效   |
| PUT    | `/story-projects/:id/draft`     | 自动保存:CAS(R5)+ 事务内写透 title/summary + bump 父行(R1/R2)  |
| DELETE | `/story-projects/:id`           | 归档软删;`published` 须先 unpublish(端点就在下面,路是通的)     |
| POST   | `/story-projects/:id/publish`   | (第二批)编译 → release → 指针翻转,单事务                       |
| POST   | `/story-projects/:id/unpublish` | → offline(本域状态翻转 + 审计)                                 |
| POST   | `/story-projects/:id/restore`   | offline → published                                            |

\*locale:未发布随意改;已发布时改 locale 标记「需重发布生效」(运行语言以 live release 快照为准)。

(第一批玩家端,后续切片:`GET /narrative/stories/:id`(公开详情)/ `:id/entry` /
`POST /narrative/turns` —— 由本表服务,detail/entry 读 live release,回合引擎在 Nest。)

## 4. 不变量(审查确认的坑,逐条钉死)

- **R1 标题/简介单一真源**:`StoryProject.title/summary` 为真源。PUT /draft 同事务从 content
  提取写透项目行(160 字符钳制)。列表/发布编译器只读项目行。
- **R2 列表新鲜度**:PUT /draft 同事务 bump `story_projects.updatedAt`;列表不 join 草稿表。
- **R5 草稿 409 契约**:CAS 失败返回 `{currentRevision, content, updatedAt, updatedBySessionId}`;
  同 session(自己另一标签页)静默取回续写,异 session 显式冲突横幅(载入最新 / 以我为准);
  每次 200 回显新 revision。
- **R6 发布前置校验**(服务层,400 列明缺项):summary 非空、封面可解析、草稿含 ≥1 plot
  - ≥1 ending、runtimeJson 过 schema 校验。
- **R7 审计不可删**:releases FK Restrict;归档(软删)不受影响,硬删须先显式处理发布史。

## 5. 迁移与切换(清理,不留旧路)

1. DDL:一个纯增量迁移(3 表 + 3 枚举)。
2. 回填:幂等脚本 `PlatformProject(projectType='story-studio')` + 其 canvas 文档快照 →
   新表(**沿用同一个项目 id**,旧编辑器链接 `?projectId=…` 无缝),旧 PlatformProject
   置 archived + 旧 PlatformDocument 随之退役。**先查 prod 行数**(story-studio 页已随
   tag 5ccb65e 在 prod studio,nav 禁用但直连可达)。
3. studio 客户端**整体切换**(不留双路径):新 `story-projects-api`;创建按钮 → 新 API;
   编辑器 hydrate/autosave → 新 API(带 revision);landing 货架 → 真实项目列表;
   无 projectId 编辑器 → 懒创建。`ensureModeDocument('canvas')` 在 story 域的用法删除。
4. 病灶随切换消失:列表污染(异表)、mode 冲突(不再用 PlatformDocument)、空 projectId
   陷阱(懒创建)、`/project/:id` 误开故事项目(不同实体,路由无从混淆)。

## 6. 明确不做 / 计划延伸

- 草稿行级范式化 —— 拒绝(§1)。
- 团队协作(成员/邀请)—— v1 无此语义。
- **Java 投递** —— 与本模型无关;若未来接,`story_release_deliveries` 增量日志即可。
- **AI 生成/资产关联(计划延伸)**:将来故事画布接 AI 生成时,增量加
  `AiJob.storyProjectId`(可空)+ MediaAssetUsage 增 story 实体类型;本设计不阻塞。
- 玩家端 session/turn 表(第三批)—— 到时在本域增量新增(session 钉 releaseId,
  版本语义已就绪)。
