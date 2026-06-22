# 新闻资讯模块 — Java后端开发需求文档

> 状态:admin-ui 前端 **UI/UX 已完成**(列表 + 新建/编辑 + 多语言),当前由内存 mock 驱动(`news-store.ts`),后端接口待 Java 实现。

## 1. 背景与目标

- 对标 legacy `admin_web` 的「资讯」模型,但**语言改用平台统一的 BCP-47 locale**(`zh-CN` / `en-US` / `zh-HK`,与 IP 分类一致),取代旧的 `cn` / `hk` / `en` 短码。
- 需要 Java 提供两组接口 + 数据表:
  1. **管理端 CRUD**(admin-ui 调用,管理员鉴权)—— 已有前端,优先级最高;
  2. **公开端只读**(站内 web / App 展示,匿名可访问)—— 让资讯能对外展示。
- 目标:admin-ui 下掉 mock;公开端可展示「内部文章(站内详情页)」与「外部链接(跳第三方)」。

## 2. 数据模型

### 2.1 资讯 News(主表)

| 字段          | 类型                                     | 说明                                            |
| ------------- | ---------------------------------------- | ----------------------------------------------- |
| `id`          | string                                   | 主键(对前端不透明,Java 自定;现 mock 用 `n_xxx`) |
| `kind`        | enum `article` \| `external`             | 内部文章(站内详情页) / 外部链接(跳第三方)       |
| `url`         | string                                   | 外链地址,**仅 `kind=external` 使用**,跨语言共享 |
| `author`      | string                                   | 作者 / 来源,跨语言共享                          |
| `status`      | enum `draft` \| `published` \| `offline` | 草稿(隐藏) / 已发布(对外) / 已下线(保留但隐藏)  |
| `tagIds`      | string[]                                 | 关联标签 id(见 2.3)                             |
| `publishedAt` | ISO datetime \| null                     | 发布时间;**`status=published` 时必填**          |
| `createdAt`   | ISO datetime                             | 创建时间(后端生成)                              |
| `updatedAt`   | ISO datetime                             | 更新时间(后端维护)                              |
| `localized`   | map<locale, NewsLocaleContent>           | 每语言内容,见 2.2                               |

### 2.2 多语言内容 NewsLocaleContent(每 locale 一份)

**字段级 i18n** —— 以下字段**按语言**存储;`kind/url/author/status/publishedAt/tagIds` 为**跨语言共享**。

| 字段       | 类型             | 说明                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------ |
| `title`    | string           | 标题                                                               |
| `summary`  | string           | 摘要(列表卡片用,2–3 行)                                            |
| `body`     | string(Markdown) | 正文,**仅 `kind=article` 有意义**;存 Markdown,与站内详情页渲染一致 |
| `coverUrl` | string           | 封面图地址(建议 16:9)                                              |
| `videoUrl` | string           | 视频地址(可选)                                                     |

- locale 取值:`zh-CN`(主语言)、`en-US`、`zh-HK`。
- 存储建议:主表 + 多语言子表(news_id, locale, title, summary, body, cover_url, video_url),或主表内 JSON。三种语言行可缺省(未翻译)。

### 2.3 标签 NewsTag

| 字段    | 类型                | 说明         |
| ------- | ------------------- | ------------ |
| `id`    | string              | 标签 id      |
| `label` | map<locale, string> | 每语言标签名 |

admin-ui 当前用固定 5 个标签:`product`(产品动态)、`industry`(行业洞察)、`tutorial`(教程)、`event`(活动)、`press`(媒体报道)。Java 可做成**可维护的标签表**;**最低限度提供「标签列表」接口**即可(本期可先按这 5 个 seed)。

## 3. 业务规则

1. **语言回退**:任何展示场景,某语言字段为空 → **回退主语言 `zh-CN`**。标题、封面均如此(见前端 `resolveTitle` / `primaryCover`:主语言空则取任一非空语言,再兜底)。
2. **保存校验**:
   - 主语言 `zh-CN` 标题必填;
   - `kind=external` → `url` 必填;`kind=article` → **主语言正文必填**;
   - `status=published` → `publishedAt` 必填(前端留空时取当前时间)。
3. **「翻译完整」判定**:某 locale 满足 `title` 非空 **且**(`article` 时)`body` 非空 → 视为该语言「已翻译」。管理端列表展示各语言「已翻译 / 缺翻译」徽标,并统计「缺翻译」条数。
4. **状态语义**:`draft` 不对外;`published` 对外;`offline` 保留数据但不对外。**公开端只返回 `published`**。
5. **kind 行为**:`article` → 进站内详情页(渲染 Markdown 正文);`external` → 新标签页打开 `url`。

## 4. 管理端接口(admin-ui 调用 · 管理员鉴权)

前缀建议 `/api/admin/news`(以 Java 现有 admin 规范为准)。统一信封 `{ code, data, msg }`。**管理端一律返回全语言 `localized`**(供编辑回填)。

| 方法          | 路径                   | 说明                                                                                                                                                                                                                                        |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET           | `/api/admin/news`      | 列表。筛选:`kind`(all/article/external)、`status`(all/draft/published/offline)、关键字 `q`(匹配 author/url + 各语言 title/summary);分页 `page`/`pageSize`(默认 20)。建议同时返回统计 `{ total, published, draft, incompleteTranslation }`。 |
| GET           | `/api/admin/news/:id`  | 详情(含全语言)                                                                                                                                                                                                                              |
| POST          | `/api/admin/news`      | 新建                                                                                                                                                                                                                                        |
| PATCH(或 PUT) | `/api/admin/news/:id`  | 更新                                                                                                                                                                                                                                        |
| DELETE        | `/api/admin/news/:id`  | 删除                                                                                                                                                                                                                                        |
| GET           | `/api/admin/news/tags` | 标签列表(id + 各语言 label)                                                                                                                                                                                                                 |

**创建/更新请求体**:`{ kind, url, author, status, tagIds[], publishedAt, localized: { "zh-CN": {...}, "en-US": {...}, "zh-HK": {...} } }`(`createdAt/updatedAt` 后端生成)。

## 5. 公开端接口(站内 web / App 展示 · 匿名)

只返回 `status=published`,按 `publishedAt` 倒序,字段按请求 `locale` **回退到 `zh-CN`**。

| 方法 | 路径            | 说明                                                                                                                                                                                  |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/news`     | 已发布列表。参数:`locale`、`tag`(可选)、分页。每项:`{ id, kind, url(external 用), author, publishedAt, tags, title, summary, coverUrl }`(均按 locale 回退)。**列表项不必返回 body**。 |
| GET  | `/api/news/:id` | 已发布**文章**详情(`article`):返回 `body`(Markdown,按 locale 回退)+ 上述字段。`external` 一般无需详情(前端直接跳 `url`)。                                                             |

## 6. 媒体

TODO

## 7. 通用约定

- 列表默认排序:管理端按 `updatedAt` 倒序、公开端按 `publishedAt` 倒序;分页 `pageSize` 默认 20。
- **与 legacy `admin_web` 资讯表的迁移/映射**:旧 `cn`/`hk`/`en` → 新 `zh-CN`/`zh-HK`/`en-US`;若沿用旧表需补 locale 维度(或新建多语言子表),并补 `kind`/`status`/`offline`/`tag` 等新字段。请 Java 评估「扩展旧表」还是「新建表」。

## 8. 验收

- admin-ui 把 `news-store.ts` 的内存调用替换为接口后,列表/筛选/统计/新建/编辑/删除/标签 全部走通;
- 公开端能按 locale 取到已发布列表 + 文章详情(含 Markdown 正文),缺语言正确回退到 zh-CN。
