# IP Commerce Schema Design

本文记录新 IP / 剧集商业化模块的数据库边界。目标是建立一套新的
产品级内容商业化模型，支撑社区积分、预售、购买权益、创作者收益、
引荐、审核、版权声明、举报与屏蔽。

旧系统只作为导入来源存在。新模型不迁就、不复刻 Java 侧已有的项目、
剧集、价格表结构。

## 设计边界

`PlatformProject` 是内部生产协作容器，管理 workspace、资产、文档、
AI job、团队协作。

`IpTitle` 是对外发布和交易的 IP 商品。它可以关联一个
`PlatformProject.sourceProjectId`，但不等于内部项目。

这意味着：

- 项目协作者不自动等于 IP 公开创作者。
- IP 可以从旧系统导入，也可以从新的 PlatformProject 生成。
- 购买、权益、分润、审核都围绕 `IpTitle` / `IpEpisode`，不围绕 Java
  project id。

## 核心闭环

```text
IpTitle / IpEpisode
  -> IpCampaign
  -> IpPriceRule
  -> IpPurchaseOrder
  -> WalletTransaction / WalletLedgerEntry
  -> IpContentEntitlement
  -> IpCollectionItem
```

所有社区积分消费必须先形成订单，再通过 wallet ledger 扣款，最后发放
entitlement。任何服务都不能直接改余额或直接把内容标记为已购买。

## 内容模型

### `ip_titles`

公开 IP 聚合根。包含标题、简介、封面、hero、trailer、分类、标签、
AI 生成声明、版权摘要、发布状态。

重要字段：

- `workspace_id`：运营/生产归属。
- `source_project_id`：可选，关联内部生产项目。
- `status`：draft / review / published / suspended 等发布状态。
- `listing_visibility`：private / unlisted / public。

### `ip_episodes`

IP 下的剧集。可单独定价、单独审核、单独发布、单独购买。

### `ip_story_nodes` / `ip_story_choices`

支持互动影游结构，例如剧情 A / B 分支。普通线性剧集只需要一个
linear node；互动内容可以通过 choice 连接多个 node。

## 定价和预售

### `ip_campaigns`

运营活动或预售活动，例如 early bird、launch、event。活动可以配置
起止时间、解锁时间、tracking config。

### `ip_price_rules`

价格规则。当前 target 支持：

- `title`：整 IP 打包价。
- `episode`：单集价。

价格使用 `WalletCurrencyType`，当前主要是 `community_point`。表中保留
`site_region`，支持 `.com` / `.cn` 两套部署配置不同价格或不同活动。

## 购买和权益

### `ip_purchase_orders`

内容购买订单。它不是外部支付订单；社区积分消费仍然需要订单来保证：

- 幂等提交。
- 可追踪价格快照。
- 可退款。
- 可关联引荐。
- 可生成收益流水。

### `ip_content_entitlements`

购买后的访问权益。访问控制只看 entitlement，不看订单状态或价格规则。

支持 user / workspace 两种 subject，第一阶段主要使用 user。

### `ip_collection_items`

用户收藏夹和已购内容入口。购买后可以自动加入收藏，后续可记录播放进度。

## 创作者收益和引荐

### `ip_contributors`

IP 公开贡献者列表。它不等于 workspace members。可以是平台用户，也可以
是仅展示名称的外部贡献者。

### `ip_revenue_rules`

收益规则。支持：

- 制作费。
- 销售分润。
- 引荐佣金。
- 平台服务费。
- 手工调整。

### `ip_revenue_ledger_entries`

创作者收益看板的业务流水。真实可提现余额仍应通过 wallet ledger 入账；
该表负责记录收益来源、订单、规则、分成比例和状态。

### `ip_referral_links` / `ip_referral_attributions`

每个内容可以生成引荐链接。订单归因后可以计算引荐收益。

## 审核、版权和风控

### `ip_review_submissions` / `ip_review_events`

审核提交记录和事件流。审核对象支持 title、episode、price_rule、
revenue_rule、campaign。

审核时保存 snapshot，避免运营审核通过后内容被悄悄修改。

### `ip_rights_declarations`

版权和 AI 生成声明。支持 title / episode 粒度，记录来源、授权说明、
AI 生成声明和审核结果。

### `ip_content_reports`

用户举报入口。举报不会直接改内容状态，需要后台或系统产生
`ip_moderation_actions`。

### `ip_moderation_actions`

平台风控动作，包括 hide、suspend_sales、takedown、region_block、
age_gate、restore 等。

### `ip_user_content_blocks`

用户级屏蔽 / 不感兴趣。它只影响该用户自己的推荐和展示，不等于平台下架。

## 导入迁移策略

迁移是一个导入流程，不是数据模型兼容层。目标库只保存产品定义后的
标准结构：

1. 前端提供“迁移 / 导入”入口，让用户选择要迁移的旧项目或旧内容。
2. 前端只负责触发任务和展示进度，不直接编排多接口写库。
3. Nest 创建 `IpImportRun`，后台调用旧系统相关接口，聚合并归一化数据。
4. Nest 将旧系统返回的数据写入新的 `IpTitle` / `IpEpisode` / `IpPriceRule`
   等标准表。
5. `IpImportMap` 只用于记录旧来源到新实体的映射、幂等键、checksum 和
   `sourceSnapshot`，方便重跑、排查和增量同步。
6. 如果旧内容已经对应一个新的生产项目，再写入 `source_project_id`。
7. 新购买、新权益、新价格、新审核全部走 Nest + Postgres。

这个设计保证核心表不会出现 `legacy_project_id`、`priceType`、`targetId`
这类旧系统概念。旧系统结构只停留在导入映射和原始快照里。

## 不做的事

- 不把 IP 建成 `PlatformProject.projectType = ip`。
- 不把社区积分消费塞进 `BillingOrder`。
- 不把已购状态写到 IP 或 episode 行上。
- 不让前端理解 Java 的 priceType / targetId 设计。
