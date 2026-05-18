# 剧组剧集管理接口规范

**实施状态（2026-05-18）**：本规范定义的全部 11 个接口已在 Nest
后端（`apps/server/src/crews/episodes/`）实现，URL 由 `/project/crew/episode/*`
迁移至 `/aurora/crews/:crewId/episodes/*` 与 `/aurora/episodes/:id/*` 与
`/aurora/assignments/:id/*`。HTTP 协议从 `HTTP 200 + body.code` 改为真
HTTP 状态码（200/201/204/400/403/404/409/422/423）。前端切真接口完成，
`episode-mock.ts` 已删除。本文档保留作为接口契约与状态机的权威说明。

关联：与 `pricing-spec.md` / `community-credits-spec.md` 并存。剧组
内部的"生产管理"层，跟用户付费消费层（pricing）和钱包层
（community-credits）**完全隔离**。

---

## 目标与范围

crew workspace 的 Episodes tab —— 让 admin 在剧组内开剧集任务、派
成员、审稿、签收益；成员提交自己负责的部分；财务（finance）填收益
金额。前端 UI 已完整实现（mock-driven，见 `episode-mock.ts` /
`use-episodes.ts`），本规范定义后端落地需要提供的接口契约。

**前端切真接口的触发条件**：本规范定义的 11 个接口在 staging 环境
全部按规返 200 + workspace 切换开关从 `disabled: true` 改成 `false`
（page.tsx 内 TABS 数组）。

---

## 已锁定的产品决策

1. **作用域**：episode 是**剧组内部的生产任务单**，不直接对应 IP
   下的 vedio 行。两者关联（如何把 approved episode 发布为 vedio）
   是另一份 spec，本规范不涉及。
2. **状态机**：单向流转，不允许回滚（rejected → submitted 重新提交
   除外，见下方"状态机"）
3. **收益（revenue）货币**：MVP 仅 **CNY**，存最小单位整数（分）。
   预留 `currency` 字段以备扩展，但当前接口只接受 `"CNY"`。**不与
   社区积分（spendable/withdrawable）互通** —— 这是剧组内部结算账，
   不走平台钱包。
4. **审计日志**：append-only，不可修改 / 删除
5. **角色**：`admin` / `finance` / `member` / `outsider`（前端已落
   实，见 `use-user-crew-role.ts`）。MVP 期 finance 由后端在
   `crew_member` 表新增 `is_finance TINYINT` 字段标记，**不**新建
   独立的财务用户表。前端通过现有 member 接口拿到这个字段。
6. **派人**：同 user 在同 episode 不能重复 assign（DB unique
   constraint + 业务校验）
7. **重新提交**：被驳回后 member 可重新提交，状态从 rejected →
   submitted
8. **删除 episode**：MVP 不支持。**已开始的任务单永久保留**
9. **删除 assignment**：仅 `in_progress` / `rejected` 状态可撤
   （submitted / approved 不可撤，否则会破坏审计 + 收益快照）
10. **episode 批准后冻结**：admin approve 整集后，所有 assignment
    的进一步修改（submit / approve / reject / revenue）全部禁止
11. **不做 approval gate**：admin 可以在"还有未审稿 assignment"的
    情况下强制 approve 整集，UI 自己给警告即可；后端不卡

---

## 角色与权限矩阵

| 操作                               | admin | finance | member  | outsider |
| ---------------------------------- | ----- | ------- | ------- | -------- |
| 看 episode / assignment / activity | ✓     | ✓       | ✓       | ✗        |
| 创建 episode                       | ✓     | ✗       | ✗       | ✗        |
| approve 整集                       | ✓     | ✗       | ✗       | ✗        |
| 派人 / 撤派                        | ✓     | ✗       | ✗       | ✗        |
| 提交 assignment                    | ✗     | ✗       | 仅 self | ✗        |
| 审稿 (approve/reject)              | ✓     | ✗       | ✗       | ✗        |
| 设置 / 修改收益                    | ✗     | ✓       | ✗       | ✗        |

所有写操作的鉴权检查**服务端必须做**（前端是不可信边界）。

---

## 数据模型

```ts
type EpisodeStatus = "not_started" | "in_production" | "approved";
type AssignmentStatus = "in_progress" | "submitted" | "approved" | "rejected";

type Episode = {
  id: number;
  crewId: number;
  number: number; // 1-based，crew 内唯一
  title: string | null;
  description: string | null;
  status: EpisodeStatus;
  deadline: string | null; // "YYYY-MM-DD"，可空
  approvedAt: string | null; // ISO 8601
  createdAt: string;
  updatedAt: string;
};

type AssignmentRevenue = {
  amount: number; // CNY 分（最小单位整数），≥ 0
  currency: "CNY"; // MVP 锁死
  setAt: string;
  setByUserId: number;
};

type AssignmentSubmission = {
  url: string | null;
  note: string | null;
  submittedAt: string;
};

type AssignmentReviewNote = {
  reason: string;
  suggestion: string | null;
  rejectedAt: string;
};

type EpisodeAssignment = {
  id: number;
  crewId: number;
  episodeId: number;
  userId: number;
  roleId: number | null;
  roleName: string | null; // denormalized 防 "#3" stale render
  status: AssignmentStatus;
  submission: AssignmentSubmission | null;
  reviewNote: AssignmentReviewNote | null;
  revenue: AssignmentRevenue | null;
  updatedAt: string;
};

type EpisodeActivityType =
  | "episode_created"
  | "member_assigned"
  | "member_unassigned"
  | "submission_made"
  | "submission_approved"
  | "submission_rejected"
  | "revenue_set"
  | "episode_approved";

type EpisodeActivity = {
  id: number;
  crewId: number;
  episodeId: number;
  type: EpisodeActivityType;
  actorUserId: number;
  actorName: string; // 后端 snapshot，防用户改昵称破坏审计
  payload: Record<string, unknown>; // 按 type 不同，见下方 schema
  createdAt: string;
};
```

---

## 状态机

### Episode lifecycle

```
not_started ──(首次 assign 任意 member)──► in_production
                                              │
                                              ▼
                                  ──(admin approve)──► approved
                                                          │
                                                          ▼
                                                  （终态，冻结）
```

- 创建时 `status = not_started`
- 任意第一个 member 被派进来时**自动**跃迁到 `in_production`（**后端
  事务内顺手改 episode.status**，不需要前端额外调用）
- admin 显式 approve 才进 `approved`
- approved 后所有 assignment 进一步操作禁止（见接口约束）

### Assignment lifecycle

```
                                ┌─── submit ───┐
                                │              ▼
in_progress ──submit──► submitted ──approve──► approved
                                ▲              （终态）
                                │
                                └── reject ──► rejected
                                                  │
                                                  └──submit──► submitted
                                                  （可循环驳回 / 重提）
```

- assign 时建出 `in_progress`
- member submit → `submitted`
- admin approve → `approved`（终态）
- admin reject → `rejected`（带 reason）
- rejected → member 再 submit → 回到 `submitted`，**reviewNote 清空**

### 状态前置检查（服务端必做）

| 接口              | 允许的当前 assignment.status |
| ----------------- | ---------------------------- |
| submit            | `in_progress`, `rejected`    |
| approve           | `submitted`                  |
| reject            | `submitted`                  |
| remove (unassign) | `in_progress`, `rejected`    |
| revenue           | 任何状态                     |

不符合的话返 **400** + `{ currentStatus, expectedStatuses }`。

---

## 接口列表

11 个接口，命名前缀 `/project/crew/episode/`，跟既有 `/project/crew/*`
对齐。HTTP 一律 200，body code 驱动错误处理。

### 读接口（3 个）

#### 1. GET 剧集列表

```
POST /project/crew/episode/list
```

**鉴权**：登录 + 不是 outsider（admin / finance / member 都能看）。

**Body**：

```json
{ "crewId": 12345 }
```

**响应 data**：

```json
{
  "list": [{ /* Episode */ }, ...]
}
```

按 `number` 升序。

#### 2. 剧集的 assignment 列表

```
POST /project/crew/episode/assignment/list
```

**鉴权**：同上。

**Body**：

```json
{ "crewId": 12345, "episodeId": 3 }
```

**响应 data**：

```json
{
  "list": [{ /* EpisodeAssignment */ }, ...]
}
```

按 `id` 升序。

#### 3. 剧集的活动日志

```
POST /project/crew/episode/activity/list
```

**鉴权**：同上。

**Body**：

```json
{ "crewId": 12345, "episodeId": 3, "page": 1, "pageSize": 50 }
```

**响应 data**：标准分页结构，按 `createdAt` 倒序。

### 写接口 —— 剧集级（2 个）

#### 4. 创建剧集

```
POST /project/crew/episode/create
```

**鉴权**：admin。

**Body**：

```jsonc
{
  "crewId": 12345,
  "title": "Rising Tension", // 可空字符串，可省略
  "description": "...", // 可空
  "deadline": "2026-04-05", // YYYY-MM-DD，可空
}
```

**响应 data**：完整 `Episode`。`number` 由后端计算（max(crew 内 number) + 1）。
副作用：写一条 `episode_created` activity。

#### 5. 批准整集

```
POST /project/crew/episode/approve
```

**鉴权**：admin。

**Body**：`{ crewId, episodeId }`。

**响应 data**：`Episode`（status=approved, approvedAt 已写）。

**约束**：

- 仅 `in_production` 可 approve（`not_started` / `approved` → 400）
- approve 后该剧集所有 assignment 操作冻结
- 副作用：写一条 `episode_approved` activity

### 写接口 —— assignment 级（6 个）

#### 6. 派人

```
POST /project/crew/episode/assignment/add
```

**鉴权**：admin。

**Body**：

```jsonc
{
  "crewId": 12345,
  "episodeId": 3,
  "userId": 23,
  "roleId": 1, // 可省，但建议带上以便 join
  "roleName": "Screenwriter", // 建议带，后端 snapshot 避免 "#3" stale
}
```

**响应 data**：完整 `EpisodeAssignment`（status=in_progress）。

**约束**：

- `userId` 必须是该 crew 的 member（不在 `crew_member` 表 → 400）
- 同 episode 同 user 不能重复（unique constraint → 返 **409** +
  `{ existingAssignmentId }`）
- episode.status === approved → 423（冻结）
- 副作用：
  1. 写 `member_assigned` activity
  2. 若 episode 当前 = `not_started`，事务内顺手改成 `in_production`
     （**不**触发 episode_created 之类的额外 activity）

#### 7. 撤派

```
POST /project/crew/episode/assignment/remove
```

**鉴权**：admin。

**Body**：`{ crewId, assignmentId }`。

**响应 data**：`{ removedId, episodeStatus }`（episodeStatus 给前端用，
万一刚撤完最后一个人导致 episode 退回 not_started —— **MVP 不退回**，
保持 in_production；这里只是前端 hint）。

**约束**：

- 仅 `in_progress` / `rejected` 可撤（其他状态返 400 + currentStatus）
- episode.status === approved → 423
- 副作用：写 `member_unassigned` activity

#### 8. 提交作品

```
POST /project/crew/episode/assignment/submit
```

**鉴权**：**必须是 `assignment.userId` 本人**（admin 也不能代提交）。

**Body**：

```jsonc
{
  "crewId": 12345,
  "assignmentId": 4,
  "url": "https://...", // 可空（如线下交付的情况）
  "note": "Style v2 for review", // 可空
}
```

**响应 data**：`EpisodeAssignment`（status=submitted, submission 已写,
reviewNote 清空）。

**约束**：

- 仅 `in_progress` / `rejected` 可提交（其他 400）
- episode.status === approved → 423
- 副作用：写 `submission_made` activity。**reviewNote 字段清空**
  （让被驳回后再提交时不再显示上次驳回原因）

#### 9. 审稿通过

```
POST /project/crew/episode/assignment/approve
```

**鉴权**：admin。

**Body**：`{ crewId, assignmentId }`。

**响应 data**：`EpisodeAssignment`（status=approved）。

**约束**：

- 仅 `submitted` 可批准
- episode.status === approved → 423
- 副作用：写 `submission_approved` activity。reviewNote 清空。

#### 10. 审稿驳回

```
POST /project/crew/episode/assignment/reject
```

**鉴权**：admin。

**Body**：

```jsonc
{
  "crewId": 12345,
  "assignmentId": 4,
  "reason": "Pacing too slow", // 必填，1-500 字
  "suggestion": "Tighten scene 4 ~30%", // 可空
}
```

**响应 data**：`EpisodeAssignment`（status=rejected, reviewNote 已写）。

**约束**：

- 仅 `submitted` 可驳回
- episode.status === approved → 423
- 副作用：写 `submission_rejected` activity（payload 含 reason）

#### 11. 设置 / 修改收益

```
POST /project/crew/episode/assignment/revenue
```

**鉴权**：finance。

**Body**：

```jsonc
{
  "crewId": 12345,
  "assignmentId": 4,
  "amount": 220000, // CNY 分（= ¥2200.00）
  "currency": "CNY", // 可省，默认 CNY；MVP 仅接受 CNY
}
```

**响应 data**：`EpisodeAssignment`（revenue 已写 / 改）。

**约束**：

- `amount` 整数 ≥ 0
- `currency` 仅 `"CNY"`（其他值 400）
- episode.status === approved → 423（已结束剧集不允许修改收益）
- 任意 assignment 状态可设（in_progress 也行，预填账面）
- 副作用：写 `revenue_set` activity（payload 含 amount + currency）

---

## Activity payload schema（按 type）

```ts
type ActivityPayloadByType = {
  episode_created: { number: number };
  member_assigned: { targetUserId: number; roleName: string | null };
  member_unassigned: { targetUserId: number; roleName: string | null };
  submission_made: { targetUserId: number; roleName: string | null };
  submission_approved: { targetUserId: number; roleName: string | null };
  submission_rejected: { targetUserId: number; roleName: string | null; reason: string };
  revenue_set: { targetUserId: number; amount: number; currency: "CNY" };
  episode_approved: Record<string, never>; // 空对象
};
```

`actorUserId` / `actorName` 由后端从鉴权 token 解析填入，前端不传。
`actorName` 是 snapshot —— 用户后续改昵称不影响历史日志。

---

## 错误码

**HTTP 一律 200**，前端拦截器只读 body `code`。

| code | 触发场景                                                       | data 携带                                                   |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| 200  | 成功                                                           | 业务数据                                                    |
| 400  | 参数错 / 状态前置不满足                                        | `{ field?, reason?, currentStatus?, expectedStatuses? }`    |
| 401  | 未登录                                                         | null                                                        |
| 403  | 角色不符（如 member 创建剧集 / 非 self 提交别人的 assignment） | `{ requiredRole: "admin" \| "finance" \| "self" }`          |
| 404  | crew / episode / assignment / user 任一不存在                  | `{ entity: "crew" \| "episode" \| "assignment" \| "user" }` |
| 409  | 重复派人（同 episode 同 user）                                 | `{ existingAssignmentId }`                                  |
| 423  | episode 已 approved，对其下任何资源 mutation 都禁止            | `{ episodeStatus: "approved" }`                             |

---

## DB schema 建议

```sql
CREATE TABLE crew_episode (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  crew_id       BIGINT NOT NULL,
  number        INT NOT NULL,                  -- 1-based, crew 内唯一
  title         VARCHAR(128) NULL,
  description   TEXT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'not_started',
  deadline      DATE NULL,
  approved_at   DATETIME NULL,
  create_time   DATETIME NOT NULL,
  update_time   DATETIME NOT NULL,
  UNIQUE KEY uk_crew_number (crew_id, number),
  INDEX idx_crew_status (crew_id, status)
);

CREATE TABLE crew_episode_assignment (
  id                       BIGINT PRIMARY KEY AUTO_INCREMENT,
  crew_id                  BIGINT NOT NULL,
  episode_id               BIGINT NOT NULL,
  user_id                  BIGINT NOT NULL,
  role_id                  BIGINT NULL,
  role_name                VARCHAR(64) NULL,
  status                   VARCHAR(16) NOT NULL DEFAULT 'in_progress',
  submission_url           TEXT NULL,
  submission_note          TEXT NULL,
  submitted_at             DATETIME NULL,
  reject_reason            TEXT NULL,
  reject_suggestion        TEXT NULL,
  rejected_at              DATETIME NULL,
  revenue_amount           BIGINT NULL,         -- 最小单位（分）
  revenue_currency         VARCHAR(8) NULL DEFAULT 'CNY',
  revenue_set_at           DATETIME NULL,
  revenue_set_by_user_id   BIGINT NULL,
  update_time              DATETIME NOT NULL,
  UNIQUE KEY uk_ep_user (episode_id, user_id),
  INDEX idx_episode (episode_id),
  INDEX idx_crew_user (crew_id, user_id)
);

CREATE TABLE crew_episode_activity (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  crew_id        BIGINT NOT NULL,
  episode_id     BIGINT NOT NULL,
  type           VARCHAR(32) NOT NULL,
  actor_user_id  BIGINT NOT NULL,
  actor_name     VARCHAR(64) NOT NULL,
  payload        JSON NOT NULL,
  create_time    DATETIME NOT NULL,
  INDEX idx_episode_time (episode_id, create_time DESC)
);
```

### crew_member 表的 finance 标记

```sql
ALTER TABLE crew_member ADD COLUMN is_finance TINYINT(1) NOT NULL DEFAULT 0;
```

现有 `GET /project/crew/list` / member list 接口需要把这个字段透传给
前端（在 `CrewMember` 上加 `isFinance: boolean`）。前端的
`use-user-crew-role.ts` 会替换 `MOCK_FINANCE_USER_IDS` 的硬编码逻辑
为 `member.isFinance` 读取。

---

## 服务端校验规则（必做）

- 所有金额（`revenue_amount`）整数 ≥ 0
- 所有状态字段值在合法 enum 内
- 状态前置检查 100% 服务端做（**不信前端**）
- 写操作必须在事务内完成（assignment + episode auto-transition +
  activity log）
- 鉴权 token 解析后比对 crew.adminUserId（admin）/ crew_member.is_finance
  （finance）/ assignment.userId（self）
- `crewId` / `episodeId` 必须一致（assignment 反向 join 校验，防止
  跨 crew 改别人数据）

---

## 前端使用规约

- **查询缓存 key**（已实现，见 `shared.ts` 的 `crewKeys`）：
  - episodes: `["crew", crewId, "episodes"]`
  - assignments: `["crew", crewId, "episodes", episodeId, "assignments"]`
  - activity: `["crew", crewId, "episodes", episodeId, "activity"]`
- 每个 mutation 成功后 invalidate**相关**的 query：
  - assign / unassign → 同时 invalidate episodes（因为可能触发 episode.status 跃迁）+ assignments + activity
  - submit / approve / reject → assignments + activity
  - revenue → assignments + activity
  - createEpisode → episodes
  - approveEpisode → episodes + activity
- 错误：拦截器按 body code 抛业务错误，前端 `useMutation.onError` 提示
- 角色判断 100% 在前端走 `useUserCrewRole`，不读后端额外字段

---

## 后端必须通过的测试用例

| #   | 前置                                         | 操作                             | 期望                                                    |
| --- | -------------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| 1   | outsider                                     | GET episode/list                 | 401 或 403                                              |
| 2   | admin                                        | POST episode/create              | 200, number = max+1, status=not_started                 |
| 3   | non-admin                                    | POST episode/create              | 403 + requiredRole=admin                                |
| 4   | episode.status=not_started                   | assignment/add                   | 200, episode 自动 → in_production                       |
| 5   | 同 episode 同 user 重复 add                  | assignment/add                   | 409 + existingAssignmentId                              |
| 6   | userId 不在 crew_member                      | assignment/add                   | 400 + entity=user                                       |
| 7   | episode.status=approved                      | 任意 assignment 操作             | 423 + episodeStatus=approved                            |
| 8   | assignment.status=in_progress                | self submit                      | 200, status=submitted, submittedAt 写入                 |
| 9   | assignment.status=in_progress                | admin 代提交别人的               | 403 + requiredRole=self                                 |
| 10  | assignment.status=submitted                  | admin approve                    | 200, status=approved, reviewNote 清空                   |
| 11  | assignment.status=in_progress                | admin approve                    | 400 + currentStatus + expectedStatuses=["submitted"]    |
| 12  | assignment.status=submitted                  | admin reject + reason            | 200, status=rejected, reviewNote 写入                   |
| 13  | assignment.status=rejected                   | self submit                      | 200, status=submitted, reviewNote 清空                  |
| 14  | assignment.status=approved                   | unassign                         | 400                                                     |
| 15  | finance set revenue { amount: 220000 }       | revenue                          | 200, revenue 写入                                       |
| 16  | non-finance (admin) set revenue              | revenue                          | 403 + requiredRole=finance                              |
| 17  | revenue { currency: "USD" }                  | revenue                          | 400                                                     |
| 18  | episode.status=in_production                 | episode/approve                  | 200, status=approved, approvedAt 写入                   |
| 19  | episode.status=not_started                   | episode/approve                  | 400                                                     |
| 20  | crew A 的 admin 调 crew B 的 episode/approve | 任意                             | 404 + entity=crew/episode（不暴露细节）                 |
| 21  | reject 后再 submit                           | submit                           | 200, 历史活动里能看到两次 submission_made + 一次 reject |
| 22  | activity 翻页                                | activity/list page=1 pageSize=50 | 200, 倒序                                               |

---

## 阶段一**不要**做的事

- Episode → IP / vedio 联动（approved 后自动发布为 vedio）
- 多币种 revenue（保留 currency 字段，但接口仅接受 CNY）
- 删除 episode
- Approval gate（强制所有 assignment 已 approved 才能 approve episode）
- Deadline 临近 / 超期提醒、通知中心、邮件
- 跨 crew 的 user dashboard（"我所有 crew 的 in-progress 工单"）
- Activity 按 actor / type 过滤
- Bulk 操作（一次 assign 多人 / 一次 approve 多个 assignment）

---

## 签字确认

- [ ] 后端 reviewer：\_\_\_\_\_\_\_\_（姓名 + 日期）
- [ ] 财务 / 风控 reviewer：\_\_\_\_\_\_\_\_（仅 revenue 涉及金额）
- [ ] 预计交付 ETA：\_\_\_\_\_\_\_\_
- [ ] 实施分支：\_\_\_\_\_\_\_\_

前端只在 staging 环境**11 个接口按规范全 200** + `crew_member.isFinance`
字段透传到位 之后才会把 `workspace/page.tsx` 的 `disabled: true` 翻
开，从 mock 切到真接口。
