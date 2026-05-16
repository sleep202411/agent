# 社区积分钱包接口规范

关联：与 `pricing-spec.md` 阶段二搭配上线 —— 付费墙扣的就是这套积分

---

## 目标

为平台构建一个独立的"社区积分"经济系统，跟 Studio 积分（AI 推理
费用）完全分离。社区积分用于：

1. **用户消费**：解锁付费 IP / 单集
2. **创作者收入**：作品被购买 → 自动入账"待提现"余额
3. **跨用户流通**：将来可能支持转赠、礼物、活动奖励等

钱包系统是 Pricing 阶段二的前置依赖：阶段二上线前本规范必须就位。

---

## 已锁定的产品决策

1. **货币本身**：跟 Studio 积分（`scoreBalance`）**完全独立的钱包**，
   不互转、不混计
2. **充值锚定**：**预设套餐表**，按用户币种独立定价。**不**做汇率
   实时换算 / 自由金额充值。每个套餐固定 `(currency, fiatPrice, credits)`
   三元组。MVP 三种币种：`CNY` / `USD` / `EUR`
3. **积分↔法币 内部参考价**（提现折算 + UI 展示用）：
   - **1000 积分 = ¥100 CNY = $10 USD = €10 EUR**
   - 即 1 积分 = 0.1 元 / 1 美分 / 1 欧分
   - 该比率写在后端配置，改动需发版，不走 DB 表
4. **钱包内部结构**：每用户两个子余额
   - `spendable` 可消费余额（充值进来，付费墙扣这里）
   - `withdrawable` 可提现余额（创作者收入入这里，可申请提现）
5. **新用户初始余额**：spendable = 0, withdrawable = 0
6. **赠送 / 转赠**：MVP 不做。一律走充值 + 消费两条路
7. **提现门槛**：≥ **1000 积分**（积分单位，跨币种一致）。UI 按用户
   币种折算展示（≈ ¥100 / $10 / €10）
8. **支付通道**：
   - 充值：`CNY` → `alipay` / `wechat_pay`；`USD` / `EUR` → `stripe`
     （后续扩 `paypal`）
   - 提现（MVP）：`CNY` → `alipay`；`USD` / `EUR` → `paypal`
9. **KYC**：首次提现时强制实名验证
10. **退款**：不支持
11. **跨子余额互转**：**不允许**。`withdrawable` 不能用于消费、
    `spendable` 不能用于提现。防止洗钱嫌疑 + 收支账本清晰

---

## 金额单位约定

- **积分**：整数，无小数。所有 `credits` / `amount` 字段
- **法币**：整数，**最小单位**（CNY 分 / USD 美分 / EUR 欧分）。
  所有 `fiatPrice` / `fiatAmount` 字段
  - 例：`fiatPrice: 10000` 当 currency=CNY 表示 ¥100.00；
    当 currency=USD 表示 $100.00
- **不使用浮点数**。前端展示时除以 100 取两位小数

---

## 数据模型

```ts
type Currency = "CNY" | "USD" | "EUR"; // MVP 三种

type PayChannel = "alipay" | "wechat_pay" | "stripe"; // 后续可扩 paypal

type PayoutChannel = "alipay" | "paypal"; // MVP 二选一

type CommunityBalance = {
  userId: number;
  spendable: number; // 可消费余额（积分）
  withdrawable: number; // 可提现余额（积分）
  updateTime: string;
};

type CommunityRecord = {
  id: number;
  userId: number;
  type:
    | "recharge" // +spendable（充值入账）
    | "consume" // -spendable（付费墙扣）
    | "earning" // +withdrawable（创作者收入）
    | "withdraw" // -withdrawable（提现申请扣减）
    | "refund_withdraw"; // +withdrawable（取消 / 拒绝时回滚）
  amount: number; // 正整数（积分）。方向看 type
  balanceAfter: number; // 该子余额变动后的快照
  subAccount: "spendable" | "withdrawable";
  // 关联订单（按 type 不同携带不同的引用；二者互斥）
  relatedOrderNo: string | null; // recharge / withdraw / refund_withdraw → order_no
  relatedPurchaseId: number | null; // consume / earning → Purchase id
  remark: string;
  createTime: string;
};

type RechargePackage = {
  id: string; // 'cny-md', 'usd-md' 等。全局唯一
  currency: Currency;
  fiatPrice: number; // 法币最小单位整数
  credits: number; // 充值后到账积分
  label: string; // 展示名："100 元充值包"
  badge: string | null; // 营销标签："限时" / "推荐" / null
  enabled: boolean;
  sortOrder: number; // 同币种内的展示顺序
};

type RechargeOrder = {
  orderNo: string;
  userId: number;
  packageId: string;
  currency: Currency;
  fiatPrice: number; // 复制自 package（防止 package 改价后历史错乱）
  credits: number; // 复制自 package
  payChannel: PayChannel;
  payUrl: string | null;
  status: "pending" | "paid" | "expired" | "failed";
  createTime: string;
  expireAt: string;
  paidTime: string | null;
};

type WithdrawOrder = {
  orderNo: string;
  userId: number;
  amountCredits: number;
  currency: Currency;
  fiatAmount: number; // 申请时按内部参考价锁定
  payoutChannel: PayoutChannel;
  payoutAccount: string; // 加密存储；查询时按通道规则 mask
  payoutMeta: Record<string, string> | null; // 通道特有字段（MVP 留 null）
  realName: string;
  status: "pending" | "approved" | "rejected" | "paid" | "cancelled";
  rejectReason: string | null;
  createTime: string;
  reviewTime: string | null;
  paidTime: string | null;
};
```

---

## 钱包接口

### 接口 1：余额查询

```
GET /community/balance
```

**鉴权**：必须登录。

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "userId": 7,
    "spendable": 90,
    "withdrawable": 320,
    "updateTime": "2026-05-15T11:00:00Z"
  }
}
```

未初始化的新用户也返完整对象（spendable=0, withdrawable=0），不要 404。

### 接口 2：账户流水

```
GET /community/records?page=1&pageSize=20&type={type}&subAccount={sub}
```

**鉴权**：必须登录。

**Query**：

- `page`, `pageSize`（必填）
- `type` 可选筛选：`recharge|consume|earning|withdraw|refund_withdraw|all`
- `subAccount` 可选筛选：`spendable|withdrawable|all`

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "list": [
      {
        /* CommunityRecord */
      }
    ],
    "total": 87,
    "currentPage": 1,
    "pageSize": 20
  }
}
```

按 `createTime` 倒序。

---

## 充值接口

### 接口 3：充值套餐列表

```
GET /community/recharge/packages?currency={currency}
```

**鉴权**：可选登录（游客也允许，方便展示）。

**Query**：`currency` 必填，`CNY` / `USD` / `EUR`。

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "packages": [
      {
        "id": "cny-sm",
        "currency": "CNY",
        "fiatPrice": 600,
        "credits": 60,
        "label": "新手包",
        "badge": "首充优惠",
        "enabled": true,
        "sortOrder": 1
      },
      {
        "id": "cny-md",
        "currency": "CNY",
        "fiatPrice": 10000,
        "credits": 1000,
        "label": "100 元充值包",
        "badge": "推荐",
        "enabled": true,
        "sortOrder": 2
      }
    ],
    "supportedChannels": ["alipay", "wechat_pay"]
  }
}
```

后端按 `currency` 决定 `supportedChannels`（CNY → alipay/wechat_pay，
USD/EUR → stripe）。USD/EUR 套餐示例：`{ id:'usd-md', fiatPrice:1000,
credits:1000 }` 即 $10 = 1000 积分。

### 接口 4：发起充值

```
POST /community/recharge
```

**鉴权**：必须登录。

**请求体**：

```jsonc
{
  "packageId": "cny-md",
  "payChannel": "alipay",
}
```

**校验**：

- `packageId` 必须存在且 `enabled=true`
- `payChannel` 必须在套餐 `currency` 对应的 `supportedChannels` 内

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "orderNo": "RCH20260515110000001",
    "packageId": "cny-md",
    "credits": 1000,
    "fiatPrice": 10000,
    "currency": "CNY",
    "payChannel": "alipay",
    "payUrl": "https://openapi.alipay.com/gateway.do?...",
    "expireAt": "2026-05-15T11:30:00Z"
  }
}
```

前端跳 `payUrl` 完成支付；支付完成后异步通过 webhook 回调入账。

### 接口 5：充值订单列表（找回未完成订单）

```
GET /community/recharge/list?status={status}&page=1&pageSize=20
```

**鉴权**：必须登录。

**Query**：

- `status` 可选：`pending|paid|expired|failed|all`，默认 `all`
- 分页参数必填

**响应**：标准分页结构，列表项为 `RechargeOrder`。按 `createTime` 倒序。

前端进充值页时先查 `status=pending`，若存在则提示"你有一笔进行中
的充值，是否继续支付？"，避免重复下单。

### 接口 6：支付回调（按通道分路）

```
POST /community/recharge/callback/alipay
POST /community/recharge/callback/wechat
POST /community/recharge/callback/stripe
```

**鉴权**：各通道签名校验（前端不直接消费）。

后端处理：

1. 验签（通道特有）
2. 查 RechargeOrder
3. 事务：`order.status = "paid"` + `balance.spendable += credits` +
   写 CommunityRecord（type=recharge, subAccount=spendable, relatedOrderNo=orderNo）
4. 幂等：同一 `orderNo` 多次回调只入账一次

### 接口 7：查充值订单（兜底轮询）

```
GET /community/recharge/order/{orderNo}
```

**鉴权**：必须登录，且 orderNo 必须属于当前用户。

**响应**：返回完整 `RechargeOrder` 对象。

用于支付完成后前端轮询确认到账（webhook 偶尔延迟）。

---

## 创作者收入 + 提现

### 接口 8：收入概览

```
GET /community/earnings
```

**鉴权**：必须登录。

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "withdrawable": 320,
    "lifetimeEarning": 580,
    "lifetimeWithdraw": 260,
    "pendingWithdrawAmount": 0,
    "canWithdraw": false,
    "minWithdraw": 1000,
    "kyc": {
      "status": "none",
      "realName": null,
      "rejectReason": null
    },
    "fiatPreview": {
      "currency": "CNY",
      "amount": 3200
    },
    "supportedPayoutChannels": ["alipay"]
  }
}
```

字段说明：

- `kyc.status`: `"none" | "pending" | "verified" | "rejected"`。
  前端依据它决定是否在申请提现前引导走 KYC 流程，**不需要单独查
  KYC 接口**
- `kyc.realName`: 仅 `verified` 时返回
- `fiatPreview`: 当前 `withdrawable` 按用户偏好币种折算的法币值
  （最小单位整数）。UI 用它显示 "≈¥32.00"
- `supportedPayoutChannels`: 当前用户币种允许的提现通道

### 接口 9：发起提现

```
POST /community/withdraw/apply
```

**鉴权**：必须登录 + `kyc.status === "verified"`（否则返 403）。

**请求体**：

```jsonc
{
  "amountCredits": 1000,
  "currency": "CNY",
  "payoutChannel": "alipay",
  "payoutAccount": "user@example.com",
  "payoutMeta": null,
  "realName": "张三",
}
```

**校验**：

- `amountCredits ≥ minWithdraw` 且 `≤ withdrawable`
- `currency` 必须在 `supportedPayoutChannels` 矩阵内允许
- `payoutChannel` 必须匹配 `currency`（CNY→alipay，USD/EUR→paypal）
- `realName` 必须与 KYC 实名一致（后端比对）

**响应**：

```json
{
  "code": 200,
  "msg": "成功，等待审核",
  "data": {
    "orderNo": "WDR20260515110000001",
    "amountCredits": 1000,
    "currency": "CNY",
    "fiatAmount": 10000,
    "payoutChannel": "alipay",
    "status": "pending",
    "createTime": "2026-05-15T11:00:00Z"
  }
}
```

**事务**：扣减 `withdrawable` + 写 WithdrawOrder（pending）+
写 CommunityRecord（type=withdraw, subAccount=withdrawable,
relatedOrderNo=orderNo）。

**幂等**：单用户同时只能有一笔 `pending` / `approved` 状态的提现单。
重复申请返 409。

### 接口 10：提现历史

```
GET /community/withdraw/list?page=1&pageSize=20
```

**鉴权**：必须登录。

**响应**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "list": [
      {
        /* WithdrawOrder, payoutAccount 已 mask */
      }
    ],
    "total": 5,
    "currentPage": 1,
    "pageSize": 20
  }
}
```

### 接口 11：取消提现申请

```
POST /community/withdraw/cancel/{orderNo}
```

**鉴权**：必须登录，订单必须属于当前用户。

**状态约束**：

| 当前 status | 允许 cancel | 返回                               |
| ----------- | ----------- | ---------------------------------- |
| pending     | ✓           | 200 + 退款到 withdrawable          |
| approved    | ✗           | 410 已审核                         |
| paid        | ✗           | 410 已打款                         |
| rejected    | ✗           | 410 已结束（被拒时金额已自动回滚） |
| cancelled   | ✗           | 410 已取消                         |

**响应（成功时）**：

```json
{
  "code": 200,
  "msg": "成功",
  "data": {
    "orderNo": "WDR20260515110000001",
    "status": "cancelled",
    "refundedTo": "withdrawable",
    "amount": 1000
  }
}
```

**事务**：`order.status = "cancelled"` + `balance.withdrawable += amountCredits` +
写 CommunityRecord（type=`refund_withdraw`, subAccount=withdrawable,
relatedOrderNo=orderNo）。

### 财务审核 webhook（后端内部）

人工审核通过 → 走支付宝 / PayPal 转账 API 实际打款 → 更新订单
`status = "paid"` + `paidTime`。失败：`status = "rejected"` +
`rejectReason` + 退还金额到 `withdrawable`（同样写 `refund_withdraw`
流水）。
此流程不暴露给前端，前端通过 `GET /community/withdraw/list` 看
最新状态即可。

---

## 创作者收入入账逻辑（后端内部约定）

跟 `pricing-spec.md` 阶段二的购买接口配合：

```
用户 A 购买 IP 的某一集 / 整套
  → 后端 POST /project/pricing/purchase 内部事务：
    1. 扣 A 的 spendable -= pricePaid
    2. 写 Purchase 记录（含 creatorEarning, platformCut）
    3. 创作者 B 的 withdrawable += creatorEarning
    4. 平台账户 += platformCut（独立记账）
    5. 写两条 CommunityRecord：
       - A 的 type=consume, subAccount=spendable, relatedPurchaseId
       - B 的 type=earning, subAccount=withdrawable, relatedPurchaseId
```

**关键约束**：所有金额变动在同一 DB 事务，不允许半成品状态。

---

## 支付账号 mask 规则

`payoutAccount` 入库加密，查询返回时按通道 mask：

| payoutChannel | 输入格式 | 输入示例           | mask 后展示         |
| ------------- | -------- | ------------------ | ------------------- |
| alipay        | 邮箱     | `user@example.com` | `u****@example.com` |
| alipay        | 手机号   | `13812345678`      | `138****5678`       |
| paypal        | 邮箱     | `user@example.com` | `u****@example.com` |

规则：邮箱保首字符 + `@` 后全部，中间 `****`；手机号保前 3 + 后 4，
中间 `****`。

---

## 错误码

**HTTP 状态码一律 `200`**（与平台其他 Java 接口一致）。前端拦截器
完全基于响应体的 `code` 字段分发成功 / 失败逻辑，**不读 HTTP status**。

错误响应示例：

```json
{
  "code": 402,
  "msg": "余额不足",
  "data": { "required": 50, "current": 10 }
}
```

| code | 触发场景                                                  | data 携带                         |
| ---- | --------------------------------------------------------- | --------------------------------- |
| 200  | 成功                                                      | 业务数据                          |
| 400  | 参数错（金额非整数 / 负 / 套餐不存在 / 通道与币种不匹配） | `{ field: "字段名" }`             |
| 401  | 未登录                                                    | null                              |
| 402  | 余额不足                                                  | `{ required, current }`           |
| 403  | 未完成 KYC 而申请提现 / 实名不一致 / 未授权               | `{ requireKyc: true }` 引导跳 KYC |
| 404  | 订单不存在                                                | null                              |
| 409  | 重复申请提现（已有 pending / approved）                   | `{ existingOrderNo }`             |
| 410  | 提现订单状态不可取消                                      | `{ currentStatus }`               |

---

## 数据库建表建议

```sql
CREATE TABLE community_balance (
  user_id        BIGINT PRIMARY KEY,
  spendable      BIGINT NOT NULL DEFAULT 0,
  withdrawable   BIGINT NOT NULL DEFAULT 0,
  update_time    DATETIME NOT NULL
);

CREATE TABLE community_record (
  id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id             BIGINT NOT NULL,
  type                VARCHAR(20) NOT NULL,
  amount              BIGINT NOT NULL,
  balance_after       BIGINT NOT NULL,
  sub_account         VARCHAR(16) NOT NULL,
  related_order_no    VARCHAR(32) NULL,
  related_purchase_id BIGINT NULL,
  remark              VARCHAR(255) NOT NULL,
  create_time         DATETIME NOT NULL,
  INDEX idx_user_create (user_id, create_time DESC)
);

CREATE TABLE recharge_package (
  id            VARCHAR(32) PRIMARY KEY,
  currency      VARCHAR(8) NOT NULL,
  fiat_price    BIGINT NOT NULL,       -- 最小单位
  credits       BIGINT NOT NULL,
  label         VARCHAR(64) NOT NULL,
  badge         VARCHAR(32) NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  enabled       TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_currency_enabled (currency, enabled, sort_order)
);

CREATE TABLE recharge_order (
  order_no        VARCHAR(32) PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  package_id      VARCHAR(32) NOT NULL,
  currency        VARCHAR(8) NOT NULL,
  fiat_price      BIGINT NOT NULL,     -- 复制自 package 当时的值
  credits         BIGINT NOT NULL,     -- 复制自 package 当时的值
  pay_channel     VARCHAR(16) NOT NULL,
  pay_url         TEXT,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  create_time     DATETIME NOT NULL,
  expire_time     DATETIME NOT NULL,
  paid_time       DATETIME NULL,
  INDEX idx_user_create (user_id, create_time DESC),
  INDEX idx_status_expire (status, expire_time)
);

CREATE TABLE withdraw_order (
  order_no        VARCHAR(32) PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  amount_credits  BIGINT NOT NULL,
  currency        VARCHAR(8) NOT NULL,
  fiat_amount     BIGINT NOT NULL,       -- 最小单位，申请时锁定
  payout_channel  VARCHAR(16) NOT NULL,
  payout_account  VARCHAR(255) NOT NULL, -- 加密存储
  payout_meta     JSON NULL,
  real_name       VARCHAR(64) NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  reject_reason   VARCHAR(255) NULL,
  create_time     DATETIME NOT NULL,
  review_time     DATETIME NULL,
  paid_time       DATETIME NULL,
  INDEX idx_user_create (user_id, create_time DESC),
  INDEX idx_status (status)
);
```

---

## 服务端校验规则

- 所有 amount / credits 字段必须是正整数；积分单位是积分，
  法币单位是最小单位整数
- `spendable / withdrawable` 操作必须走事务 + 行锁（`SELECT ... FOR UPDATE`），
  防止并发扣分穿透
- recharge / withdraw 订单号格式：`RCH{yyyyMMddHHmmss}{随机6位}` /
  `WDR{...}`。全局唯一
- 充值订单 `expire_time = create_time + 30 分钟`；过期未支付自动 `expired`
- 创建充值订单时**复制**套餐的 `fiat_price` / `credits` 到订单行，
  防止后续改套餐价污染历史
- `payChannel` × `currency` 校验矩阵在后端硬编码
- KYC 信息查询 / 比对走平台既有用户实名服务

---

## 前端使用规约

- 余额展示：每次写操作（充值入账 / 购买 / 提现申请 / 提现到账）
  后必须 invalidate balance + records + earnings 三个 query
- 充值流程：
  1. 进入充值页先 `GET /community/recharge/list?status=pending`，
     若有未完成订单提示用户继续支付
  2. `GET /community/recharge/packages?currency=...` 拉套餐
  3. 用户选套餐 + 通道 → `POST /community/recharge`
  4. 新窗口打开 `payUrl`
  5. 用户支付完成后，前端轮询 `GET /community/recharge/order/{orderNo}`，
     状态变 paid 时关闭轮询 + invalidate balance
  6. 超时（如 5 分钟）仍非 paid → 提示用户稍后再来
- 提现流程：
  1. `GET /community/earnings` 拿余额 + KYC 状态 + supportedPayoutChannels
  2. `withdrawable ≥ minWithdraw` 才显示提现入口
  3. 提交前若 `kyc.status !== "verified"`，引导跳 KYC 流程；
     KYC 完成后回流提现页
  4. 提交成功 → 跳提现列表页让用户看进度

---

## 后端必须通过的测试用例

| #   | 前置                                        | 操作                                                                 | 期望                                                                  |
| --- | ------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | 新用户（无 balance 记录）                   | GET /community/balance                                               | 200, spendable=0, withdrawable=0                                      |
| 2   | currency=CNY                                | GET /community/recharge/packages                                     | 200, packages 仅 CNY, supportedChannels=[alipay,wechat_pay]           |
| 3   | currency=USD                                | GET /community/recharge/packages                                     | 200, packages 仅 USD, supportedChannels=[stripe]                      |
| 4   | 用户                                        | POST /community/recharge { packageId:'cny-md', payChannel:'alipay' } | 200, orderNo + payUrl，DB 写 RechargeOrder pending                    |
| 5   | CNY 套餐 + payChannel=stripe                | POST /community/recharge                                             | 400 通道与币种不匹配                                                  |
| 6   | 上一步订单，模拟支付宝回调                  | callback/alipay                                                      | 订单 paid, spendable += credits, record 写入                          |
| 7   | 同一订单回调重复发送                        | callback/alipay × 2                                                  | 第二次幂等不再入账                                                    |
| 8   | spendable=10，付费集价 50                   | purchase                                                             | 402 余额不足                                                          |
| 9   | spendable=100，付费集价 10                  | purchase                                                             | spendable=90, 创作者 withdrawable += 8（80%）                         |
| 10  | withdrawable=500（< 1000）                  | POST /community/withdraw/apply                                       | 400 + 提示门槛                                                        |
| 11  | withdrawable=1500，未 KYC                   | apply                                                                | 403 + requireKyc: true                                                |
| 12  | withdrawable=1500，已 KYC，正确填写         | apply                                                                | 200, withdrawable=500, order pending                                  |
| 13  | currency=USD, payoutChannel=alipay          | apply                                                                | 400 通道与币种不匹配                                                  |
| 14  | 已有 pending 提现单，再申请                 | apply                                                                | 409                                                                   |
| 15  | pending 订单                                | cancel                                                               | 200, withdrawable 退还, 写 refund_withdraw 流水                       |
| 16  | approved / paid / rejected / cancelled 订单 | cancel                                                               | 410 + data.currentStatus                                              |
| 17  | 提现订单审核通过后人工触发转账成功          | (后端内部)                                                           | 状态 paid + paidTime                                                  |
| 18  | 转账失败                                    | (后端内部)                                                           | 状态 rejected + reject_reason + withdrawable 回滚，写 refund_withdraw |
| 19  | 有 pending 充值                             | GET /community/recharge/list?status=pending                          | 200, list 含该订单                                                    |

---

## 现有接口的引用

- `POST /api/ai/record/myscore` —— Studio 积分余额。**社区钱包上线后
  前端 paywall 切走，不再借位**。
- 平台用户实名（KYC）服务接口 —— 仅后端引用，KYC 状态由
  `GET /community/earnings` 嵌套返回，前端**不直查**

---

## 阶段一**不要**做的事

下列功能后续 epic 再做：

- 跨用户转赠社区积分
- 任务奖励 / 签到 / 邀请奖励（earning 路径之一）
- 折扣码 / 促销码
- 提现到微信 / 银行卡 / Stripe Connect
- 多币种之间互换（USD 钱包换 CNY 钱包等）
- 自由金额充值（绕过套餐）

---
