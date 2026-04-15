# 用户资料页（Profile）— 后端接口变更需求

---

## 1. 用户信息接口新增 `coverImage` 字段

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

---

## 2. 新增封面图上传接口

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

---

## 3. 用户信息更新接口支持 `coverImage`

**接口**: `POST /user/update/user/info`

请求体新增支持：

| 字段         | 类型     | 说明            |
| ------------ | -------- | --------------- |
| `coverImage` | `string` | 封面图 OSS 路径 |

---

## 4. 求职状态（Available / 人才集市展示）

### 4.1 用户信息接口新增 `availableForWork` 字段

**接口**: `GET /user/query/user/info`

| 字段               | 类型      | 说明                                       |
| ------------------ | --------- | ------------------------------------------ |
| `availableForWork` | `boolean` | 是否开启求职状态，开启后用户出现在人才集市 |

### 4.2 更新求职状态

**接口**: `POST /user/update/user/info`

请求体新增支持：

| 字段               | 类型      | 说明              |
| ------------------ | --------- | ----------------- |
| `availableForWork` | `boolean` | 开启/关闭求职状态 |

### 4.3 人才集市列表（可选，如果还没有）

**接口**: `GET /user/talent/list` 或复用已有接口

返回 `availableForWork=true` 的用户列表，包含头像、昵称、认证角色、评分、项目数等。

---

## 前端已实现的功能

| 功能                         | 对应接口                                     | 状态                       |
| ---------------------------- | -------------------------------------------- | -------------------------- |
| 个人主页封面图展示           | `GET /user/query/user/info` → `coverImage`   | 前端已实现，等后端返回字段 |
| 封面图上传（hover 显示按钮） | `POST /content/user/uploadCover`             | 前端已实现，等后端接口     |
| 编辑资料保存封面             | `POST /user/update/user/info` → `coverImage` | 前端已实现，等后端支持     |
| 头像上传                     | `POST /content/user/uploadAratar`            | ✅ 已对接                  |
| 用户信息获取                 | `GET /user/query/user/info`                  | ✅ 已对接                  |
| 用户信息编辑                 | `POST /user/update/user/info`                | ✅ 已对接                  |
| 积分查询                     | `POST /api/ai/record/myscore`                | ✅ 已对接                  |
| 推荐码                       | `GET /user/recommendationcode`               | ✅ 已对接                  |
| 认证角色列表                 | `GET /project/role/list`                     | ✅ 已对接                  |
| 我的认证列表                 | `POST /project/role/mylist`                  | ✅ 已对接                  |
| 新增认证                     | `POST /project/role3/auth`                   | ✅ 已对接                  |
| 编辑认证                     | `POST /project/update/role2/auth`            | ✅ 已对接                  |
| 我的 IP 列表                 | `POST /project/myprojects`                   | ✅ 已对接                  |
| 我加入的项目                 | `POST /project/myjoined`                     | ✅ 已对接                  |

---
