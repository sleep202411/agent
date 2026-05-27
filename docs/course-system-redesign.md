# Course System Redesign

## 背景

课程模块不应该只是视频列表，而应该是 FizzDragon 创作者成长体系里的可售卖、可学习、可运营产品模块。

这份文档按目标态设计，不以任何既有后端接口为约束。实现时可以选择迁移、适配或重建数据源，但产品模型、后台管理能力、前端体验和服务端契约都应该围绕这里定义的规范结构落地。

## 核心定位

课程是一个体系化商品，不是一组散视频。

一门课程需要同时满足：

- **可定价**：课程有明确价格、试看规则、购买权益。
- **可分章**：课程下面有章节，章节下面有课时，用户按路径学习。
- **成体系**：课程围绕一个明确学习目标组织内容、路径和下一步转化。
- **可运营**：后台可创建、编辑、排序、定价、上下架、查看学习数据。
- **可闭环**：用户从发现课程，到购买/解锁，到学习完成，再进入创作、项目、剧组、人才主页或服务包。

一句话目标：

> 把课程从“内容播放模块”升级为“课程商品 + 学习路径 + 创作者转化”的完整系统。

## 范围边界

### 本阶段包含

- 课程广场
- 课程详情
- 课程学习页
- 课程、章节、课时结构
- 整门课程定价
- 免费试看课时
- 购买/解锁权益
- 服务端学习进度
- 后台课程管理
- 后台章节/课时管理
- 后台定价和上下架

### 本阶段暂不包含

- 创作者自行开课
- 章节单独购买
- 课程评价/评论
- 退款和争议流程

这些能力不应该污染第一版模型，但数据结构要保留可扩展空间。

## 产品目标

### 1. 课程是商品

课程应该有明确商品信息：

- 课程标题
- 副标题
- 封面
- 详情介绍
- 适合人群
- 学习目标
- 课程大纲
- 讲师/机构
- 难度
- 语言
- 章节数
- 课时数
- 总时长
- 价格
- 是否已购买
- 是否可试看
- 学习进度
- 发布状态

用户在课程列表和详情页应该能快速判断：

- 这门课教什么
- 是否适合自己
- 需要多少社区积分
- 哪些课时可以免费试看
- 买完解锁什么
- 学完下一步可以去哪里

### 2. 课程要分章节

推荐层级：

```text
Course
  Chapter
    Lesson
```

示例：

```text
AI 动画短片入门训练营
  第 1 章：故事与世界观
    1.1 如何拆解一个短片创意
    1.2 建立故事世界观

  第 2 章：角色设计
    2.1 主角设定方法
    2.2 角色视觉参考

  第 3 章：分镜与镜头
    3.1 镜头语言基础
    3.2 用 StoryOS 生成分镜
```

章节不是简单分类，而是学习路径。每个章节应该回答：

- 这一章解决什么能力问题
- 用户学完后理解什么
- 这一章包含哪些课时
- 这一章在整体路径中处于什么位置

### 3. 课程要成体系

体系化课程不只是“看视频”，而是：

- 前置目标：用户为什么学
- 结构化路径：从基础到实战
- 过程反馈：进度、完成状态、继续学习
- 平台转化：创建 IP、进入 Art Studio、加入剧组、完善人才主页、发布服务

FizzDragon 的课程应该服务“创作者成长”：

```text
学习课程
  -> 获得方法和能力
  -> 进入 Art Studio / StoryOS 实操
  -> 产出作品或项目
  -> 完善人才主页 / 发布服务包
  -> 加入剧组或获得订单
```

## 定价与权益模型

课程定价独立建模，不能把价格塞进视频或课时字段里。

### MVP 定价策略

第一阶段只支持：

1. 整门课程定价
2. 部分课时免费试看
3. 购买后解锁整门课程
4. 课程卡片和详情页展示价格、已购状态
5. 无权限播放时展示购买面板

### 支付媒介

课程使用 **社区积分**，不要混用 Studio AI 生成积分。

社区积分用于：

- 购买课程
- 解锁 IP 内容
- 参与活动/训练营
- 后续扩展到项目招人、服务包等社区交易场景

基本规则：

- 前端只展示余额、价格和购买动作
- 积分余额、扣款、入账、订单状态以后端为准
- 前端不能自己计算最终权益
- 购买确认前必须拉取最新价格和余额
- 价格变化时必须要求用户重新确认

## 核心数据模型

### Course

```ts
type Course = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  description: string;
  coverUrl: string;
  instructorId?: string;
  instructorName?: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  language: "en-US" | "zh-CN" | "zh-HK";
  status: "draft" | "published" | "archived";
  priceCredits: number;
  chapterCount: number;
  lessonCount: number;
  totalDurationSeconds?: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Chapter

```ts
type CourseChapter = {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  sortOrder: number;
  lessonCount: number;
  durationSeconds?: number;
  createdAt: string;
  updatedAt: string;
};
```

### Lesson

```ts
type CourseLesson = {
  id: string;
  courseId: string;
  chapterId: string;
  title: string;
  description?: string;
  sortOrder: number;
  type: "video" | "article" | "resource";
  preview: boolean;
  durationSeconds?: number;
  videoAssetId?: string;
  articleBody?: string;
  resourceUrl?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Entitlement

```ts
type CourseEntitlement = {
  id: string;
  userId: string;
  courseId: string;
  status: "active" | "revoked";
  source: "purchase" | "admin_grant";
  orderId?: string;
  grantedAt: string;
};
```

### Order

```ts
type CourseOrder = {
  id: string;
  userId: string;
  courseId: string;
  amountCredits: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  entitlementId?: string;
  createdAt: string;
  paidAt?: string;
};
```

### Progress

```ts
type CourseProgress = {
  userId: string;
  courseId: string;
  lessonId: string;
  status: "not_started" | "in_progress" | "completed";
  currentTimeSeconds?: number;
  durationSeconds?: number;
  completedAt?: string;
  updatedAt: string;
};
```

## 服务端接口需求

前端只消费产品级课程接口，不关心底层数据来自哪里。

### 用户侧接口

```text
GET  /aurora/courses
GET  /aurora/courses/:courseId
GET  /aurora/courses/:courseId/outline
GET  /aurora/courses/:courseId/entitlement
POST /aurora/courses/:courseId/orders
GET  /aurora/courses/:courseId/lessons/:lessonId/play
GET  /aurora/courses/:courseId/progress
PUT  /aurora/courses/:courseId/lessons/:lessonId/progress
```

### 后台管理接口

```text
GET    /aurora/admin/courses
POST   /aurora/admin/courses
GET    /aurora/admin/courses/:courseId
PATCH  /aurora/admin/courses/:courseId
POST   /aurora/admin/courses/:courseId/publish
POST   /aurora/admin/courses/:courseId/archive

POST   /aurora/admin/courses/:courseId/chapters
PATCH  /aurora/admin/courses/:courseId/chapters/:chapterId
DELETE /aurora/admin/courses/:courseId/chapters/:chapterId
PUT    /aurora/admin/courses/:courseId/chapters/reorder

POST   /aurora/admin/courses/:courseId/chapters/:chapterId/lessons
PATCH  /aurora/admin/courses/:courseId/lessons/:lessonId
DELETE /aurora/admin/courses/:courseId/lessons/:lessonId
PUT    /aurora/admin/courses/:courseId/lessons/reorder
```

后台接口必须有权限保护、操作审计和数据校验。

## 后台管理平台需求

### 课程列表

后台课程列表用于运营管理。

必须支持：

- 按标题搜索
- 按状态筛选：草稿、已发布、已归档
- 按语言筛选
- 按难度筛选
- 展示课程价格、章节数、课时数、购买人数、学习人数
- 展示最后更新时间
- 快速进入编辑
- 快速发布/归档

列表字段建议：

- 封面
- 标题
- 语言
- 难度
- 状态
- 价格
- 章节数
- 课时数
- 购买数
- 完课率
- 更新时间

### 新建/编辑课程

课程编辑页按信息结构分区：

1. 基础信息
2. 商品信息
3. 章节课时
4. 发布设置

基础信息：

- 标题
- 副标题
- 封面
- 详情介绍
- 适合人群
- 学习目标
- 讲师/机构
- 难度
- 语言

商品信息：

- 课程价格
- 是否允许试看
- 默认试看课时数量或手动选择试看课时

发布设置：

- 草稿保存
- 发布前校验
- 归档
- 预览前台详情页

发布前必须校验：

- 标题非空
- 封面已上传
- 描述非空
- 价格有效
- 至少一个章节
- 至少一个课时
- 每个已发布课时有内容源

### 章节管理

后台应支持：

- 新建章节
- 编辑章节标题和说明
- 删除空章节
- 拖拽排序章节
- 展示章节下课时数量和总时长

章节删除规则：

- 空章节可删除
- 有课时的章节删除前必须二次确认
- 已发布课程删除章节应记录审计日志

### 课时管理

课时支持：

- 视频课
- 图文课
- 资料课

后台应支持：

- 新建课时
- 编辑课时标题、简介、类型
- 上传或选择视频资源
- 编辑图文内容
- 设置是否免费试看
- 拖拽排序
- 删除课时
- 预览课时播放/阅读效果

### 数据和运营

后台需要基础运营数据：

- 课程浏览数
- 购买人数
- 学习人数
- 完成人数
- 完课率
- 平均学习进度
- 最近购买记录
- 最近学习记录

第一阶段只需要展示基础数据，不需要复杂分析报表。

## 前端需求

### 课程广场 `/courses`

目标：让用户发现课程并产生购买/学习意愿。

页面应该包含：

- 顶部课程定位和分类入口
- 课程卡片列表
- 分类筛选
- 难度筛选
- 免费试看筛选
- 已购/未购状态
- 学习进度
- 价格
- 课程体系标签，例如“StoryOS 入门路径”“AI 视频实战”“接单能力”

课程卡片至少包含：

- 封面
- 标题
- 简介
- 章节/课时数
- 难度
- 总时长
- 价格
- 是否可试看
- 已购/继续学习状态

交互要求：

- 未登录用户可浏览课程
- 已购课程显示“继续学习”
- 未购课程显示“查看详情”
- 可试看课程有明确标识
- 空状态和加载状态要完整

### 课程详情 `/courses/[courseId]`

目标：完成购买前决策。

页面应该包含：

- Hero：课程价值、价格、购买/继续学习按钮
- 课程大纲：章节和课时
- 免费试看标识
- 适合人群
- 学完你会得到什么
- 讲师/机构
- 相关课程/学习路径
- FAQ

权限体验：

- 无登录用户可以看详情
- 购买时引导登录
- 已购用户主按钮是“继续学习”
- 未购用户主按钮是“购买课程”
- 免费试看课时可以直接播放
- 无权限课时点击后展示购买面板

### 学习页 `/courses/[courseId]/learn`

目标：让用户顺畅学习和继续下一步。

布局建议：

```text
内容主区域 | 课程目录 / 进度 / 资料
```

应该具备：

- 视频播放或图文阅读
- 章节目录
- 当前课时高亮
- 上一课 / 下一课
- 学习进度保存
- 试看锁定
- 无权限购买面板
- 课程资料入口
- 学完后的下一步 CTA

学完后的 CTA 示例：

- 用 StoryOS 创建一个项目
- 进入 Art Studio 实操
- 发布作品到 IP 广场
- 完善人才主页
- 发布创作者服务包
- 加入相关剧组

### 购买确认弹窗

购买确认弹窗应该展示：

- 课程标题
- 当前价格
- 用户社区积分余额
- 购买后剩余积分
- 权益说明：解锁整门课程
- 确认购买按钮
- 取消按钮

错误反馈：

- 未登录：引导登录
- 余额不足：显示差额和获取积分入口
- 课程已下架：禁用购买并提示
- 价格已变化：刷新价格并要求重新确认
- 网络失败：保留重试按钮

## 前端架构建议

新课程模块采用 feature-local 架构：

```text
apps/web/app/(site)/courses/
  _hooks/
    use-courses.ts
    use-course-detail.ts
    use-course-entitlement.ts
    use-course-progress.ts
    use-course-order.ts
  _components/
    course-card.tsx
    course-outline.tsx
    pricing-panel.tsx
    lesson-player.tsx
    purchase-dialog.tsx
    progress-sidebar.tsx
  [courseId]/
    page.tsx
    learn/
      page.tsx
  page.tsx
```

后台管理模块也应独立，不要和用户侧页面混在一起：

```text
apps/web/app/(admin)/courses/
  _hooks/
    use-admin-courses.ts
    use-admin-course-editor.ts
  _components/
    admin-course-table.tsx
    course-editor-form.tsx
    chapter-editor.tsx
    lesson-editor.tsx
    publish-checklist.tsx
  [courseId]/
    page.tsx
  new/
    page.tsx
  page.tsx
```

设计要求：

- 用户侧偏消费和学习体验，信息要清晰、有购买转化。
- 后台侧偏密度和效率，适合反复编辑、排序、发布。
- 所有用户可见文案走 i18n。
- 后端错误原样展示，不吞掉可行动信息。
- 课程 ID 必须稳定，不使用数组 index 或临时前端序号。

## 权限与购买流程

### 播放权限

播放前需要判断：

```text
免费试看 lesson -> 允许播放
已购买 course -> 允许播放
否则 -> 展示购买面板
```

### 购买流程

```text
点击购买
  -> 检查登录
  -> 拉取最新课程价格和积分余额
  -> 展示确认弹窗
  -> 用户确认
  -> 服务端创建订单并扣积分
  -> 服务端写入课程权益
  -> 前端刷新 entitlement
  -> 自动进入学习页或继续播放
```

### 学习进度

进度必须服务端保存，不能只存在浏览器。

规则：

- 播放过程中节流上报
- 用户完成课时时写 completed
- 切换设备后能继续学习
- 课程完成度由服务端按课时完成情况计算

## MVP 范围建议

### Phase 1：课程商品和后台管理

- 后台课程 CRUD
- 后台章节/课时 CRUD
- 后台排序
- 后台价格设置
- 后台发布/归档
- 用户侧课程广场
- 用户侧课程详情
- 课程大纲展示
- 免费试看标识

### Phase 2：购买与权益

- 接入社区积分价格
- 创建购买订单
- 购买后解锁整门课程
- 无权限播放展示购买面板
- 余额不足提示
- 已购状态展示

### Phase 3：学习体验

- 新学习页
- 服务端进度
- 继续学习
- 上一课 / 下一课
- 完成状态
- 学完 CTA

### Phase 4：增长和运营

- 后台基础数据
- 课程推荐
- 课程和人才主页能力标签联动
- 课程和剧组/服务包推荐联动
- 多语言课程内容管理

## 当前实现需要避免的问题

1. 不使用数组 index 作为课程路由 ID。
2. 不用展示文案充当章节结构。
3. 不把价格、免费、播放权限塞进视频 URL 字段。
4. 不只在 localStorage 保存学习进度。
5. 不用 toast 代替购买面板。
6. 不让前端自行判断最终权益。
7. 不让后台发布绕过结构校验。
8. 不把后台编辑逻辑和用户侧学习页面混在一起。

## 需要确认的问题

1. 课程购买第一阶段是否只使用社区积分？
2. MVP 是否只支持整门课程购买，不支持章节单独购买？
3. 第一阶段课程发布方是否仅限官方/运营后台？
4. 课程完成是否要影响人才主页能力标签？
5. 后台管理平台是复用现有 admin shell，还是新增独立 `(admin)/courses` 信息架构？
6. 视频资源上传和转码是否由平台统一资产系统承接？

## 结论

课程重做的重点不是 UI 美化，而是建立一套课程商品系统：

```text
课程内容
  + 章节体系
  + 定价权益
  + 学习进度
  + 后台运营
  + 购买闭环
  + 创作者成长转化
```

只有这样，课程才能和 FizzDragon 的 IP、剧组、人才、服务包、社区积分连接起来，而不是成为一个孤立的视频入口。
