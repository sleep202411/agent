# 人才市场 (Creators / Talent Market) — 前端接口契约草案

> **目的**：前端先把"人才市场"模块需要的 3 个核心接口的字段、形状、语义画一遍，给后端确认是否合理 / 是否能直接落地。如果后端有不同想法，以本 README 为讨论基础修改，定稿后前端再把 mock 替换为真实调用。
>
> **当前状态**：模块的所有数据全部来自 `_components/creators-mock.ts` 的 mock；hook 接口（`use-creator.ts`）已经按目标 endpoint 命名好。下面 3 个是上线"人才市场"前必须先要的最小集合，其它（社区动态、认证等级、技能需求）等后端有空再说。

---

## 模块概览

- **路由**：`/creators`（列表） + `/creators/[id]`（详情）
- **核心循环**：
  1. 用户在自己的个人主页上开启"求职状态"
  2. 别的工作室在 `/creators` 列表页通过"开放求职"筛选 → 看到所有正在求职的用户
  3. 点入某个人才 → `/creators/[id]` 看完整资料

接下来 3 个接口分别覆盖上面 3 步。

---

## 接口 1 — 设置当前用户的求职状态

用户在自己的 profile / 设置页点"开启求职"开关时调用。

```
POST /api/user/profile/job-seeking
```

**Auth**：需登录（带 `satoken` cookie / header）。只能改自己的状态，不允许带 `userId` 改别人。

**Request body**

```json
{
  "open": true
}
```

| 字段   | 类型      | 必填 | 说明                                       |
| ------ | --------- | ---- | ------------------------------------------ |
| `open` | `boolean` | ✅   | `true` 开放求职 / `false` 关闭求职（隐身） |

**Response**

```json
{
  "code": 200,
  "data": {
    "open": true,
    "updatedAt": "2026-04-28T12:34:56Z"
  }
}
```

| 字段        | 类型      | 说明                                 |
| ----------- | --------- | ------------------------------------ |
| `open`      | `boolean` | 服务端落库后的最终状态（回显用）     |
| `updatedAt` | `string`  | ISO 时间戳，用于 UI 显示"最后更新于" |

**语义 / 边界**

- 数据库字段建议：在 `user` 表加一个 `job_seeking_open` `boolean` + `job_seeking_updated_at` `datetime`，默认 `false`。
- **幂等**：重复传 `open=true` 不报错，只更新 `updatedAt`。
- **不需要审核**：开启即生效，列表 / 详情接口立刻能看到。
- 关闭后自己的卡片 / 详情页**继续可见**（个人主页是公开的），只是不会出现在"开放求职"过滤的列表里。

---

## 接口 2 — 获取人才列表

`/creators` 列表页用。当前 mock 支持搜索 / 技能 / 等级 / 排序等过滤；**第一期最少需要"开放求职"过滤**，其它字段后端如果暂时不能跑也可以前端先去掉，列表展示全部用户。

```
GET /api/creators
```

**Auth**：可不登录（公开浏览）。

**Query params**

| 参数           | 类型     | 必填 | 说明                                                                           |
| -------------- | -------- | ---- | ------------------------------------------------------------------------------ |
| `jobSeeking`   | `string` | ❌   | `"open"` = 只返回 `job_seeking_open=true` 的用户；不传 = 不过滤                |
| `search`       | `string` | ❌   | 关键词，匹配 `name` / `bio` / 任一 `skills` 项                                 |
| `skill`        | `string` | ❌   | 单选技能名（如 `"AI Animation"`），匹配 `skills` 数组中是否包含                |
| `level`        | `string` | ❌   | `FD1` / `FD2` / ... / `FD5`，按平台 5 级认证体系                               |
| `availability` | `string` | ❌   | `available` / `this_week` / `by_appointment`（用户填的接活档期，第一期不强求） |
| `sort`         | `string` | ❌   | `rating`（默认）/ `projects` / `recent`                                        |
| `page`         | `number` | ❌   | 1-based 分页，不传 = 1                                                         |
| `pageSize`     | `number` | ❌   | 每页条数，默认 20，最大 60                                                     |

**Response**

```json
{
  "code": 200,
  "data": {
    "list": [
      {
        "id": "u-7301",
        "name": "Lin Hui",
        "avatar": "https://oss.../avatar/u-7301.png",
        "level": "FD3",
        "skills": ["AI Animation", "Concept Art", "Storyboard"],
        "location": "Shanghai",
        "bio": "Specializes in cyberpunk + Eastern aesthetics; AI art direction.",
        "projects": 12,
        "rating": 4.8,
        "reviews": 38,
        "availability": "available",
        "responseTime": "Usually replies within 2h",
        "covers": ["https://oss.../works/u-7301-1.jpg", "https://oss.../works/u-7301-2.jpg"],
        "featured": false,
        "joinedAt": "2024-03-15T00:00:00Z",
        "jobSeekingOpen": true
      }
    ],
    "total": 128,
    "page": 1,
    "pageSize": 20
  }
}
```

**`Creator` 单项字段说明**

| 字段             | 类型           | 必填 | 说明 / 来源                                                |
| ---------------- | -------------- | ---- | ---------------------------------------------------------- |
| `id`             | `string`       | ✅   | 用户 ID                                                    |
| `name`           | `string`       | ✅   | 用户昵称                                                   |
| `avatar`         | `string`       | ✅   | 头像 URL（已拼好 host，前端不再拼）                        |
| `level`          | `"FD1"…"FD5"`  | ✅   | 平台认证等级（已存在的字段）                               |
| `skills`         | `string[]`     | ✅   | 用户在 profile 里勾选的技能标签                            |
| `location`       | `string`       | ✅   | 城市，例如 `"Shanghai"` / `"Singapore"`                    |
| `bio`            | `string`       | ✅   | 一句话简介，≤ ~80 字                                       |
| `projects`       | `number`       | ✅   | 参与过的项目数（聚合统计）                                 |
| `rating`         | `number`       | ✅   | 0-5，1 位小数；没评价的用户回 0                            |
| `reviews`        | `number`       | ✅   | 被评价次数                                                 |
| `availability`   | `string`       | ❌   | `available` / `this_week` / `by_appointment`，没填则不返回 |
| `responseTime`   | `string`       | ❌   | 自由文本，例 `"Usually replies within 2h"`，没数据则不返回 |
| `covers`         | `string[]`     | ✅   | 作品封面图 URL 数组（最多 3 张），列表卡片用               |
| `featured`       | `boolean`      | ❌   | 平台精选标记，置顶用                                       |
| `joinedAt`       | `string` (ISO) | ✅   | 注册时间                                                   |
| `jobSeekingOpen` | `boolean`      | ✅   | 当前是否开放求职（呼应接口 1）                             |

**语义 / 边界**

- `jobSeeking=open` 时，仅返回 `job_seeking_open=true` 的用户。**第一期前端只用这一个 query**；其它过滤字段如果后端来不及，可以全部忽略，前端能在内存里二次过滤。
- 分页是必须的，避免 OSS 上的 `covers` 把响应撑爆。
- 排序建议在数据库索引上做 (`rating DESC, projects DESC`)；如果后端只能给一种排序，默认 `rating DESC` 即可。

---

## 接口 3 — 查看某个人才的详情

`/creators/[id]` 详情页用。返回比列表多得多的字段（履历、作品集、评价等）。

```
GET /api/creators/{id}
```

**Auth**：可不登录（公开浏览）。

**Response**

```json
{
  "code": 200,
  "data": {
    "id": "u-7301",
    "name": "Lin Hui",
    "avatar": "https://oss.../avatar/u-7301.png",
    "level": "FD3",
    "skills": ["AI Animation", "Concept Art", "Storyboard"],
    "location": "Shanghai",
    "bio": "Specializes in cyberpunk + Eastern aesthetics; AI art direction.",
    "projects": 12,
    "rating": 4.8,
    "reviews": 38,
    "availability": "available",
    "responseTime": "Usually replies within 2h",
    "covers": ["..."],
    "featured": false,
    "joinedAt": "2024-03-15T00:00:00Z",
    "jobSeekingOpen": true,

    "timezone": "UTC+8",
    "school": "Shanghai Theatre Academy · Animation",
    "fullBio": "Specializes in blending Eastern aesthetics with cyberpunk style...",

    "studioHistory": [
      {
        "name": "Neon Studio",
        "role": "AI Art Director",
        "period": "2023.06 — Present",
        "project": "Neon Dragon Series"
      }
    ],
    "ips": [
      {
        "id": "ip-2901",
        "name": "Neon Dragon",
        "cover": "https://oss.../ip/2901-cover.jpg",
        "role": "Art Director"
      }
    ],
    "portfolio": [
      {
        "id": "p-1",
        "title": "Concept frame — Act 1",
        "cover": "https://oss.../p1.jpg",
        "type": "image"
      }
    ],
    "reviewList": [
      {
        "id": "rv-1",
        "reviewer": "Studio A",
        "rating": 5,
        "text": "Delivered ahead of schedule…",
        "createdAt": "2026-02-12T..."
      }
    ]
  }
}
```

**额外字段**（在 `Creator` 基础上叠加）：

| 字段            | 类型                   | 必填 | 说明                                             |
| --------------- | ---------------------- | ---- | ------------------------------------------------ |
| `timezone`      | `string`               | ❌   | 例 `"UTC+8"`                                     |
| `school`        | `string`               | ❌   | 学校 / 专业                                      |
| `fullBio`       | `string`               | ❌   | 长简介，几百字 markdown 也行，前端渲染时按纯文本 |
| `studioHistory` | `StudioHistoryEntry[]` | ❌   | 工作室经历                                       |
| `ips`           | `CreatorIPEntry[]`     | ❌   | 参与过的 IP 列表（关联 IP 模块）                 |
| `portfolio`     | `PortfolioPiece[]`     | ❌   | 作品集（图片 / 视频）                            |
| `reviewList`    | `CreatorReview[]`      | ❌   | 收到的评价列表                                   |

**子类型**（可参考 `_components/creators-mock.ts` 同名 export）：

```ts
interface StudioHistoryEntry {
  name: string;
  role: string;
  period: string;
  project: string;
}
interface CreatorIPEntry {
  id: string;
  name: string;
  cover: string;
  role: string;
}
interface PortfolioPiece {
  id: string;
  title: string;
  cover: string;
  type: "image" | "video";
}
interface CreatorReview {
  id: string;
  reviewer: string;
  rating: number;
  text: string;
  createdAt: string;
}
```

**语义 / 边界**

- 字段为空数组时直接返回 `[]`，不要省略字段（前端依赖 length 判断空状态）。
- `id` 不存在时返回 404 + `{code: 404, message: "creator not found"}`，**不要返回 200 + 空 data**。
- `reviewList` 第一期可以只返回最新 10 条，后续如果要分页再单独加一个 `/api/creators/{id}/reviews?page=` 接口。

---

## 字段映射 / 复用提示

- `level`、`skills`、`bio`、`avatar`、`location` 这些**已经在用户表里**了，应该不用新增字段，只需要 SELECT 出来。
- `projects` / `rating` / `reviews` 看 IP / 评价模块现有的聚合视图能不能直接用；如果暂时算不出，第一期可以全部回 `0` / `0.0` / `0`，前端会优雅处理。
- `covers` 来源：用户的作品封面（取 portfolio 里 type=image 前 3 个的 cover URL 即可），不用新建表。
- `jobSeekingOpen` 是**新加的字段**（接口 1 写入）。

---

## 不在本期范围内（先不要做）

下面这几个 mock 也在 codebase 里，但**不是上线人才市场必需的**，第一期不做：

- `GET /api/community/feed` — 社区动态流
- `GET /api/certification/levels` — 认证等级介绍页
- `GET /api/skills/demand` — 技能需求热度图
- `POST /api/creators/:id/{invite,contact,like,save}` — 互动操作

等 3 个核心接口稳定上线后再讨论。

---

**作者**：前端 / Isaac · 2026-04-28
**对接人**：后端 @ ?
**讨论后修改请直接 PR 这个 README**，定稿后前端按本文档把 `_hooks/use-creator.ts` 里的 mock 函数替换成真实 fetch。
