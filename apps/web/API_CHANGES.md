# 新平台后端接口变更需求

> 对应 fizzdragon-web 功能迁移到新平台（fizzdragon-platform），需要后端配合调整的接口。

---

## 一、用户资料页（Profile）

### 1.1 用户信息接口新增 `coverImage` 字段

**接口**: `GET /user/query/user/info`

在返回的 `info` 对象中新增：

| 字段         | 类型     | 说明                                                |
| ------------ | -------- | --------------------------------------------------- |
| `coverImage` | `string` | 个人主页封面图 OSS 路径，为空时前端显示默认渐变背景 |

返回示例：

```json
{
  "code": 200,
  "info": {
    "id": 2259,
    "nickName": "Isaac",
    "avatar": "2259/895710b0-...",
    "coverImage": "2259/covers/a1b2c3d4-...",
    ...
  }
}
```

### 1.2 新增封面图上传接口

**接口**: `POST /content/user/uploadCover`

**请求**: `multipart/form-data`

| 参数   | 类型 | 必填 | 说明                                    |
| ------ | ---- | ---- | --------------------------------------- |
| `file` | File | 是   | 图片文件（JPG/PNG/WEBP），建议限制 10MB |

**响应**（与 `/content/user/uploadAratar` 格式一致）:

```json
{
  "code": 200,
  "path": "2259/covers/a1b2c3d4-xxxx.jpg"
}
```

**存储说明**：

- OSS bucket: `user-aratar-sg.oss-ap-southeast-1.aliyuncs.com`
- 建议路径: `{userId}/covers/{uuid}.{ext}`
- 建议尺寸: 宽 ≥ 1200px，高 ≥ 300px，比例约 4:1

### 1.3 用户信息更新接口支持 `coverImage`

**接口**: `POST /user/update/user/info`

请求体新增支持：

| 字段         | 类型     | 说明            |
| ------------ | -------- | --------------- |
| `coverImage` | `string` | 封面图 OSS 路径 |

---

## 二、IP 创建/编辑页（对应 fizzdragon-web createProject）

### 2.1 现有接口梳理

#### 基础数据（页面加载）

| 接口                                            | 方法 | Content-Type | 用途                    |
| ----------------------------------------------- | ---- | ------------ | ----------------------- |
| `GET /project/role/list`                        | GET  | JSON         | 角色列表（导演、编剧…） |
| `GET /api/user/world/static/list/proudct/type/` | GET  | —            | 项目分类（动画、短剧…） |
| 标签接口（待确认路径）                          | —    | —            | 项目标签列表            |

#### 核心 CRUD

| 接口                       | 方法 | Content-Type        | 用途         |
| -------------------------- | ---- | ------------------- | ------------ |
| `POST /project/create`     | POST | **JSON**            | 创建 IP      |
| `POST /project/update`     | POST | **form-urlencoded** | 编辑 IP      |
| `POST /project/query`      | POST | **form-urlencoded** | 获取 IP 详情 |
| `POST /project/myprojects` | POST | **form-urlencoded** | 我的 IP 列表 |

#### 创建 IP 请求体（JSON）：

```json
{
  "name": "未来世界",
  "typeId": "3",
  "description": "IP 简介",
  "background": "IP 背景",
  "bannerLink": "2259/xxx.png",
  "contact": "1888888888",
  "tag": "[3,5]"
}
```

#### 编辑 IP 请求体（form-urlencoded）：

```
id=279&name=未来世界&typeId=3&description=...&tag=[3,5]
```

#### 查询 IP 详情（form-urlencoded）：

```
projectId=279
```

#### 招聘岗位

| 接口                         | 方法 | Content-Type    | 用途         |
| ---------------------------- | ---- | --------------- | ------------ |
| `POST /project/job/create`   | POST | form-urlencoded | 创建招聘岗位 |
| `POST /project/member/query` | POST | —               | 查询已有岗位 |
| `POST /project/job/close`    | POST | —               | 关闭岗位     |

#### 宣传视频

| 接口                                | 方法      | 用途             |
| ----------------------------------- | --------- | ---------------- |
| `POST /vedio/play/project/getLink`  | POST form | 获取宣传视频链接 |
| `POST /vedio/update/personal/video` | POST      | 更新视频         |

#### 团队成员

| 接口                          | 方法 | Content-Type    | 用途                    |
| ----------------------------- | ---- | --------------- | ----------------------- |
| `POST /project/member/query`  | POST | form-urlencoded | 查询项目团队成员列表    |
| `POST /project/member/invite` | POST | JSON            | **新增** — 邀请团队成员 |
| `POST /project/member/remove` | POST | JSON            | **新增** — 移除团队成员 |
| `POST /project/member/update` | POST | JSON            | **新增** — 更新成员权限 |

##### 邀请成员请求体（建议）：

```json
{
  "projectId": 279,
  "email": "collaborator@email.com",
  "name": "协作者",
  "permissions": ["editProject", "manageCommunity", "analytics"]
}
```

##### 权限枚举：

| 权限 ID             | 说明          |
| ------------------- | ------------- |
| `editProject`       | 编辑专案内容  |
| `manageCommunity`   | 管理社群互动  |
| `coordinateRewards` | 协调兑现/奖励 |
| `managePayments`    | 认缴/支付管理 |
| `analytics`         | 查看数据分析  |

##### 成员列表返回（建议）：

```json
{
  "code": 200,
  "data": [
    {
      "id": 1,
      "userId": 2260,
      "email": "collaborator@email.com",
      "name": "协作者",
      "avatar": "2260/xxx.png",
      "permissions": ["editProject", "analytics"],
      "status": "accepted",
      "joinTime": "2026-04-15T10:00:00"
    }
  ]
}
```

`status`: `pending`（待接受）| `accepted`（已加入）| `rejected`（已拒绝）

---

### 2.2 需要后端确认/调整

#### Q1: Content-Type 不统一

创建用 JSON，编辑和查询用 form-urlencoded。能否统一为 JSON？

| 接口                       | 当前            | 建议                                   |
| -------------------------- | --------------- | -------------------------------------- |
| `POST /project/create`     | JSON ✅         | 保持                                   |
| `POST /project/update`     | form-urlencoded | 统一为 JSON                            |
| `POST /project/query`      | form-urlencoded | 统一为 JSON（或改 GET + query params） |
| `POST /project/myprojects` | form-urlencoded | 统一为 JSON                            |
| `POST /project/myjoined`   | form-urlencoded | 统一为 JSON                            |

#### Q2: 下架/上架接口

是否有独立接口？还是通过 `POST /project/update` 修改 `projectStatus`（0=正常, 1=下架）？

#### Q3: Banner 上传

新平台 Banner 图上传走哪个接口？当前 fizzdragon-web 用通用 uni.uploadFile，存到 `fizzdragon-banner-sg` OSS bucket。

#### Q4: 标签列表接口

fizzdragon-web 用 `baseInfoStore.getTagList()`，具体 API 路径是？返回格式是什么？

#### Q5: 团队成员邀请

当前 fizzdragon-web 用 `/project/job/create`（招聘岗位）管理团队，但新平台需要**邀请制**的团队协作功能（类似 Kickstarter 的协作者）。需要后端新增：

- 邀请成员接口（通过邮箱邀请，带权限配置）
- 成员列表查询
- 移除成员
- 更新成员权限

是否复用现有的 `/project/member/*` 接口？还是新建一套？

---

## 三、IP 详情页

### 3.1 现有接口（可直接复用）

| 接口                               | 方法 | Content-Type    | 用途                                                        |
| ---------------------------------- | ---- | --------------- | ----------------------------------------------------------- |
| `POST /project/query`              | POST | form-urlencoded | IP 基本信息（名称、简介、封面、分类、background、联系方式） |
| `POST /vedio/play/project/getLink` | POST | form-urlencoded | 宣传视频链接                                                |
| `POST /project/member/query`       | POST | —               | 团队成员列表                                                |
| `POST /project/job/find/jobs`      | POST | form-urlencoded | 招聘岗位                                                    |
| `POST /project/profit/query/all`   | POST | —               | 分润信息                                                    |

### 3.2 需要后端新增的字段/接口

#### Q6: `/project/query` 返回新增字段

当前 `/project/query` 返回：`id, name, typeId, bannerLink, description, background, contact, tag, projectStatus, ...`

需新增：

| 字段             | 类型     | 说明                        |
| ---------------- | -------- | --------------------------- |
| `story`          | `string` | 背景故事（长文本，≤5000字） |
| `whyThisIP`      | `string` | 为什么做这个 IP（≤2000字）  |
| `targetEpisodes` | `number` | 目标集数                    |

#### Q7: 新增 FAQ 接口

| 接口                                  | 方法      | 用途                      |
| ------------------------------------- | --------- | ------------------------- |
| `GET /project/faq/list?projectId=xxx` | GET       | 获取 IP 的 FAQ 列表       |
| `POST /project/faq/save`              | POST JSON | 批量保存 FAQ（创建/更新） |
| `POST /project/faq/delete`            | POST JSON | 删除单条 FAQ              |

FAQ 数据结构：

```json
{
  "id": 1,
  "projectId": 279,
  "question": "这个 IP 的目标受众是？",
  "answer": "18-35 岁动画爱好者...",
  "sort": 0
}
```

#### Q8: 新增剧集列表接口

| 接口                                      | 方法      | 用途               |
| ----------------------------------------- | --------- | ------------------ |
| `GET /project/episode/list?projectId=xxx` | GET       | 获取 IP 的剧集列表 |
| `POST /project/episode/create`            | POST JSON | 创建剧集           |
| `POST /project/episode/update`            | POST JSON | 更新剧集           |
| `POST /project/episode/delete`            | POST JSON | 删除剧集           |

剧集数据结构：

```json
{
  "id": 1,
  "projectId": 279,
  "title": "第一集：命运的十字路口",
  "price": 0,
  "type": "linear",
  "sort": 0,
  "status": 0
}
```

`type`: `linear`（线性）| `interactive`（交互）

#### Q9: 更新动态接口（可选，优先级低）

| 接口                                     | 方法      | 用途                   |
| ---------------------------------------- | --------- | ---------------------- |
| `GET /project/update/list?projectId=xxx` | GET       | 获取 IP 的更新动态列表 |
| `POST /project/update/create`            | POST JSON | 发布更新               |

---

## 四、OSS Bucket 对照

| 用途             | Bucket                                                                                                               | 环境变量               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 分镜/AI 生成素材 | `fizzspace-test.oss-cn-hangzhou.aliyuncs.com`（测试）<br>`fizzstudio-sg.oss-ap-southeast-1.aliyuncs.com`（生产 COM） | `VITE_OSS_BASE_URL`    |
| 用户头像/封面    | `user-aratar-sg.oss-ap-southeast-1.aliyuncs.com`                                                                     | `VITE_USER_BASE_URL`   |
| IP Banner/封面   | `fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com`                                                               | `VITE_BANNER_BASE_URL` |
