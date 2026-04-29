# IP 模块接口

## IP 列表（Plaza）

`POST /vedio/project/search` `application/x-www-form-urlencoded`

请求：

| 字段     | 类型   | 必填 | 说明                   |
| -------- | ------ | ---- | ---------------------- |
| page     | int    | ✓    | 从 1 开始              |
| pageSize | int    | ✓    |                        |
| key      | string | ✓    | 关键词，无搜索时传空串 |
| TypeId   | string |      | 分类 id，不传 = 全部   |
| tag      | string |      | 标签 id，不传 = 全部   |

响应：

| 字段 | 类型        |
| ---- | ----------- |
| data | IPProject[] |
| sum  | int（总数） |

`IPProject`：

| 字段          | 类型   | 说明                                                     |
| ------------- | ------ | -------------------------------------------------------- |
| id            | int    |                                                          |
| name          | string |                                                          |
| typeId        | int    |                                                          |
| ownerId       | int    |                                                          |
| ownerName     | string |                                                          |
| ownerAvatar   | string |                                                          |
| bannerLink    | string |                                                          |
| videoLink     | string |                                                          |
| description   | string |                                                          |
| contact       | string |                                                          |
| tag           | string |                                                          |
| review        | int    | 审核：0 草稿 / 1 审核中 / 2 已通过（已发布）/ 3 审核失败 |
| projectStatus | int    | 上下架：0 上架 / 8 下架（仅 review = 2 后有效）          |
| createTime    | string |                                                          |

## 分类列表

`GET /vedio/project/type/list`

响应：

| 字段 | 类型   |
| ---- | ------ |
| list | Type[] |

`Type`：

| 字段 | 类型   |
| ---- | ------ |
| id   | int    |
| name | string |

## 标签列表

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

## 取宣传片播放链接

`POST /vedio/project/play-link` `application/x-www-form-urlencoded`

请求：

| 字段 | 类型 | 必填 |
| ---- | ---- | ---- |
| id   | int  | ✓    |

响应：

| 字段 | 类型   | 说明             |
| ---- | ------ | ---------------- |
| data | string | 临时签名播放 URL |

## 上传宣传片

`POST /vedio/project/upload-video` `multipart/form-data`

请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |
| file      | File | ✓    |

响应：

| 字段 | 类型   | 说明     |
| ---- | ------ | -------- |
| data | string | OSS 路径 |

## 创建 IP

`POST /vedio/project/create`

请求：

| 字段        | 类型   | 必填 | 说明                    |
| ----------- | ------ | ---- | ----------------------- |
| name        | string | ✓    | IP 名称                 |
| typeId      | int    | ✓    | 分类 id                 |
| description | string |      | 简介                    |
| bannerLink  | string |      | 封面 OSS 路径或完整 URL |
| contact     | string |      | 联系方式                |
| tag         | string |      | 标签，逗号分隔          |

响应：

| 字段 | 类型 |
| ---- | ---- |
| id   | int  |

## 编辑 IP

`POST /vedio/project/update`

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

`POST /vedio/project/submit`

请求：

| 字段 | 类型 | 必填 |
| ---- | ---- | ---- |
| id   | int  | ✓    |

响应：`{ code: 0 }`。

调用后 `review` 从 0/3 → 1。审核通过 / 失败由运营后台操作，前端不调；通过后 `review` → 2，IP 上架，进入 Plaza。

## 上下架

`POST /vedio/project/status/update`

请求：

| 字段          | 类型 | 必填 | 说明               |
| ------------- | ---- | ---- | ------------------ |
| id            | int  | ✓    |                    |
| projectStatus | int  | ✓    | 0 = 上架，8 = 下架 |

响应：`{ code: 0 }`。

仅 `review = 2` 的 IP 可调用。

## IP 详情

`POST /vedio/project/query`

请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |

响应：

| 字段          | 类型   |
| ------------- | ------ |
| id            | int    |
| name          | string |
| typeId        | int    |
| ownerId       | int    |
| ownerName     | string |
| ownerAvatar   | string |
| bannerLink    | string |
| videoLink     | string |
| description   | string |
| contact       | string |
| tag           | string |
| story         | string |
| whyThisIP     | string |
| review        | int    |
| projectStatus | int    |
| createTime    | string |

字段含义同 `IPProject`。

## 创建剧集

`POST /vedio/project/episode/create`

请求：

| 字段        | 类型   | 必填 | 说明                                                   |
| ----------- | ------ | ---- | ------------------------------------------------------ |
| projectId   | string | ✓    | 所属 IP id                                             |
| title       | string | ✓    |                                                        |
| description | string | ✓    |                                                        |
| videoUrl    | string | ✓    | OSS object key 或完整 URL                              |
| cover       | string | ✓    | OSS object key 或完整 URL                              |
| sort        | int    |      | 缺省 = `max(existing)+1`                               |
| videoMeta   | object |      | `{ width, height, size, duration }`，`duration` 单位秒 |

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

## 剧集列表

`GET /vedio/project/episode/list?projectId=xxx`

响应：

| 字段 | 类型                    |
| ---- | ----------------------- |
| list | Episode[]（同创建响应） |

## 更新剧集

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

## 删除剧集

`POST /vedio/project/episode/delete`

请求：

| 字段      | 类型   | 必填 |
| --------- | ------ | ---- |
| id        | string | ✓    |
| projectId | string | ✓    |

## 剧集排序

`POST /vedio/project/episode/reorder`

请求：

| 字段      | 类型     | 必填 | 说明           |
| --------- | -------- | ---- | -------------- |
| projectId | string   | ✓    |                |
| order     | string[] | ✓    | 剧集 id 新顺序 |

## Plaza 首页 — Featured 轮播

`GET /vedio/project/plaza/featured`

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
| keyArt      | string   | 大图 URL，建议 1920×1080     |
| tags        | string[] | 标签                         |
| episodes    | int      | 集数                         |

## Plaza 首页 — For You 横排

`GET /vedio/project/plaza/for-you?page=1&pageSize=10`

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

## 团队成员列表

`POST /vedio/project/member/query`

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

## 邀请成员

`POST /vedio/project/member/invite`

请求：

| 字段      | 类型   | 必填 | 说明         |
| --------- | ------ | ---- | ------------ |
| projectId | int    | ✓    |              |
| email     | string | ✓    | 被邀请人邮箱 |
| name      | string | ✓    | 显示名       |

响应：`{ code: 0 }`。

只是把成员加入 IP 的协作列表，不带任何管理操作权限；权限模型后续再加。

## 移除成员

`POST /vedio/project/member/remove`

请求：

| 字段      | 类型 | 必填 |
| --------- | ---- | ---- |
| projectId | int  | ✓    |
| userId    | int  | ✓    |

响应：`{ code: 0 }`。

## FAQ 列表

`POST /vedio/project/faq/query`

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

## 创建 FAQ

`POST /vedio/project/faq/create`

请求：

| 字段      | 类型   | 必填 |
| --------- | ------ | ---- |
| projectId | int    | ✓    |
| question  | string | ✓    |
| answer    | string | ✓    |
| sort      | int    |      |

响应：`{ id: int }`。

## 更新 FAQ

`POST /vedio/project/faq/update`

请求：

| 字段     | 类型   | 必填 |
| -------- | ------ | ---- |
| id       | int    | ✓    |
| question | string |      |
| answer   | string |      |
| sort     | int    |      |

响应：`{ code: 0 }`。

## 删除 FAQ

`POST /vedio/project/faq/delete`

请求：

| 字段 | 类型 | 必填 |
| ---- | ---- | ---- |
| id   | int  | ✓    |

响应：`{ code: 0 }`。
