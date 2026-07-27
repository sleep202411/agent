# 导演 Agent 起草流水线设计定稿

> 2026-07-19。把「单个 StoryPatchAuthorService(一次 generateObject 生成整份操作文档)」
> 替换成**确定性命名流水线**。功能未上线 → 放开重构、不留兜底、清理不合理处。

## 1. 目标与不变式

- **correctness by construction**:先生成并**确定性校验小骨架**,再展开正文。悬空引用在结构上**不可能产生**(执行器的完整性检查降级为末端断言,而非首次暴露点)。
- **每棒有界重试**:每个阶段对自己的校验错误重试 N 次,超了**诚实报错**(阶段专属 error code),绝不静默降级。
- **逐棒进度**:聊天里 run-card 从单 spinner 变阶段清单卡,每棒 pending/running/done/failed 原地更新。
- **对话不受影响**:LLM 路由不变(copilot 工具决定要不要触发流水线);流水线全在服务端。

## 2. 五棒流水线(替换 `StoryPatchAuthorService.author`)

| #   | 棒(agent 名) | key         | 输入                      | 产物(声明式契约)                                                                                      |
| --- | ------------ | ----------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | 世界观架构师 | `worldview` | brief + 文档全文          | `StoryBibleDraft` = logline/synopsis/worldview + characters[] + stateVariables[] + endings[]          |
| 2   | 剧情结构师   | `structure` | bible + 文档              | `StorySkeleton` = nodes[]{id,kind,clipKey?,beat,intendedNext?} + entryId — **确定性校验**(见 §3)      |
| 3   | 分支编排师   | `branch`    | skeleton + bible          | `StoryBranchPlan` = 每节点的 exit(auto/choice/ending)+ choices/routes(条件/效果引用只能指向已注册 id) |
| 4   | 场景撰写师   | `scene`     | skeleton + branch + bible | `StorySceneProse` = 每 text 节点 body、每 choice 的 prompt/label(逐节点,可并行)                       |
| 5   | 校验(装配器) | `validate`  | 前四棒产物                | 确定性代码把四份产物**装配**成 `StoryPatchOperation[]`;走 `executeStoryPatch` dry-run 作末端断言      |

第 4 棒只往**已连好的节点**填肉 → 无从制造悬空。第 5 棒是代码不是 LLM。

## 3. 骨架校验(第 2 棒后,correctness by construction 的核心)

从 `interactive-film.schema.ts` 的引用完整性块(`validateInteractiveStoryGameplayReadiness` 1146-1257)抽出**引用完整性子集**为共享确定性校验器,供第 2/3 棒直接调用:

- 每个 `intendedNext` / edge target ∈ 节点 id 集;
- 每个 endingId ∈ endings 注册;每个 variable/character/flag ∈ 各注册表;
- clipKey 唯一;entry ∈ 节点集;choice ≥ 2(**骨架走 lock 级严格子集**,不是宽松版)。
  校验失败 → 结构师带错误重试(有界),不进入展开。

## 4. 数据模型 & 进度协议

- **Prisma**:`StoryAgentRun` 加 `authoringStages Json?`(逐棒进度数组 `[{key,status,attempt?,maxAttempts?}]`)。**不扩** `StoryAgentRunStatus` 枚举(避免 DTO refinement 组合爆炸)。
- **中间产物不落库**:四棒产物在 worker 内存流转;崩溃/租约回收 → 从第 1 棒重来(有界)。保持 `proposal` 列语义简单(brief-until-complete → full proposal)。
- **进度发射**:新增 `advanceAuthoringStage`(CAS 守卫,镜像 `renewAuthoringLease` 的 status=authoring∧leaseOwner=worker∧未过期),但**要 enqueue realtime + bump updated_at**(域变更,客户端 authority key 忽略 updatedAt 所以安全)。复用现有 realtime + 5s 轮询双通道,不新增频道。
- **DTO**:`StoryAgentRunDtoSchema` 加 `authoringStages` 字段并入 superRefine——仅 authoring/authoring_failed 期存在,其余状态须 null(否则 toDto.parse 每次读都抛)。

## 5. run-card UI

- `RunDraftingIndicator`(单脉冲装饰)→ **阶段清单卡**:读 `run.authoringStages`,逐行 阶段名 + 态图标(pending/running spinner/done ✓/failed ⚠)+ 原地更新;补 `role=list` / `aria-live`。
- footer:`步骤 3/5:分支编排`。
- 失败:定位到具体棒(哪阶段+重试耗尽),扩 error code 集 + `authoringErrors` 文案键;`retryIsFutile` 按棒重判(CONTENT_REJECTED 类仍无重试)。
- 三语言新增 5 个阶段名 + 每棒态/失败文案。

## 6. 顺带清理(洁癖清单)

- **合并三层重试**:SDK `maxRetries` + author 内部 schema-repair 循环 + worker `staleRetried/semanticRepair` → **每棒单一有界重试**。
- 删 `AuthoredStoryPatchOperation` 的 `as never`/`as unknown` 类型体操(装配器末端统一赋 operationId)。
- 删 65 行巨型 `STORY_PATCH_AUTHOR_SYSTEM_PROMPT` + `undocumentedOperationKinds`(改为每棒定向 prompt)。
- `dashScopeCompatibleJsonSchema` + 内容审核检测 + alibaba headers 抽为**每棒共用**工具,不各棒重抄。
- 领域叶子 schema **三处平行定义**(shared / interactive-film / 新棒)→ 收敛复用 shared 版。
- `executeApplyProposal` 的 HttpException 往返(纯 worker 路径无 HTTP)→ 阶段校验走结构化错误,不经 HttpException 包装。
- 绑定"单份文档"语义的测试(`story-patch-author.service.spec.ts`)一并改。

## 7. 落地顺序

1. **Phase 1 核心可靠性**:shared 阶段产物 schema + 骨架校验器 → 新 `StoryAuthoringPipelineService`(5 棒) → worker 驱动 → 替换 author()。**这一步就拿到 98%**。
2. **Phase 2 进度 UX**:`authoringStages` 列 + DTO 字段 + `advanceAuthoringStage` + run-card 阶段清单卡 + i18n。
3. **Phase 3 清理收尾** + 测试重写 + 双端 tsc/lint 绿。

Phase 1 是可靠性正解且是 Phase 2 的前提(先有阶段才能报进度)。
