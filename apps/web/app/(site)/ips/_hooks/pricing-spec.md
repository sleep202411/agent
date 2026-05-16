# IP 定价接口规范 —— 阶段一（创作者侧配置）

状态：后端实施草案
归属：前端（Isaac）
最后更新：2026-05-15

---

## 目标与范围

让创作者在 `/ips/[id]/edit` → Pricing tab 配置 IP 定价（默认单集价 /
免费集 / 单集差异化价 / 整 IP 套餐价），持久化到后端。

**阶段一只交付创作者侧的配置 CRUD**（含与现有接口的引用约定）。
阶段二再做用户购买、访问校验、播放权 gate。

---

## 已锁定的产品决策

1. **货币单位**：社区积分（见 `community-credits-spec.md`）。消费扣
   `spendable` 子账户；创作者收入入 `withdrawable` 子账户
2. **售卖粒度**：单集 OR 整 IP 套餐（bundle）；不做"多集打包"中间档
3. **持有期限**：永久；不过期
4. **整套 (bundle) 覆盖范围**：现有集 + 之后新增集
5. **免费集**：由创作者自由勾选（稀疏列表，`[1, 3, 5]` 合法）
6. **改价**：随时可改；已购用户不受影响；降价不退差价
7. **退款**：不支持

---

## 数据模型

```ts
type IPPricing = {
  ipId: number;
  defaultEpisodePrice: number; // 默认单集价（积分），≥ 0
  bundlePrice: number | null; // 整套 (bundle) 价（积分），≥ 0；null = 不卖整套
  freeEpisodeIds: number[]; // 免费集 id 稀疏列表，可为空
  episodeOverrides: Array<{
    // 单集 override；不在此列表的集走 defaultEpisodePrice
    episodeId: number;
    price: number; // 积分，≥ 0
  }>;
  updateTime: string | null; // ISO 8601；服务端写入；从未保存过为 null
};
```

### 访问判定规则

对一集 E：

1. `E.id ∈ freeEpisodeIds` → **免费**
2. `E.id` 有 override 且 `price === 0` → **免费**
3. `E.id` 无 override 且 `defaultEpisodePrice === 0` → **免费**
4. 否则 → **付费**，价格 = override.price（若存在）else
   `defaultEpisodePrice`

`bundlePrice === null` 表示该 IP 不卖整套，用户侧的"购买整套 (bundle)"
按钮隐藏；用户只能买单集。

---

## 前端调用时序

```
[1] 用户进入 /ips/[id]/edit
      │
      ├─ GET  /project/query?id={ipId}                现有，获取 IP 详情 + ownerId
      │     用途：1) 鉴权（非 owner 跳走 / 只读）
      │           2) 在 Pricing tab 显示 IP 名称
      │
      └─ POST /vedio/video/list { projectId: ipId }   现有，获取剧集列表
            用途：填充 FreePreviewCard 的勾选框
                  + EpisodeOverridesList 的单集行
                  episodeId 来源 = 这里返回的 video.id

[2] 用户切到 Pricing tab
      │
      └─ GET /project/pricing/{ipId}                  新，获取定价配置
                                                     (首次进入返回默认形状)

[3] 用户编辑（纯前端 draft，无后端调用）

[4] 用户点 Save
      │
      └─ POST /project/pricing/save                   新，整体替换配置
                                                     成功后前端 setQueryData 写回缓存

[5] Save 成功，UI toast "保存成功"
```

涉及接口共 4 个：**新增 2 个 + 引用现有 2 个**。

---

## 接口 1（新）：保存定价配置

```
POST /project/pricing/save
```

**鉴权**：必须登录，且是所有者

**请求体**

```jsonc
{
  // 目标 IP 的 id（即 project_id）
  "ipId": 12345,

  // 默认单集价（积分）。所有"既不在免费列表、也没有 override"的剧集
  // 解锁都按这个价收。0 表示"默认免费"。
  "defaultEpisodePrice": 10,

  // 整套 (bundle) 价（积分）。用户买一次永久解锁全部现有 + 未来剧集。
  // null 表示不卖整套（用户侧"购买整套"按钮隐藏，用户只能买单集）。
  "bundlePrice": 200,

  // 免费集 id 稀疏列表 —— 创作者自由勾选，可以是 [1, 3, 5] 这种跳跃，
  // 不需要连续；不需要有序。空数组表示无免费集。
  // 每个 id 必须是该 IP 下真实存在的剧集 id（vedio.id 且
  // vedio.project_id = ipId），否则返 400。
  "freeEpisodeIds": [101, 103],

  // 单集差异化定价。仅在某一集要跟 defaultEpisodePrice 不同时才出现。
  // 不在此列表的剧集自动走 defaultEpisodePrice。
  // 约束：同一个 episodeId 不能重复出现；price >= 0；episodeId
  // 必须属于本 IP。
  "episodeOverrides": [
    { "episodeId": 110, "price": 15 }, // 第 110 集单独卖 15 积分
  ],
}
```

### 字段语义速查

| 字段                           | 类型               | 必填 | 说明                                            |
| ------------------------------ | ------------------ | ---- | ----------------------------------------------- |
| `ipId`                         | number             | ✅   | 目标 IP（project_id）                           |
| `defaultEpisodePrice`          | number ≥ 0         | ✅   | 默认单集价，单位积分；0 = 默认免费              |
| `bundlePrice`                  | number ≥ 0 \| null | ✅   | 整套 (bundle) 价；null = 不卖整套               |
| `freeEpisodeIds`               | number[]           | ✅   | 免费集 id 列表；可空数组；id 必须属于本 IP      |
| `episodeOverrides`             | object[]           | ✅   | 单集差异化价；可空数组；episodeId 必须属于本 IP |
| `episodeOverrides[].episodeId` | number             | ✅   | 单集 id（vedio.id）                             |
| `episodeOverrides[].price`     | number ≥ 0         | ✅   | 该集解锁价（积分）                              |

**响应**

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "ipId": 12345,
    "defaultEpisodePrice": 10,
    "bundlePrice": 200,
    "freeEpisodeIds": [101, 103],
    "episodeOverrides": [{ "episodeId": 110, "price": 15 }],
    "updateTime": "2026-05-15T10:30:00Z"
  }
}
```

## 接口 2（新）：读取定价配置

```
GET /project/pricing/{ipId}
```

**鉴权**：无需登录。公开读 。

**响应**：

**该 IP 从未保存过配置**（即免费 IP）：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "ipId": 12345,
    "defaultEpisodePrice": 0,
    "bundlePrice": null,
    "freeEpisodeIds": [],
    "episodeOverrides": [],
    "updateTime": null
  }
}
```

**返回默认形状的对象，不要 404**。前端可以永远假设有 config。

### 下架剧集处理

剧集**不允许硬删**，仅支持下架（soft delete —— DB 行保留 + 标记
不可见）。配置里的某个 `episodeId` 对应的剧集被下架时：

- **GET 时静默过滤**掉已下架的 id（创作者编辑页只展示在线集）
- DB 里的 vedio 行保留（已购用户的 Purchase 仍要能引用回来）
- 下次 save 时由前端按当前在线 episode 列表决定 draft 内容；若创作者
  之后恢复该集上架，pricing 中已抹掉的引用**不会自动恢复**，需重新配置

---

## 错误码

**HTTP 状态码一律 `200`**（与平台其他 Java 接口一致）。前端拦截器
完全基于响应体的 `code` 字段分发成功 / 失败逻辑，**不读 HTTP status**。

| code | 触发场景            | msg             | data             |
| ---- | ------------------- | --------------- | ---------------- |
| 200  | 成功                | "成功"          | 业务数据         |
| 400  | 参数校验失败        | "参数错误"      | 见下方字段级反馈 |
| 401  | save 未登录         | "未登录"        | null             |
| 403  | save 非所有者       | "无权操作此 IP" | null             |
| 404  | save 时 ipId 不存在 | "IP 不存在"     | null             |
| 500  | 服务端异常          | "服务器错误"    | null             |

**GET 接口对不存在的 ipId 不返 404**，依然返默认形状对象（保持前端简单）。

### 400 字段级反馈格式

```json
{
  "code": 400,
  "msg": "参数错误",
  "data": {
    "field": "episodeOverrides[0].price",
    "reason": "必须 >= 0"
  }
}
```

每次只返第一个错误即可；前端按 `field` 定位 UI。

---

## 服务端校验规则

- `defaultEpisodePrice >= 0`，整数
- `bundlePrice === null` 或 `>= 0` 整数
- 所有 `episodeOverrides[].price >= 0`，整数
- 所有 `episodeOverrides[].episodeId` 必须属于当前 `ipId`（即
  `vedio.project_id = ipId`）
- 所有 `freeEpisodeIds` 中的 id 必须属于当前 `ipId`
- `episodeOverrides[].episodeId` 在数组内不重复
- `freeEpisodeIds` 内不重复

前端在表单提交时也会校验，但服务端是信任边界 —— 客户端可被绕过。

---

## 建表建议

每个 IP 一行（`ip_id` 主键）：

```sql
CREATE TABLE ip_pricing (
  ip_id            BIGINT       PRIMARY KEY,
  default_price    INT          NOT NULL DEFAULT 0,
  bundle_price     INT          NULL,
  free_episodes    JSON         NOT NULL DEFAULT '[]',
  overrides        JSON         NOT NULL DEFAULT '[]',
  update_time      DATETIME     NOT NULL
);
```

`free_episodes` / `overrides` 用 JSON 字段即可，MVP 量级（单 IP ≤
200 集，平台 ≤ 1 万 IP）够用。要拆独立表也可以，看你方便。

---

## 引用现有接口（无需新开发）

下面 2 个接口前端会调用，**保持现状即可**，spec 仅做引用约定：

### `GET /project/query`

- 用途：返回 IP 详情。前端用 `ownerId` 判断当前用户是不是所有者，
  是的话才允许 Pricing tab 进入编辑模式。

### `POST /vedio/video/list`

- 用途：按 `projectId` 返回剧集列表。前端从返回的 `video.id`
  生成 `freeEpisodeIds` 候选 + `episodeOverrides` 行。

---

## 前端缓存策略（前端实现细节，后端无关）

- React Query `staleTime: 60_000`（创作者编辑 + 用户读共用一份
  缓存 key）
- Save 成功后立即 `setQueryData` 写回缓存（响应体），不再 refetch

---

## 阶段二（用户购买 + 访问控制）

阶段二在阶段一之上加 4 个接口，让用户能真正买、能拿到访问权、
播放接口能 gate 无权用户。

### 阶段二额外锁定的产品决策

- **货币**：扣**社区积分**（见 `community-credits-spec.md`）。阶段二
  上线前社区积分钱包必须就位。买家从 `spendable` 扣减，创作者收入
  入 `withdrawable`，**两个子账户不互通**。
- **平台分成**：**20%**（创作者拿 80%）
- **重复购买**：幂等，返 200 + 原 Purchase 记录，不重复扣分
- **整套 (bundle) 覆盖**：买整套后单集自动 access；后续新增集自动覆盖
- **撤销 / 取消** 不支持。一旦写记录，访问权永久
- **创作者不可购买自己的 IP**：服务端识别 `buyer.userId === ip.ownerId`
  时直接返 400，防止自买套现（spendable → 80% 回到自己 withdrawable
  实质是变相换钱包子账户）
- **下架剧集 + 已购用户**：剧集下架后，已购买家**永久保留访问权**。
  Purchase 记录稳定，access / play 接口对"已购但已下架"的集照常放行；
  未购用户在 IP 详情页看不到该集（被 video list 过滤）

### 数据模型扩展

```ts
type Purchase = {
  id: number;
  userId: number;
  ipId: number;
  type: "episode" | "bundle";
  episodeId: number | null; // null when type === "bundle"
  pricePaid: number; // 实际扣分（购买瞬间快照）
  creatorEarning: number; // 创作者拿到的部分（pricePaid × 0.8）
  platformCut: number; // 平台抽走的部分（pricePaid × 0.2）
  createTime: string; // ISO 8601
};

type AccessSummary = {
  ipId: number;
  ownsBundle: boolean; // 是否买了整套 (bundle)
  ownedEpisodeIds: number[]; // 单集购买的 id 列表（不含被整套覆盖的）
};

// 我的已购列表的展示用 ViewModel（不是原始 Purchase 行）
// 后端 join project + vedio 表填充展示字段，前端拿来直接渲染。
// creatorEarning / platformCut 是内部分账字段，**不**返给买家。
type PurchaseListItem = {
  id: number; // = Purchase.id
  ipId: number;
  ipName: string;
  ipCover: string | null;
  type: "episode" | "bundle";
  episodeId: number | null; // null when type === "bundle"
  episodeTitle: string | null; // null when type === "bundle"
  pricePaid: number; // 积分快照
  createTime: string; // ISO 8601
};
```

### 接口 3（新）：购买

```
POST /project/pricing/purchase
```

**鉴权**：必须登录。

**请求体**（JSONC 注释）：

```jsonc
{
  // 目标 IP
  "ipId": 12345,
  // 购买类型：单集 OR 整套 (bundle)
  "type": "episode", // "episode" | "bundle"
  // type=episode 必填；type=bundle 强制传 null（不允许 omit，保持 JSON 形状稳定）
  "episodeId": 110,
}
```

**响应**（成功）：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "purchase": {
      "id": 99001,
      "userId": 7,
      "ipId": 12345,
      "type": "episode",
      "episodeId": 110,
      "pricePaid": 10,
      "creatorEarning": 8,
      "platformCut": 2,
      "createTime": "2026-05-15T11:00:00Z"
    },
    "newBalance": 90
  }
}
```

**幂等**：同 user 重复购买同一目标 → 返 200 + 同一 Purchase 记录 +
`newBalance` 不变（未实际扣分）。前端可据此重试。

**业务约束**：

- 价格读取**服务端定价配置当前值**，不信客户端传值（防伪造）
- 价格变动不影响已购 Purchase 记录（snapshot 在 `pricePaid`）
- 单事务内完成下列**五个**写操作（任一失败全部回滚）：
  1. `buyer.community_balance.spendable -= pricePaid`
  2. 写 `Purchase` 行（含 creatorEarning, platformCut）
  3. `creator.community_balance.withdrawable += creatorEarning`
  4. 写一条 `CommunityRecord`（buyer 视角）：
     `type=consume, subAccount=spendable, relatedPurchaseId=Purchase.id`
  5. 写一条 `CommunityRecord`（creator 视角）：
     `type=earning, subAccount=withdrawable, relatedPurchaseId=Purchase.id`

  详见 `community-credits-spec.md` 的"创作者收入入账逻辑"段。
  `platformCut` 走平台账户独立记账，**不**写入用户的 community_record。

### 接口 4（新）：访问汇总

```
GET /project/pricing/access/{ipId}
```

**鉴权**：可选。**未登录**用户也接收，返 `ownsBundle=false,
ownedEpisodeIds=[]`。

`ownedEpisodeIds` 来自 Purchase 表稳定查询，**包含已下架剧集的 id**
（已购访问权永久保留）。前端只在用户能从入口（IP 详情页 / 我的购买
列表）触达该 id 时使用。

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "ipId": 12345,
    "ownsBundle": false,
    "ownedEpisodeIds": [110, 112]
  }
}
```

### 接口 5（新）：我的已购列表

```
GET /project/pricing/purchase/list?page=1&pageSize=20
```

**鉴权**：必须登录。返回当前用户跨所有 IP 的购买历史，按 `createTime`
倒序。用于"个人中心 → 我的购买"账单页。

**list 项**：`PurchaseListItem`（见上方数据模型）。后端 join project +
vedio 表填充 `ipName` / `ipCover` / `episodeTitle`，前端拿来直接渲染。

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "list": [
      {
        "id": 99001,
        "ipId": 12345,
        "ipName": "我的剧本",
        "ipCover": "https://cdn.../cover.jpg",
        "type": "episode",
        "episodeId": 110,
        "episodeTitle": "第 2 集 · 雨夜",
        "pricePaid": 10,
        "createTime": "2026-05-15T10:23:00Z"
      },
      {
        "id": 99000,
        "ipId": 67890,
        "ipName": "大侦探",
        "ipCover": "https://cdn.../cover2.jpg",
        "type": "bundle",
        "episodeId": null,
        "episodeTitle": null,
        "pricePaid": 200,
        "createTime": "2026-05-14T18:01:00Z"
      }
    ],
    "total": 42,
    "currentPage": 1,
    "pageSize": 20
  }
}
```

**下架引用**：IP / 剧集允许被下架但**不允许硬删**，所以 join 始终
能拿到 `ipName` / `episodeTitle`。点击 list 项跳 play 时，由 play
接口的"已购放行"规则保证可看（详见接口 6）。

### 接口 6（改造）：播放权 gate

```
POST /vedio/play/getLink
```

**改造点**：现有接口接收 `id` (episodeId)，本次新增访问校验：

- IP owner → 直接放行
- 该集免费（按定价规则解析）→ 直接放行
- 用户买过单集 → 放行（**含该集已下架的情况**，已购访问权永久保留）
- 用户买过整套 → 放行（**含已下架集**）
- 集已下架 + 用户未购 → 返 **404**（"内容不存在"，不暴露下架细节）
- 否则 → 返 **403** + 引导付费墙的元数据：

```json
{
  "code": 403,
  "msg": "未购买此集",
  "data": {
    "requirePurchase": true,
    "episodePrice": 10,
    "isBundleAvailable": true,
    "bundlePrice": 200
  }
}
```

前端拦截 `code === 403` → 弹付费墙 confirm dialog。

### 错误码（阶段二新增）

沿用阶段一约定：**HTTP 一律 200，前端只读 body `code`**。

| code | 触发场景                                    | data 携带                             |
| ---- | ------------------------------------------- | ------------------------------------- |
| 400  | `type=episode` 但缺 `episodeId`             | `{ field: "episodeId" }`              |
| 400  | owner 购买自己的 IP                         | `{ reason: "owner_cannot_purchase" }` |
| 401  | purchase 未登录                             | null                                  |
| 402  | 余额不足（buyer.spendable < pricePaid）     | `{ required, current }`               |
| 403  | play/getLink 未购                           | 见上方 paywall 元数据                 |
| 404  | ipId / episodeId 不存在                     | null                                  |
| 410  | 价格为 0 时尝试购买（不需要付费）           | `{ resolvedPrice: 0 }`                |
| 423  | `bundlePrice === null` 时尝试 `type=bundle` | null（整套未开放）                    |

### 阶段二测试用例

| #   | 前置                                 | 操作                      | 期望                                          |
| --- | ------------------------------------ | ------------------------- | --------------------------------------------- |
| 13  | 余额 50，单集价 10                   | POST purchase episode 110 | 200，扣 10，newBalance=40，creatorEarning=8   |
| 14  | 已经买过单集 110                     | POST purchase episode 110 | 200，幂等，原 Purchase，newBalance 不变       |
| 15  | 余额 5，单集价 10                    | POST purchase episode 110 | 402，`data.required=10, data.current=5`       |
| 16  | 整套未开放（`bundlePrice === null`） | POST purchase bundle      | 423                                           |
| 17  | 集为免费集                           | POST purchase episode     | 410                                           |
| 18  | 已购单集 110，请求该集播放           | POST /vedio/play/getLink  | 200，正常拿 url                               |
| 19  | 未购买，请求付费集播放               | POST /vedio/play/getLink  | 403，data 含引导元数据                        |
| 20  | 已购整套，请求该 IP 任意付费集       | POST /vedio/play/getLink  | 200，包括之后新增的集                         |
| 21  | 创作者本人，请求自己 IP 的付费集     | POST /vedio/play/getLink  | 200，owner 绕过                               |
| 22  | 价格刚被创作者改了，购买请求带旧价   | POST purchase             | 200，按服务端**当前价**扣（客户端传值不可信） |
| 23  | owner 调 purchase 买自己的 IP        | POST purchase             | 400, `data.reason="owner_cannot_purchase"`    |
| 24  | 已购单集 110，该集已下架             | POST /vedio/play/getLink  | 200，已购访问权保留                           |
| 25  | 未购，该集已下架                     | POST /vedio/play/getLink  | 404，不暴露下架细节                           |
| 26  | 已购单集 110，该集已下架             | GET access                | 200，ownedEpisodeIds 仍含 110                 |

---

## 后端必须通过的测试用例

| #   | 前置                                                  | 操作            | 期望                                                |
| --- | ----------------------------------------------------- | --------------- | --------------------------------------------------- |
| 1   | 未登录用户                                            | GET 已有配置    | 200，返回完整 config                                |
| 2   | 未登录用户                                            | GET 不存在 ipId | 200，返回默认形状 config                            |
| 3   | 未登录用户                                            | POST save       | 401                                                 |
| 4   | 登录但非所有者                                        | POST save       | 403                                                 |
| 5   | 所有者，首次保存                                      | POST save       | 200，行已插入                                       |
| 6   | 所有者，二次保存字段不同                              | POST save       | 200，行整体替换（旧字段消失）                       |
| 7   | 所有者，`defaultEpisodePrice: -1`                     | POST save       | 400，`data.field` 指向 `defaultEpisodePrice`        |
| 8   | 所有者，`freeEpisodeIds: [99999]`（不属于本 IP）      | POST save       | 400                                                 |
| 9   | 所有者，`episodeOverrides: [{episodeId:X, price:-5}]` | POST save       | 400                                                 |
| 10  | 配置里有 episodeId=110，之后剧集 110 被删             | GET             | 200，返回的 freeEpisodeIds / overrides 已过滤掉 110 |
| 11  | 所有者，save 全 0 / null / 空数组                     | POST save       | 200，配置等同于"无定价"                             |
| 12  | 两个 tab 几乎同时 save 不同内容                       | POST save × 2   | 两次都 200，后到的覆盖前到的（LWW）                 |

---
