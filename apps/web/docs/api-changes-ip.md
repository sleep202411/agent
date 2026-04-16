# IP 编辑/创建 — 后端接口需求

---

## 1. 封面图上传

**接口**: `POST /content/project/uploadBanner`（需确认路径）

| 参数        | 类型   | 必填 | 说明                                    |
| ----------- | ------ | ---- | --------------------------------------- |
| `file`      | File   | 是   | 图片文件（JPG/PNG/WEBP），建议限制 50MB |
| `projectId` | number | 是   | IP 项目 ID                              |

**响应**:

```json
{ "code": 200, "path": "project/banners/xxx.jpg" }
```

**存储**: banner OSS bucket

---

## 2. 项目详情新增字段

**接口**: `POST /project/query`

返回的 Project 对象中新增：

| 字段             | 类型     | 说明            |
| ---------------- | -------- | --------------- |
| `story`          | `string` | 故事概要        |
| `whyThisIP`      | `string` | 为什么做这个 IP |
| `targetEpisodes` | `number` | 目标集数        |

---

## 3. 项目更新支持新字段

**接口**: `POST /project/update`

请求体新增支持：

| 字段             | 类型     | 说明            |
| ---------------- | -------- | --------------- |
| `story`          | `string` | 故事概要        |
| `whyThisIP`      | `string` | 为什么做这个 IP |
| `targetEpisodes` | `number` | 目标集数        |

---

## 4. FAQ 管理

### 4.1 获取 FAQ 列表

**接口**: `POST /project/faq/list`

| 参数        | 类型   | 说明       |
| ----------- | ------ | ---------- |
| `projectId` | number | IP 项目 ID |

**响应**:

```json
{
  "code": 200,
  "data": [{ "id": 1, "question": "xxx", "answer": "xxx", "sortOrder": 0 }]
}
```

### 4.2 保存 FAQ

**接口**: `POST /project/faq/save`

| 参数        | 类型   | 说明                 |
| ----------- | ------ | -------------------- |
| `projectId` | number | IP 项目 ID           |
| `id`        | number | FAQ ID（新增时不传） |
| `question`  | string | 问题                 |
| `answer`    | string | 回答                 |
| `sortOrder` | number | 排序                 |

### 4.3 删除 FAQ

**接口**: `POST /project/faq/delete`

| 参数 | 类型   | 说明   |
| ---- | ------ | ------ |
| `id` | number | FAQ ID |

---

## 5. 剧集管理

### 5.1 获取剧集列表

**接口**: `POST /project/episode/list`

| 参数        | 类型   | 说明       |
| ----------- | ------ | ---------- |
| `projectId` | number | IP 项目 ID |

**响应**:

```json
{
  "code": 200,
  "data": [
    {
      "id": 1,
      "title": "第一集",
      "description": "xxx",
      "duration": 300,
      "sortOrder": 0,
      "status": 0
    }
  ]
}
```

### 5.2 创建剧集

**接口**: `POST /project/episode/create`

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `projectId`   | number | IP 项目 ID |
| `title`       | string | 剧集标题   |
| `description` | string | 剧集描述   |

### 5.3 更新剧集

**接口**: `POST /project/episode/update`

| 参数          | 类型   | 说明     |
| ------------- | ------ | -------- |
| `id`          | number | 剧集 ID  |
| `title`       | string | 剧集标题 |
| `description` | string | 剧集描述 |
| `sortOrder`   | number | 排序     |

### 5.4 删除剧集

**接口**: `POST /project/episode/delete`

| 参数 | 类型   | 说明    |
| ---- | ------ | ------- |
| `id` | number | 剧集 ID |

---

## 6. 团队成员管理

### 6.1 邀请成员

**接口**: `POST /project/member/invite`

| 参数        | 类型   | 说明                                |
| ----------- | ------ | ----------------------------------- |
| `projectId` | number | IP 项目 ID                          |
| `userId`    | number | 被邀请用户 ID                       |
| `role`      | string | 角色（producer/director/writer 等） |

### 6.2 移除成员

**接口**: `POST /project/member/remove`

| 参数        | 类型   | 说明       |
| ----------- | ------ | ---------- |
| `projectId` | number | IP 项目 ID |
| `memberId`  | number | 成员 ID    |

### 6.3 更新成员角色

**接口**: `POST /project/member/update`

| 参数       | 类型   | 说明    |
| ---------- | ------ | ------- |
| `memberId` | number | 成员 ID |
| `role`     | string | 新角色  |

---

## 7. 项目类型列表

**接口**: `GET /api/user/world/static/list/proudct/type/`（需确认）

**响应**:

```json
{
  "code": 200,
  "data": [
    { "id": 1, "name": "动画" },
    { "id": 2, "name": "漫画" },
    { "id": 3, "name": "短剧" }
  ]
}
```

---

## 前端已实现的功能

| 功能             | 对应接口                                            | 状态                        |
| ---------------- | --------------------------------------------------- | --------------------------- |
| 创建 IP          | `POST /project/create`                              | ✅ 接口已有，前端表单未接入 |
| 编辑 IP 基本信息 | `POST /project/update`                              | ✅ 已对接                   |
| 查看 IP 详情     | `POST /project/query`                               | ✅ 已对接                   |
| 上传宣传视频     | `POST /content/project/upload/project/video/backup` | ✅ 已对接                   |
| 获取视频链接     | `POST /vedio/play/project/getLink`                  | ✅ 已对接                   |
| 成员列表         | `POST /project/member/query`                        | ✅ 已对接                   |
| 招募岗位         | `POST /project/job/find/jobs`                       | ✅ 已对接                   |
| 封面图上传       | 待确认接口                                          | ❌ 等后端                   |
| 故事/扩展字段    | 待后端新增                                          | ❌ 等后端                   |
| FAQ 管理         | 待后端新增                                          | ❌ 等后端                   |
| 剧集管理         | 待后端新增                                          | ❌ 等后端                   |
| 成员邀请/移除    | 待后端新增                                          | ❌ 等后端                   |
