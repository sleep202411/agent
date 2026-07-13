# Story Studio 产品架构 v3

> 状态：目标态准源（2026-07-12）  
> 范围：多格式 Story Studio、互动影游生产、审核、Build、Release  
> 取代：已删除的文字画布专用 `story-studio-project-schema-v1.md`  
> 首个真实项目：《虎豹别墅：龙口入夜》；《金陵入梦》继续作为独立只读样例，零改动

## 1. 拍板结论

1. `StoryProject` 是 Story Studio 唯一项目根，与 `PlatformProject` 没有 FK、生命周期或路由关系。
2. `StoryProject.workspaceId` 直接关联 `Workspace`，只承担成员、算力、MediaAsset 与租户隔离；这不改变 Story 域主权。
3. `format` 创建后不可变：`text_adventure | interactive_film | narrative_rpg`。
4. `StoryDraft` 是可写创作头部；`StoryRevision` 是从指定 Draft CAS revision 锁出的不可变故事快照。
5. 所有影游生产对象显式带 `revisionId`。不存在可 unlock 的 Revision，也不存在依赖隐式 current revision 的 API。
6. StoryRevision 保存故事圣经、人物、世界规则、状态变量、选择图与结局规则；FilmClip 保存镜头生产规格。两者不复制真源。
7. Take 冻结 Prompt、参考版本、模型、Clip spec hash 与 input hash；修改镜头或参考后，旧 Take 保留但自动变 stale，不能进新 Build。
8. Build 冻结 Revision、Master Take 和媒体 checksum；Release 只能从成功 Build 创建且永远不可变。
9. 当前上线状态只由 `StoryDeployment` 表示；Release 本身没有 mutable status。
10. `AiJob.projectId`、`MediaAssetUsage.projectId` 继续只指向 `PlatformProject`。Story 归属通过 Take / ReferenceVersion 直接关联 AiJob 与 MediaAsset。

## 2. 生命周期

```text
StoryProject
  ├─ StoryDraft (mutable, CAS)
  ├─ StoryRevision (immutable)
  │    └─ Interactive-film production plane
  │         ├─ FilmSpec
  │         ├─ ReferenceSlot → Version → Review → Approval
  │         ├─ FilmClip → Take → Review → Approval → Master
  │         └─ Dependency → ContinuityCheck
  ├─ StoryBuild → frozen assets / frozen clip masters
  ├─ StoryRelease → frozen release assets / approval
  └─ StoryDeployment (mutable preview / production pointer)
```

状态机：

```text
Draft --lock--> immutable Revision

Take: queued → running → processing → ready
                    └──────────────→ failed | cancelled
ready + append-only review → approval → eligible master

Build: queued → validating → compiling → ready
                                  └────→ failed | cancelled

Release: ready Build → immutable Release → review → approval
Deployment: absent → active ⇄ offline; active(old) → active(new/rollback)
```

Clip 的 `blocked / ready / generating / in_review / approved / stale` 是查询投影，不持久化成第二真源。

## 3. 公共表

### `story_projects`

- `workspace_id`, `format`, `status`, `visibility`
- `title`, `summary`, `default_locale`, `cover_asset_id`, `tags`, `source_ip_id`
- `next_build_number`, `next_release_version`, `publish_revision`, `version`
- `created_by_user_id`, `archived_at`, timestamps
- 索引：`workspace + format + status + updated_at`
- SQL trigger：禁止更新 `workspace_id` 与 `format`

### `story_project_members`

- Story 专属角色：`owner | producer | editor | reviewer | viewer`
- 不复用 `ProjectMember`
- 成员还必须是对应 Workspace 的有效成员
- 每项目恰有一个 active owner；移除采用状态与 `removed_at`

### `story_drafts`

- 一项目一行
- `schema_version` 按 format 注册，不再提供文字画布全局默认值
- `content`, `content_hash`, `revision`
- `updated_by_user_id`, `updated_by_session_id`
- PUT 必须携带 expected revision；409 返回完整当前头部

### `story_revisions`

- `story_project_id`, `number`, `source_draft_revision`
- `schema_version`, `content`, `content_hash`, `label`, `source`
- `created_by_user_id`, `created_at`
- SQL trigger：禁止 UPDATE / DELETE
- 内容使用 canonical JSON 后计算 SHA-256

### `story_builds` / `story_build_assets`

- Build 显式指向 `source_revision_id`
- 编号由锁项目行后原子递增，不使用 `MAX + 1`
- 冻结 `source_production_revision`, `input_hash`, `input_manifest_hash`
- `runtime_json`, `runtime_hash`, diagnostics 与 path report
- BuildAsset 固定 logical key、MediaAsset、Variant、checksum、MIME、尺寸、时长与字节数
- Build 进入终态后，输入、runtime、报告与资产表不可修改

### `story_releases` / `story_release_assets`

- Release 是成功 Build 的不可变封装
- 冻结 StoryRevision、format、runtime、manifest 与 metadata
- ReleaseAsset 从 BuildAsset 复制，不重新解析“当前素材”
- SQL trigger：禁止 UPDATE / DELETE

### `story_release_reviews` / `story_release_approvals`

- Review append-only；Approval 指向一次 approve Review
- production release 必须获批才能部署
- four-eyes 策略下 reviewer 不得等于 release creator

### `story_deployments`

- 主键：`story_project_id + environment(preview|production)`
- `release_id`, `status(active|offline)`, `version`, deploy/offline audit fields
- offline 保留最后 release 指针，便于恢复；激活旧 Release 即回滚

## 4. 互动影游表

所有表同时保存 `storyProjectId + revisionId`，并用 composite FK 防止跨项目串线。

### `story_film_specs`

- 一 Revision 一行
- 目标时长、最大连续时长、生成单段上限
- 目标 Clip / Choice / Ending 数量
- 画幅、帧率、音频采样率、review policy
- `production_revision`：Clip、参考批准或 Master 变化时原子递增

### `story_film_reference_slots`

- 稳定 key：`REF-01`、`JF-01`
- kind：character / location / prop / graphic / style / join_frame / first_frame / last_frame
- required、rank、version、approvedVersion 指针

### `story_film_reference_versions`

- 一个 Slot 多个候选版本
- source：upload / ai_job / import / take_frame
- 直接关联 `AiJob`、`AiJobOutput`、`MediaAsset`
- take_frame 冻结来源 Take、0-based frame index 与来源输出 checksum；来源 Take 必须 ready、approved 且同 Project / Revision
- 冻结 prompt/config/checksum；不覆盖旧版本
- Review append-only，Approval 一对一；批准新版本不会删除旧审批史

### `story_film_clips`

- 稳定 `key` 与 `graph_node_id`
- generation mode：`frame_lock | omni_reference`
- frame mode：`first_frame | first_last_frame`（仅 frame_lock）
- `target_duration_ms`, `spec_json`, `spec_hash`, `version`
- `production_input_manifest` 与 `production_input_hash` 在所有必需参考批准前同为 null；禁止伪造占位 hash
- 入队时事务内解析并规范化 Clip、模型配置和已批准 ReferenceVersion，写入 manifest 后再计算 hash
- `spec_json` 只含 Prompt、逐秒 timeline、负面、对白窗口、输出合同；分支真源只在 StoryRevision
- 修改 spec 必须重算 hash、递增 version、清除 Master

### `story_film_clip_references`

- role：omni / first_frame / last_frame / continuity / style
- Frame Lock 禁止 Omni；Omni 禁止 first/last；服务端按模型能力验证数量
- first_frame 只接受 first_frame / join_frame Slot，last_frame 只接受 last_frame / join_frame Slot；每个 Frame 角色精确绑定一个 position=0 输入
- 引用 Slot 的 approvedVersion 是生产输入，不能只绑定“当前图片 URL”

### `story_film_clip_dependencies`

- predecessor / successor
- kind：required / continuity / convergence
- transition：direct / hidden_cut / shared_join_frame
- shared join 必须绑定同 Revision 的 join-frame Slot

### `story_film_takes` / `story_film_take_references`

- Take 直接关联 AiJob、AiJobOutput、MediaAsset、Variant
- `AiJob.projectId = null`；`AiJob.workspaceId = StoryProject.workspaceId`
- 冻结 `clip_spec_hash`, `production_input_hash`, Prompt、生成配置和具体 ReferenceVersion
- Take 保存不可变 `production_input_manifest`；hash 只覆盖影响生成结果的规范化字段，不包含 URL、时间戳、标签或状态
- Retry 新建 Take + AiJob；绝不覆盖旧 Take

### `story_film_take_reviews` / `story_film_take_approvals`

- Review append-only；reject / request_changes 必须有说明
- technical 与 safety 未通过不得 approve
- Review 与 Master 是两个动作；允许多个 Take 获批后再选 Master

### `story_film_continuity_checks`

- 绑定 dependency、upstream/downstream Take
- 保存自动指标、阈值、人工结论与 reviewer
- shared join-frame 还需校验两侧首末帧 checksum

### `story_film_build_clips`

- Build 时冻结每个 Clip 的 Master Take、spec/input hash、checksum 与 duration
- 必须证明 Take 属于该 Clip、已批准、不 stale，且使用当前批准参考版本

## 5. API 边界

根路径保持 `/aurora/story-projects`：

- Projects：list/create/get/workbench/patch/archive
- Draft：GET/PUT CAS
- Revisions：list/get/lock
- Film：spec、clips batch/detail/update、references batch/version/approval
- Takes：create/list/get/cancel/retry/reviews/master
- Builds：create/list/get/cancel/preview-token
- Releases：create/list/get/review/approve/activate/offline

所有创建与昂贵动作使用 `Idempotency-Key`。所有可写资源使用各自 version token，不能用一个 project version 替代 Draft、Clip、Review、production 与 publish 并发控制。

## 6. Build 与 Runtime

Build 必须验证：

- Revision 图可达、路由互斥且穷尽、条件/effect 合法
- 每个 Choice Exit 保存稳定 `decisionId`；同一决策可出现在多个前驱 Clip，但 Choice 数按 distinct decisionId 计算
- `checkpoint` 是单目标、无状态副作用的非叙事交互边界；Build 必须把它编译为 Runtime 内建 `story.checkpoint` overlay，并在后继片段前重置连续播放计时
- production full build 穷举所有路径，报告路径数、结局覆盖与时长范围
- 每个必需 Clip 都有 approved、non-stale Master
- Frame / Omni 模式合法，所有必需 ReferenceSlot 已批准
- MediaAsset 与 Variant ready、checksum 存在、moderation 可发布
- 所有媒体集合与图运行时所需集合完全相等

互动影游 Runtime 只使用现有 `InteractiveFilmReleaseSchema v1`。该 schema 应迁入 `@repo/shared`，由 Server 编译器、Studio Preview 与 Web Player共同引用，不再造第二套方言。创作域的 `checkpoint` 复用 v1 已有的 `external-overlay` 执行语义，并使用共享的内建 renderer/action 常量；未知 renderer 仍必须 fail loud。

## 7. 首个项目导入合同

《虎豹别墅：龙口入夜》导入后必须成为真实 `StoryProject(format=interactive_film)`：

- 120000 ms，8 个 15 秒播放段／路径；S06 与结局段之间有 1 个不计时、不分支的结局确认停点
- 6 choices、4 endings、21 clips
- 16 个正式输入槽：REF-01–08、JF-01–05、S00-FIRST、S00-LAST、E04-PREBLACK-END
- S00 与 E01–E03 使用 Omni Reference
- S01–S05 使用 First + Last Frame，并按层共享 Join Frame
- S06 使用 First Frame
- S01A/B 使用独立审核的 S00-LAST；E04 使用 S00-FIRST + E04-PREBLACK-END 的 First + Last Frame

导入不得按标题特判，也不得写入《金陵入梦》的文件、资产或数据库记录。

## 8. 数据迁移策略

旧文游创作者从未开放，没有兼容义务：

- 本地旧 StoryProject / Draft 行直接清理
- 删除旧 StoryOS creator generation API、v1/v2 canvas schema、backfill 与不可达 text canvas
- 不提供双读、upgrade-on-open、fallback parser 或兼容发布路径
- 任何远程／生产数据库变更仍需用户另行明确授权
