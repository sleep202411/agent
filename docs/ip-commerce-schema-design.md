# IP Commerce Schema Design

本文记录新版 IP 模块的当前数据库边界和后续方向。当前版本只保留已经能形成
产品闭环的能力：IP 档案、剧集、素材、多语言、定价、购买、权益、收藏、
引荐归因、审核、版权声明、举报和屏蔽。

故事圣经、角色库、世界元素、互动节点、聊天室、游戏化体验、媒体字幕轨、
创作者收益分账、投资 / 合作 Pitch 是明确的未来产品方向，但当前没有对应的
完整编辑体验、发布体验、展示体验、线索跟进和运营治理闭环，所以不进入当前
schema。

## 设计边界

`Ip` 是对外发布、持续生产内容、沉淀粉丝关系、协作和商业化的聚合根。
IP 模块不依赖 Java 旧项目、旧剧集、旧价格接口，也不保存旧系统来源字段。

当前需要兼容线上旧 IP 数据时，保持两套接口和两套数据源并行：旧数据继续走
旧 Java UI/API，新创建的 IP 走 Nest + Postgres 新模型。未来如果要迁移，
应设计一次性导入任务和人工校验流程，而不是在核心 schema 里长期保留旧字段。

当前新版 IP 不绑定 FizzStudio workspace、项目、剧组或 gig。未来要串联这些
生产资料时，应通过独立 link / integration 表表达清晰的业务关系，不能把
外部生产概念写进 IP 根表。

## 核心闭环

```text
Ip / IpLocalization
  -> IpEpisode / IpEpisodeLocalization
  -> MediaAsset / IpAsset
  -> IpCampaign / IpCampaignLocalization
  -> IpPriceRule
  -> IpPurchaseOrder
  -> WalletTransaction / WalletLedgerEntry
  -> IpContentEntitlement
  -> IpCollectionItem
```

所有社区积分消费必须先形成订单，再通过 wallet ledger 扣款，最后发放
entitlement。任何服务都不能直接改余额或直接把内容标记为已购买。

## 内容模型

### `ips`

公开 IP 聚合根。只保存业务事实、发布事实和治理事实：IP 类型、封面、
trailer、AI 生成声明、版权摘要、发布状态、来源语言等。
标题、简介、slug、SEO 文案、分类和标签不放在主表里，统一进入 localization 表。

重要字段：

- `ip_type`：运营筛选和创建入口分类。当前只保留 `series`、`film_short`、
  `other`。它不会切换编辑器能力，也不会改变发布流程。
- `source_locale`：源文案语言，用于翻译、fallback 和审核基准。
- `status`：draft / review / published / suspended 等发布状态。
- `listing_visibility`：private / unlisted / public。

### `ip_localizations`

IP 的公开展示文案。每个 `ip_id + locale` 唯一，包含：

- `slug`：locale 维度的 SEO slug；发布态唯一由 partial unique index 保证。
- `title` / `subtitle` / `summary` / `description`：公开文案。
- `genres` / `tags`：该语言下的展示分类和标签。
- `seo_title` / `seo_description`：搜索和分享专用文案。
- `status`：draft / machine_translated / needs_review / approved /
  published / outdated / archived。

公开接口只读取 `published` localization；后台可以看到草稿、机器翻译稿和
待审核稿。机器翻译只能生成草稿或待审核稿，不能直接发布。

### `ip_episodes`

IP 下的剧集。只保存集数、排序、媒体、时长、试看、发布状态等事实。
剧集名称、简介和描述放在 `ip_episode_localizations`。

### `ip_assets`

IP 级素材库。它把上传到 `media_assets` 的文件绑定回具体 IP，并标记用途：

- `source_material`：剧本、提案、大纲、参考图、音频、视频等源材料。
- `reference_art`：后续可用于设定图、风格参考和资料包。
- `production_asset`：后续可用于成片素材、交付物或宣发资产。

当前创作者端已经支持上传、查看、打开和移除 `source_material`；admin 详情
可以看到源材料列表。封面和预告仍然保存在 `ips.cover_asset_id` /
`ips.trailer_asset_id`，因为它们是公开详情和列表展示的固定槽位。

### `ip_campaign_localizations`

活动 / 预售的名称和说明也必须 locale 化。活动本体只保存时间窗口、code、
状态和 tracking config。

## 多语言和翻译工作流

多语言不是实时翻译缓存，也不是通用 JSON 字段。产品级做法是：

1. 主表保存事实，localization 表保存可展示文案。
2. 公开 API 接收 `locale`，按 requested locale -> 基础语言 -> source
   locale -> 默认 locale 逐级 fallback。
3. `IpTranslationJob` 记录机器翻译任务、provider、input hash、幂等键、
   目标对象和状态。
4. 翻译结果只写入对应 localization 表，并标记为 `machine_translated`
   或 `needs_review`。
5. 后台审核通过后才能改为 `published`；公开站点只展示 `published`。

未来剧组、用户服务、创作者档案等其他模块如果需要多语言，应各自建立强类型
localization 表，例如 `CrewLocalization`、`CreatorServiceLocalization`。
不要复用一张 `LocalizedText(target_type, target_id, field_key)`，因为它会
丢失外键约束、唯一索引、SEO slug 约束、审核状态和查询性能。

## 定价和预售

### `ip_campaigns`

IP 价格活动，例如 `presale`、`early_bird`、`limited_time_discount`、
`launch`、`event`。活动只配置起止时间、解锁时间、code 和 tracking
config；展示名称和描述进入 `ip_campaign_localizations`。引荐不属于
campaign，由 `ip_referral_links` / `ip_referral_attributions` 独立表达。

### `ip_price_rules`

价格规则。当前 target 支持：

- `ip`：整 IP 打包价。
- `episode`：单集价。

价格使用 `WalletCurrencyType`，当前主要是 `community_point`。国际站和中国站
使用不同数据库，不在同一张业务表里混放不同站点的价格或活动。

价格规则不是单纯展示字段，已经支持产品级活动价需要的核心属性：

- `amount`：实际扣除金额。
- `original_amount`：划线价 / 原价，用于早鸟价、活动价展示。
- `starts_at` / `ends_at`：价格生效窗口。
- `max_per_user`：单用户限购。

创作者端定价面板必须写这些标准价格规则；购买时按有效规则生成订单快照，
不能在前端临时计算活动价。

## 购买和权益

### `ip_purchase_orders`

内容购买订单。它不是外部支付订单；社区积分消费仍然需要订单来保证：

- 幂等提交。
- 可追踪价格快照。
- 可退款。
- 可关联引荐。

### `ip_content_entitlements`

购买后的访问权益。访问控制只看 entitlement，不看订单状态或价格规则。
当前新版 IP 只支持用户权益，不绑定 workspace。未来如果要支持团队购买，
需要先补齐团队权限、席位、成员继承、退款和转让规则，再以独立设计回归。

### `ip_collection_items`

用户收藏夹和已购内容入口。购买后可以自动加入收藏，后续可记录播放进度。

## 创作者收益和引荐

### `ip_contributors`

IP 公开贡献者列表。它不等于 workspace members。可以是平台用户，也可以
是仅展示名称的外部贡献者。

### `ip_referral_links` / `ip_referral_attributions`

每个内容可以生成引荐链接。当前只记录访问和订单归因，不计算佣金、不入账收益。
未来如果要做分销或佣金，需要先补齐规则配置、结算、提现、对账和审核闭环。

## 审核、版权和风控

### `ip_review_submissions` / `ip_review_events`

审核提交记录和事件流。审核对象支持 ip、episode、price_rule、
campaign。审核时保存 snapshot，避免运营审核通过后内容被悄悄修改。

提交审核前，创作者端和服务端都必须校验同一套发布前置条件：标题、短简介、
封面或预告、版权主体、权利说明，以及使用 AI 生成素材时的 AI 披露说明。
admin 发布动作再次执行同样校验，保证绕过 UI 的 API 调用不能进入半成品发布链路。

### `ip_rights_declarations`

版权和 AI 生成声明。支持 ip / episode 粒度，记录来源、授权说明、
AI 生成声明和审核结果。

### `ip_content_reports`

用户举报入口。举报不会直接改内容状态，需要后台或系统产生
`ip_moderation_actions`。

### `ip_moderation_actions`

平台风控动作，包括 hide、suspend_sales、takedown、region_block、
age_gate、restore 等。

### `ip_user_content_blocks`

用户级屏蔽 / 不感兴趣。它只影响该用户自己的推荐和展示，不等于平台下架。

## 未来方向记录

以下能力是产品方向，不是当前已落地的 schema：

- 故事圣经：世界观规则、故事前提、视觉基调、受众看点、核心主题。
- 角色和世界元素库：角色、地点、阵营、道具、规则、关键事件。
- 互动剧情结构：剧情节点、分支选择、结局、可复用桥段。
- 聊天室 / 角色扮演：角色对话、会话记忆、用户选择和安全治理。
- 游戏化体验：场景、任务、物品、状态和互动规则。
- 混合内容单元：普通视频、交互视频、交互文本、小说章节、音频可以在同一
  个 IP 下混排。真正启动前，应先为 `IpEpisode` 或未来的 `IpContentUnit`
  设计明确的 `format`，再补对应内容形态的编辑器和播放器。
- 媒体字幕轨：字幕、caption、配音脚本、transcript、SRT / VTT 文件需要在
  上传、审核、播放器加载、多语言 fallback 都闭环后，再以 `IpMediaTextTrack`
  或独立媒体轨模型回归。
- 创作者收益分账：制作费、销售分润、引荐佣金、平台服务费和手工调整必须
  同时具备配置 UI、合同/确认快照、订单履约、钱包入账、冲正、提现、对账和
  审计后，才能恢复 `IpRevenueRule` / `IpRevenueLedgerEntry` 这类表。
- 投资 / 合作 Pitch：面向投资人、品牌方、联合出品方的资料包、私密预览页、
  表达兴趣表单、后台线索跟进和合规提示。没有完整线索表和跟进 UI 前，不建
  `IpFundraisingCampaign` 这类孤立表。
- Hero / 展示位系统：如果未来详情页需要独立主视觉，应以
  `IpAssetPlacement` / `IpFeaturedAsset` 这类展示位模型回归，而不是在
  `ips` 根表里提前保留 `hero_asset_id`。

重新启动这些能力前，需要同时补齐：

1. 创作者编辑器和版本管理。
2. 公开详情页展示方式。
3. 审核、版权、举报、下架和审计链路。
4. 多语言 localization 设计。
5. 与剧集、素材、定价和权益的明确关系。
6. 如果涉及投资 / 合作，必须补齐线索表、跟进状态、隐私同意和合规话术。
7. 如果涉及收益分账，必须补齐结算、提现、冲正、对账和审计链路。

没有这些闭环前，不把相关字段塞回 `ips`，也不恢复半成品表。

## 数据录入策略

IP 商业化模块不建旧系统兼容层。目标库只保存产品定义后的标准结构：

1. 后台或专门的发布流程直接创建 `Ip` / `IpEpisode` / `IpPriceRule` 等标准表。
2. 新购买、新权益、新价格、新审核全部走 Nest + Postgres。
3. 批量导入如果未来成为产品需求，应按 CSV / 管理台任务单独设计，不把
   旧来源 ID 或旧接口映射写进核心 schema。

这个设计保证核心表不会出现旧项目 ID、`priceType`、`targetId`
这类旧系统概念，也不会为任何旧系统保留专用映射表。

## 不做的事

- 不让 IP 核心表依赖内部项目字段。
- 不把故事圣经、角色库或互动节点作为当前 schema 的半成品能力。
- 不保留没有上传、审核和播放器加载闭环的 `IpMediaTextTrack`。
- 不保留没有配置、结算、提现和对账闭环的收益分账表。
- 不保留没有上传入口、展示依赖和发布检查的 `hero_asset_id`。
- 不保留没有线索收集、跟进和合规闭环的投资 / 募资活动表。
- 不把社区积分消费塞进 `BillingOrder`。
- 不把已购状态写到 IP 或 episode 行上。
- 不让前端理解旧价格接口的 `priceType` / `targetId` 设计。
