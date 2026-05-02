# IP 模块接口

> ⚠️ 标记的是需要后端实现的接口。下面按"前端依赖度 + 操作优先于查询"分组：P0 先做。

---

**P0 — 阻塞主流程**

## ⚠️⚠️⚠️⚠️⚠️⚠️ 创建剧集

`POST /project/episode/create`

请求：

| 字段        | 类型   | 必填 | 说明                                                   |
| ----------- | ------ | ---- | ------------------------------------------------------ |
| projectId   | string | ✓    | 所属 IP id                                             |
| title       | string | ✓    |                                                        |
| description | string | ✓    |                                                        |
| videoUrl    | string | ✓    | OSS object key 或完整 URL                              |
| cover       | string | ✓    | OSS object key 或完整 URL                              |
| sort        | int    |      | ⚠️⚠️⚠️⚠️ 加个排序接口，用于排列剧集的第几集信息        |
| videoMeta   | json   |      | `{ width, height, size, duration }`，`duration` 单位秒 |

响应：

| 字段        | 类型   |
| ----------- | ------ |
| id          | string |
| projectId   | string |
| title       | string |
| description | string |
| videoUrl    | string |
| cover       | string |
| duration    | int    |
| sort        | int    |
| createdAt   | string |

## ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️ 更新剧集

`POST /vedio/project/episode/update`

请求：

| 字段        | 类型   | 必填 | 说明 |
| ----------- | ------ | ---- | ---- |
| id          | string | ✓    |      |
| projectId   | string | ✓    |      |
| title       | string |      |      |
| description | string |      |      |
| videoUrl    | string |      |      |
| cover       | string |      |      |
| sort        | int    |      |      |
| videoMeta   | object |      |      |

响应：同创建响应。

## ⚠️⚠️⚠️⚠️⚠️⚠️ 删除剧集

`POST /project/episode/delete`

请求：

| 字段 | 类型   | 必填 |
| ---- | ------ | ---- |
| id   | string | ✓    |

## ⚠️⚠️⚠️⚠️⚠️ IP 列表（Plaza）

`POST /project/list`

请求：

| 字段     | 类型   | 必填 | 说明                  |
| -------- | ------ | ---- | --------------------- |
| page     | int    | ✓    | 从 1 开始             |
| pageSize | int    | ✓    |                       |
| key      | string | ✓    | 关键词,无搜索时传空串 |
| typeId   | string |      | 分类 id,不传 = 全部   |
| tag      | string |      | 标签 id,不传 = 全部   |

响应：

| 字段             | 类型        |
| ---------------- | ----------- |
| data.list        | IPProject[] |
| data.total       | int         |
| data.currentPage | int         |
| data.pageSize    | int         |

`IPProject`：

| 字段               | 类型   | 说明                                                     |
| ------------------ | ------ | -------------------------------------------------------- |
| id                 | int    |                                                          |
| name               | string |                                                          |
| typeId             | int    |                                                          |
| ownerId            | int    |                                                          |
| ownerName          | string |                                                          |
| ownerAvatar        | string |                                                          |
| bannerLink         | string |                                                          |
| ⚠️⚠️⚠️⚠️ videoLink | string | ⚠️⚠️⚠️⚠️可以公共访问                                     |
| description        | string |                                                          |
| contact            | string |                                                          |
| tag                | string |                                                          |
| review             | int    | 审核：0 草稿 / 1 审核中 / 2 已通过（已发布）/ 3 审核失败 |
| projectStatus      | int    | 上下架：0 上架 / 8 下架（仅 review = 2 后有效）          |
| createTime         | string |                                                          |

## ⚠️⚠️⚠️⚠️⚠️ 分类列表

⚠️⚠️⚠️⚠️⚠️⚠️ 如果可以统一成 /project/type/list 就更好了

`GET /vedio/project/type/list`

```
{
    "msg": "Success",
    "code": 200,
    "data": {
        "1": "Movies",
        "2": "Anime Series",
        "50": "数码港比赛 Top 10",
        "3": "Documentary",
        "4": "Special Program",
        "5": "Animation",
        "6": "Short Drama",
        "7": "Science Fiction",
        "8": "Romance",
        "9": "Creativity"
    }
}
改成：
{
    "msg": "Success",
    "code": 200,
    "data": [
      { id: 1, name: 'xxx' },
      { id: 2, name: 'xxx' },
      { id: 3, name: 'xxx' },
    ]
}

```

响应：

| 字段 | 类型   |
| ---- | ------ |
| list | Type[] |

`Type`：

| 字段 | 类型   |
| ---- | ------ |
| id   | int    |
| name | string |

---

**P1**

## ⚠️⚠️⚠️⚠️ 剧集排序

`POST /project/episode/reorder`

请求：

| 字段           | 类型   | 必填 | 说明                            |
| -------------- | ------ | ---- | ------------------------------- |
| currentVideoId | string | ✓    | 当前要移动的 videoId            |
| beforeVideoId  |        |      | 当前剧集要移动到哪个 video 前面 |

## ⚠️⚠️⚠️⚠️ 添加成员

`POST /project/member/add`

请求：

| 字段      | 类型   | 必填 | 说明         |
| --------- | ------ | ---- | ------------ |
| projectId | int    | ✓    |              |
| email     | string | ✓    | 被邀请人邮箱 |
| name      | string | ✓    | 显示名       |

响应：`{ code: 0 }`。

只是把成员加入 IP 的协作列表，不带任何管理操作权限；权限模型后续再加。

## ⚠️⚠️⚠️⚠️ 移除成员

`POST /project/member/remove`

请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |
| userId    | int  | ✓    |

响应：`{ code: 0 }`。

## ⚠️⚠️⚠️⚠️ 创建 FAQ

`POST /project/faq/create`

请求：

| 字段      | 类型   | 必填 |
| --------- | ------ | ---- |
| projectId | int    | ✓    |
| question  | string | ✓    |
| answer    | string | ✓    |
| sort      | int    |      |

响应：`{ id: int }`。

## ⚠️⚠️⚠️⚠️ 更新 FAQ

`POST /project/faq/update`

请求：

| 字段     | 类型   | 必填 |
| -------- | ------ | ---- |
| id       | int    | ✓    |
| question | string |      |
| answer   | string |      |
| sort     | int    |      |

响应：`{ code: 0 }`。

## ⚠️⚠️⚠️⚠️删除 FAQ

`POST /project/faq/delete`

请求：

| 字段 | 类型 | 必填 |
| ---- | ---- | ---- |
| id   | int  | ✓    |

响应：`{ code: 0 }`。

## ⚠️⚠️⚠️⚠️ FAQ 列表

`POST /project/faq/query`

请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |

响应：

| 字段 | 类型  |
| ---- | ----- |
| list | FAQ[] |

`FAQ`：

| 字段      | 类型   |
| --------- | ------ |
| id        | int    |
| projectId | int    |
| question  | string |
| answer    | string |
| sort      | int    |

## ⚠️⚠️⚠️⚠️ 标签列表

⚠️⚠️ 如果可以统一成 /project/tag/list 就更好了

`GET /vedio/project/tag/list`

响应：

| 字段 | 类型  |
| ---- | ----- |
| list | Tag[] |

`Tag`：

| 字段   | 类型   | 说明                |
| ------ | ------ | ------------------- |
| id     | int    |                     |
| name   | string |                     |
| typeId | int    | 所属分类 id（外键） |

## ⚠️⚠️⚠️⚠️ Plaza 首页 — Featured 轮播

`GET /project/plaza/featured`

⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️ 可以加个字段标记，先手动从数据库中标记出 5 个 ，后面会在后台中提供对应的功能，用于运营管理

响应：

| 字段 | 类型            |
| ---- | --------------- |
| list | FeaturedSlide[] |

`FeaturedSlide`：

| 字段        | 类型     | 说明                         |
| ----------- | -------- | ---------------------------- |
| id          | string   | IP id                        |
| title       | string   | 主标题                       |
| subtitle    | string   | 副标题（英文/拼音）          |
| eyebrow     | string   | 顶部小标，如 "INVESTING NOW" |
| description | string   | 简介，1-2 句                 |
| ~~keyArt~~  | string   | 大图 URL，建议 1920×1080     |
| tags        | string[] | 标签                         |
| episodes    | int      | 集数                         |

## ⚠️⚠️⚠️⚠️ Plaza 首页 — For You 横排

`GET /project/plaza/for-you?page=1&pageSize=10`

先手动在数据中标记 6-10个，后续会在管理平台中支持这个功能

响应：

| 字段  | 类型       |
| ----- | ---------- |
| list  | RailItem[] |
| total | int        |

`RailItem`：

| 字段     | 类型   | 说明                        |
| -------- | ------ | --------------------------- |
| id       | string | IP id                       |
| title    | string |                             |
| cover    | string | 封面 URL，建议 600×400 横版 |
| episodes | int    |                             |

---

**已就绪（仅文档化，无需后端额外工作）**

## 创建 IP

~~`POST /vedio/project/create`~~
`POST /project/create`

请求：

| 字段        | 类型   | 必填 | 说明           |
| ----------- | ------ | ---- | -------------- |
| name        | string | ✓    | IP 名称        |
| typeId      | int    | ✓    | 分类 id        |
| description | string | ✓    | 简介           |
| bannerLink  | string |      |                |
| contact     | string |      | 联系方式       |
| tag         | string |      | 标签，逗号分隔 |

响应：

| 字段 | 类型 |
| ---- | ---- |
| id   | int  |

## 编辑 IP

`POST /project/update`

请求：

| 字段        | 类型   | 必填 | 说明                                  |
| ----------- | ------ | ---- | ------------------------------------- |
| id          | int    | ✓    |                                       |
| name        | string |      |                                       |
| typeId      | int    |      |                                       |
| description | string |      |                                       |
| bannerLink  | string |      |                                       |
| contact     | string |      |                                       |
| tag         | string |      |                                       |
| story       | string |      | 故事大纲（Story tab 长文本，0..5000） |
| whyThisIP   | string |      | 创作动机（Story tab 长文本，0..2000） |

响应：`{ code: 0 }`。

新建的 IP 默认 `review = 0`（草稿）；只有审核通过（review = 2）的 IP 才会出现在 Plaza 列表里。`review` / `projectStatus` 不接受这个接口写入，分别走"提交审核"和"上下架"。

## 提交审核

`POST /vedio/project/update`
调用更新接口，status 传 5.
撤销审核，status 传 0.
前端，如果已经审核通过，就不允许修改；"重新编辑" 按钮，点击后，会将 status 重置 0，

请求：

| 字段   | 类型 | 必填 |
| ------ | ---- | ---- | -------------------------- |
| id     | int  | ✓    |
| status | int  | ✓    | 5 = 提交审核，0 = 撤销审核 |

响应：`{ code: 0 }`。

调用后 `review` 从 0/3 → 1。审核通过 / 失败由运营后台操作，前端不调；通过后 `review` → 2，IP 上架，进入 Plaza。

## 上下架

`POST /project/update`

请求：

| 字段          | 类型 | 必填 | 说明               |
| ------------- | ---- | ---- | ------------------ |
| id            | int  | ✓    |                    |
| projectStatus | int  | ✓    | 0 = 上架，8 = 下架 |

响应：`{ code: 0 }`。

仅 `review = 2` 的 IP 可调用。

## 上传宣传片

`POST /project/upload/project/video/backup`

请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |
| file      | File | ✓    |

响应：

| 字段 | 类型   | 说明     |
| ---- | ------ | -------- |
| data | string | OSS 路径 |

## 上传宣传片banner

1. POST content/project/uploadBanner

```
{"msg":"成功","path":"2259/login-image-2.jpg","code":200}
```

2. 再调用 IP 更新接口保存 bannerLink。

## IP 详情

`POST /project/query`

请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |

响应：

| 字段               | 类型   |
| ------------------ | ------ |
| id                 | int    |
| name               | string |
| typeId             | int    |
| ownerId            | int    |
| ownerName          | string |
| ownerAvatar        | string |
| bannerLink         | string |
| videoLink          | string |
| description        | string |
| contact            | string |
| tag                | string |
| story - background | string |
| ⚠️⚠️⚠️⚠️ whyThisIP | string |
| review             | int    |
| projectStatus      | int    |
| createTime         | string |

字段含义同 `IPProject`。

## 剧集列表

`GET /project/episode/list?projectId=xxx`

响应：

| 字段 | 类型                    |
| ---- | ----------------------- |
| list | Episode[]（同创建响应） |

## 团队成员列表

`POST /project/member/query`
请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |

响应：

| 字段 | 类型            |
| ---- | --------------- |
| list | ProjectMember[] |

`ProjectMember`：

| 字段     | 类型   | 说明 |
| -------- | ------ | ---- |
| id       | int    |      |
| userId   | int    |      |
| userName | string |      |
| nickName | string |      |
| avatar   | string |      |
| roleId   | int    |      |
| roleName | string |      |

---

**废弃**

## 取宣传片播放链接 （废弃、忽略）

`POST /vedio/project/play-link` `application/x-www-form-urlencoded`

请求：

| 字段 | 类型 | 必填 |
| ---- | ---- | ---- |
| id   | int  | ✓    |

响应：

| 字段 | 类型   | 说明             |
| ---- | ------ | ---------------- |
| data | string | 临时签名播放 URL |

---

### 草稿记录，可忽略

```

id：剧集 id

review:5 - 审核通过； 0 - 默认 0，刚创建；3 - 审核拒绝
status: 5 - 已经发布到 IP 广场；默认 0 - 刚创建；8 - 用户自己/管理员下架




status: 5 - 提交审核；8 下架；
保存的时候不传 status；
```
