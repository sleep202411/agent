# 管理端 · 课程 API

**Base：** `{host}/api/admin/courses`  
（经网关时按实际前缀，如 `{host}/content/api/admin/courses`）

**鉴权：** 请求头 `X-Admin-Api-Token: {token}`（与新闻模块相同，无需 Cookie / Sa-Token）

**Controller：** `AdminCoursesController`

多语言对齐新闻：主表只存元数据；课程文案在 `course_locale`；视频**标题**在 `course_video_locale`，视频**封面**挂在 `course_video.cover_url`（各语言共用）。  
管理端读写用完整 `localized` map；顶层 `title` / `description` / `coverUrl` / `locale` 在管理端响应中为 `null`（公开端才扁平化）。

---

## 通用响应

```json
{
  "code": 200,
  "msg": "success",
  "data": {}
}
```

错误时一般为 `"code": 500`，`msg` 为原因。

---

## 接口一览

| #   | 操作             | 方法   | 路径                                  | 说明                                              |
| --- | ---------------- | ------ | ------------------------------------- | ------------------------------------------------- |
| 1   | 列表             | GET    | `/api/admin/courses`                  | 分页 / 搜索 / 发布状态                            |
| 2   | 详情             | GET    | `/api/admin/courses/{id}`             | 含 videos、instructors                            |
| 3   | 创建草稿         | POST   | `/api/admin/courses`                  | `published=0`，返回 `id`                          |
| 4   | 保存内容         | PUT    | `/api/admin/courses/{id}`             | **不改**发布状态；locales / videos / 讲师全量替换 |
| 5   | 发布 / 下架      | PATCH  | `/api/admin/courses/{id}/publish`     | `{ "published": true\|false }`                    |
| 6   | 删除             | DELETE | `/api/admin/courses/{id}`             | **真删除**（非下架）                              |
| 7   | 上传封面         | POST   | `/api/admin/courses/upload/cover`     | `multipart file` → OSS path                       |
| 8   | 上传视频（兜底） | POST   | `/api/admin/courses/upload/video`     | `multipart file` → OSS path（作 `videoKey`）      |
| 9   | 视频直传预签名   | POST   | `/api/admin/courses/upload/video-url` | JSON → 公网 PUT URL + `path`（推荐）              |

推荐流程：`创建草稿` → `上传封面` + **浏览器直传视频** → `保存内容` → `发布`。

大文件请走接口 9（浏览器 PUT 到 OSS），避免 Cloudflare 对 multipart 的 body 限制。接口 8 仅作兜底。

---

## 1. 课程列表

`GET /api/admin/courses?q=&published=all&page=1&pageSize=20`

| 参数        | 说明                        |
| ----------- | --------------------------- |
| `q`         | 可选，按各语言 title 模糊搜 |
| `published` | `all` / `true` / `false`    |
| `page`      | 默认 1                      |
| `pageSize`  | 默认 20                     |

`data.list[]` 项含完整 `localized`、`instructors`、`videoCount`（不返回完整 `videos[]`）；管理端顶层文案字段为 `null`。

`data.stats`（全局，不受当前筛选影响）：

| 字段          | 说明             |
| ------------- | ---------------- |
| `total`       | 全部课程数       |
| `published`   | 已上架           |
| `unpublished` | 未上架           |
| `instructors` | 去重后的讲师人数 |

---

## 2. 课程详情

`GET /api/admin/courses/{id}`

示例（课 14「全球共创分润」结构）：

```json
{
  "id": 14,
  "published": true,
  "createTime": "2026-08-21T17:42:17",
  "updateTime": "2026-08-21T17:42:17",
  "localized": {
    "zh-CN": {
      "title": "FizzDragon 全球共创分润机制 V1",
      "description": "FizzDragon 全球共创分润机制 V1",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6.png"
    },
    "en-US": {
      "title": "FizzDragon Global Co-CreationRevenue SharingMechanism  V1",
      "description": "FizzDragon Global Co-CreationRevenue SharingMechanism  V1",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6en.jpg"
    },
    "zh-HK": {
      "title": "FizzDragon 全球共創分潤機制 V1",
      "description": "FizzDragon 全球共創分潤機制 V1",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6en.jpg"
    }
  },
  "title": null,
  "description": null,
  "coverUrl": null,
  "locale": null,
  "videos": [
    {
      "id": 61,
      "videoKey": "course/分润.mp4",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6.png",
      "sortOrder": 1,
      "sectionId": null,
      "localized": {
        "zh-CN": { "title": "FizzDragon 全球共创分润机制 V1" },
        "en-US": { "title": "FizzDragon Global Co-CreationRevenue SharingMechanism  V1" },
        "zh-HK": { "title": "FizzDragon 全球共創分潤機制 V1" }
      },
      "title": null
    }
  ],
  "instructors": [
    {
      "userId": 15,
      "nickName": "...",
      "avatar": "...",
      "description": "...",
      "shareBps": 5000
    }
  ],
  "certificateId": 13,
  "priceCredits": 100,
  "enrollmentEnabled": true,
  "instructorShares": [{ "userId": 15, "shareBps": 5000 }]
}
```

| 字段                         | 说明                                            |
| ---------------------------- | ----------------------------------------------- |
| `localized`                  | 课程文案，key 如 `zh-CN` / `en-US` / `zh-HK`    |
| `videos[].videoKey`          | 各语言共用同一片源 key（OSS object key）        |
| `videos[].coverUrl`          | 视频封面，**各语言共用**（不在 localized 里）   |
| `videos[].localized.*.title` | 视频标题，按语言                                |
| `videos[].sectionId`         | 预留章节，一期恒为 `null`                       |
| `instructors`                | 由保存时的 `instructorUserIds` 展开             |
| `instructors[].shareBps`     | 该讲师分润，万分比（50% = 5000）；未设为 `null` |
| `certificateId`              | 认证等级 id，未指定为 `null`                    |
| `priceCredits`               | 报名总费用（社区积分），未售为 `0`              |
| `enrollmentEnabled`          | 是否开启报名                                    |
| `instructorShares`           | 与讲师分润相同，便于按 userId 对齐              |

---

## 3. 创建草稿

`POST /api/admin/courses`  
Body 可空。

```json
{ "code": 200, "msg": "success", "id": 99 }
```

---

## 4. 保存内容

`PUT /api/admin/courses/{id}`  
**不改变** `published`。`localized` / `videos` / 讲师均为**全量先删后插**（漏传即删除）。

请求体示例（同课 14）：

```json
{
  "localized": {
    "zh-CN": {
      "title": "FizzDragon 全球共创分润机制 V1",
      "description": "FizzDragon 全球共创分润机制 V1",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6.png"
    },
    "en-US": {
      "title": "FizzDragon Global Co-CreationRevenue SharingMechanism  V1",
      "description": "FizzDragon Global Co-CreationRevenue SharingMechanism  V1",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6en.jpg"
    },
    "zh-HK": {
      "title": "FizzDragon 全球共創分潤機制 V1",
      "description": "FizzDragon 全球共創分潤機制 V1",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6en.jpg"
    }
  },
  "videos": [
    {
      "videoKey": "course/分润.mp4",
      "coverUrl": "https://fizzdragon-web-static-sg.oss-ap-southeast-1.aliyuncs.com/static/fizzdragonCourse/%E5%88%86%E6%B6%A6.png",
      "sortOrder": 1,
      "localized": {
        "zh-CN": { "title": "FizzDragon 全球共创分润机制 V1" },
        "en-US": { "title": "FizzDragon Global Co-CreationRevenue SharingMechanism  V1" },
        "zh-HK": { "title": "FizzDragon 全球共創分潤機制 V1" }
      }
    }
  ],
  "instructorUserIds": [15],
  "certificateId": 13,
  "priceCredits": 100,
  "enrollmentEnabled": true,
  "instructorShares": [{ "userId": 15, "shareBps": 5000 }]
}
```

规则：

- `localized` 必填，至少一种语言 `title` 非空
- `videos[].videoKey` 必填；`videos[].coverUrl` 可选（视频封面共用）
- `videos[].id` 可不传（每次保存会重建视频行，id 可能变化）
- `instructorUserIds`：全量替换；传 `[]` 或 `null` 会清空讲师
- `certificateId` / `priceCredits` / `enrollmentEnabled` / `instructorShares` 与课程内容一起落 Java 库；`instructorShares[].shareBps` 合计不得超过 10000（100%）
- `instructorShares` 只含填写了分润的讲师；`userId` 必须出现在 `instructorUserIds` 中

---

## 5. 发布 / 下架

`PATCH /api/admin/courses/{id}/publish`

```json
{ "published": true }
```

```json
{ "published": false }
```

发布前需至少一种语言有 `title`。下架用本接口，**不要用 DELETE**。

---

## 6. 删除（真删除）

`DELETE /api/admin/courses/{id}`

物理删除 catalog，并级联清除 locale / video / video_locale / instructor。  
不可恢复；仅下架请用 §5。

---

## 7. 上传封面

`POST /api/admin/courses/upload/cover`  
`Content-Type: multipart/form-data`，字段名 `file`  
支持 jpg / jpeg / png / gif / webp。

```json
{ "code": 200, "msg": "success", "data": "course/cover/....jpg" }
```

把返回的 path（或完整 URL，视环境约定）写入课程 `localized.*.coverUrl`，或视频级 `videos[].coverUrl`。

---

## 8. 上传视频（multipart 兜底）

`POST /api/admin/courses/upload/video`  
`multipart` 字段 `file`。

```json
{ "code": 200, "msg": "success", "data": "course/....mp4" }
```

返回值作为保存时的 `videos[].videoKey`。管理端默认改走下方直传；本接口保留兼容。

---

## 9. 视频直传预签名（推荐）

`POST /api/admin/courses/upload/video-url`  
`Content-Type: application/json`

```json
{ "fileName": "lesson.mp4", "contentType": "video/mp4" }
```

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "uploadUrl": "https://....aliyuncs.com/....?Signature=...",
    "method": "PUT",
    "headers": {
      "Content-Type": "video/mp4",
      "Cache-Control": "max-age=..."
    },
    "path": "course/1710000000000_lesson.mp4"
  }
}
```

客户端流程：

1. 调本接口拿到 `uploadUrl` / `headers` / `path`（小 JSON，可过 Cloudflare）
2. 浏览器对 `uploadUrl` 发 `PUT`，**原样带上** `headers`（`Content-Type` 参与签名，必须一致）
3. PUT 成功后把 `path` 写入 `videos[].videoKey`，再保存课程

签发用公网 OSS endpoint（`oss.endpoint_upload_public`），禁止 `*-internal*`。

视频桶 CORS 需允许管理端 Origin 的 `PUT` / `OPTIONS`（你们桶上已有 `*` + PUT 即可）。

---

## 相关 DDL / 迁移（运维）

| 文件                                                                 | 用途                                          |
| -------------------------------------------------------------------- | --------------------------------------------- |
| `src/main/resources/db/course_module.sql`                            | 新环境建表                                    |
| `src/main/resources/db/course_commerce.sql`                          | 已有库加认证 / 费用 / 报名 / 讲师分润列       |
| `src/main/resources/db/course_i18n.sql`                              | 已有无 locale 表时升级                        |
| `src/main/resources/db/course_video_cover_shared.sql`                | 视频封面从 locale 迁到 `course_video`（共用） |
| `src/main/resources/db/course_migrate_from_legacy.sql`               | 从旧 `course` 表迁移                          |
| `src/main/resources/db/course_auto_merge_same_videos.sql`            | 同片源多语言课自动合并                        |
| `src/main/resources/db/course_backfill_video_locale_from_legacy.sql` | 从旧表回填视频多语言标题 + 共用封面           |

---

## Postman

| 文件                                                                                                                      | 说明       |
| ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [`docs/postman/fizzdragon-courses.postman_collection.json`](postman/fizzdragon-courses.postman_collection.json)           | Collection |
| [`docs/postman/fizzdragon-courses.postman_environment.json`](postman/fizzdragon-courses.postman_environment.json)         | Local      |
| [`docs/postman/fizzdragon-courses-cn.postman_environment.json`](postman/fizzdragon-courses-cn.postman_environment.json)   | CN         |
| [`docs/postman/fizzdragon-courses-com.postman_environment.json`](postman/fizzdragon-courses-com.postman_environment.json) | COM        |

1. Import Collection + Environment
2. 填 `adminToken`
3. 管理端只需 `X-Admin-Api-Token`
