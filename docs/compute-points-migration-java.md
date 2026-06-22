# 算力积分迁移 / 积分桥接 — Java 对接文档

> 给 Java 后端同学对接用。提供 4 个「机器对机器」接口,把用户算力积分从老 MySQL **平滑、按用户逐个**迁移到新系统(PG 钱包);迁移后该用户的扣分 / 加分都走这里。**不改老库、不全量割接、不双写。**
>
> 事实来源:`apps/server/src/internal/`(`internal-points.controller.ts` / `internal-points.service.ts` / `internal-points.dto.ts`)。

## 线上地址与当前状态

**BASE_URL(已实测 2026-06-22)**

- 国际 `.com`:`https://fizzdragon.com/aurora`
- 国内 `.cn`:`https://fizzstudio.fizzspace.cn/aurora`(**不要用** `fizzdragon.fizzspace.cn` —— 仍是旧 / Java 栈,`/aurora/internal/*` 会 404)
- 完整地址 = BASE_URL + 接口路径,例:`POST https://fizzdragon.com/aurora/internal/points/migrate`

## 对接策略(懒迁移,Java 驱动)

1. **未迁移用户**:老 MySQL 余额不变,Java 继续用老逻辑扣 / 加积分。
2. **迁移某用户时**(首次触发或后台批量):Java 调 `migrate`,把该用户 MySQL 当前余额**一次性**搬到新系统,并在 **Java 侧给该用户打「已迁移」标记**。
3. 之后该用户的扣 / 加都改调本接口(`deduct` / `grant`),不再动老库;未迁移用户仍走老逻辑。
4. `balance` 返回的 `migrated` 字段可作参考,但**路由判断以 Java 自己的标记为准**。

## 认证

- 请求头:`x-service-token: <密钥>`(服务间共享密钥,**不是**用户 satoken,也不是管理员登录)。
- 服务端环境变量:`INTERNAL_SERVICE_TOKEN`(运维统一下发,两边一致);未配置则一律 `503`,不会静默放行。

## 通用约定

- **单位**:`amount` / `balance` 均为整数「积分」,等价于新系统算力积分 `compute_point`,与老系统 **1:1**。
- **大数为字符串**:`balance` / `deducted` / `granted` 以**字符串**返回(避免 JS BigInt 精度问题),Java 按 `long` 解析。
- **成功**:`{ "code": 200, "data": { ... } }`;**失败**:对应 HTTP 状态码 + `{ "code": "<错误码>", "msg": "<说明>" }`。
- **幂等键 `idempotencyKey`**:`deduct` / `grant` 必填,Java 为**每一笔业务**生成稳定且唯一的 key(如订单号 / 流水号)。同 key 重试**不会重复**扣 / 加(`deduped=true` 表示命中幂等、未产生新变动)。`migrate` 按 `userId` 幂等,无需传 key。

## 接口

### 1. 迁移 / 初始化 — `POST /internal/points/migrate`

把用户老库余额搬到新系统。**对同一 `userId` 幂等**(重复调用不会重复充值)。

请求体:

```json
{ "userId": "10086", "balance": 1200 }
```

| 字段      | 类型                     | 说明                                          |
| --------- | ------------------------ | --------------------------------------------- |
| `userId`  | string(1–64)             | 用户 ID                                       |
| `balance` | int（可正可负，负=欠款） | 该用户当前老库余额;`0` 时只建迁移标记、不充值 |

响应 `data`:

```json
{ "userId": "10086", "workspaceId": "0199...", "alreadyMigrated": false, "balance": "1200" }
```

```bash
curl -X POST "https://fizzdragon.com/aurora/internal/points/migrate" \
  -H "x-service-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"10086","balance":1200}'
```

### 2. 扣积分 — `POST /internal/points/deduct`

从已迁移用户的钱包扣减。余额不足返回 `409 INSUFFICIENT_WALLET_BALANCE`。

请求体:

```json
{ "userId": "10086", "amount": 50, "reason": "生成图片", "idempotencyKey": "order_20260620_0001" }
```

| 字段             | 类型              | 说明                        |
| ---------------- | ----------------- | --------------------------- |
| `userId`         | string(1–64)      | 用户 ID                     |
| `amount`         | int ≥ 1           | 扣减积分数                  |
| `reason`         | string(≤500),可选 | 业务备注(写入流水,便于排查) |
| `idempotencyKey` | string(1–180)     | 业务幂等键,必填且需稳定唯一 |

响应 `data`:`{ "userId": "10086", "deducted": "50", "balance": "1150", "deduped": false }`

```bash
curl -X POST "https://fizzdragon.com/aurora/internal/points/deduct" \
  -H "x-service-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"10086","amount":50,"reason":"生成图片","idempotencyKey":"order_20260620_0001"}'
```

### 3. 加积分 — `POST /internal/points/grant`

给已迁移用户充值(注册赠送、退款返还、活动补发等)。参数与 `deduct` 相同。

响应 `data`:`{ "userId": "10086", "granted": "500", "balance": "1650", "deduped": false }`

> **注册赠送 500 的用法**:新用户注册时调用一次,`idempotencyKey` 用 `register_bonus:<userId>`,天然防止重复发放:
> `{"userId":"<新用户>","amount":500,"reason":"register_bonus","idempotencyKey":"register_bonus:<userId>"}`

```bash
curl -X POST "https://fizzdragon.com/aurora/internal/points/grant" \
  -H "x-service-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"10086","amount":500,"reason":"register_bonus","idempotencyKey":"register_bonus:10086"}'
```

### 4. 查余额 / 迁移状态 — `GET /internal/points/balance?userId=<id>`

响应 `data`:`{ "userId": "10086", "migrated": true, "balance": "1150" }`

- `migrated`:新系统是否已为该用户建立迁移记录。
- `balance`:已扣除「过期积分」后的诚实可用余额。

```bash
curl "https://fizzdragon.com/aurora/internal/points/balance?userId=10086" -H "x-service-token: $TOKEN"
```

## 错误码

| HTTP | code                           | 含义                                    |
| ---- | ------------------------------ | --------------------------------------- |
| 400  | (参数校验)                     | 请求体 / 参数不合法(缺字段、类型错误等) |
| 401  | `INVALID_SERVICE_TOKEN`        | `x-service-token` 缺失或错误            |
| 503  | `INTERNAL_AUTH_NOT_CONFIGURED` | 服务端未配置 `INTERNAL_SERVICE_TOKEN`   |
| 409  | `INSUFFICIENT_WALLET_BALANCE`  | 扣减时余额不足                          |

## 错误兼容与平滑迁移(重要)

为保证迁移期丝滑,Java 侧务必对每类返回做**降级处理**,任一笔失败都**不阻塞用户、可回退老逻辑、可安全重试**:

| 情况                                                | 建议处理                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 网络超时 / 5xx / `503 INTERNAL_AUTH_NOT_CONFIGURED` | 视为「桥接暂不可用」:该用户**回退老逻辑**(继续用老 MySQL 扣 / 加),稍后重试迁移;不要因桥接失败拒绝用户操作。           |
| `401 INVALID_SERVICE_TOKEN`                         | 配置问题:告警 + 回退,联系我们核对密钥。                                                                               |
| `409 INSUFFICIENT_WALLET_BALANCE`                   | 正常业务结果(余额不足):按业务提示用户,不算迁移失败。                                                                  |
| 重试                                                | `migrate` 按 `userId` 幂等、`deduct` / `grant` 按 `idempotencyKey` 幂等,均可安全重试(`deduped=true` 表示未重复变动)。 |

原则:**任一笔失败都应可回退老逻辑 + 可重试**,确保用户无感、不重复扣费、不丢账。

## 注意事项

- **个人工作空间自动创建**:`migrate` / `grant` / `deduct` 会按需自动为用户建好个人工作空间(钱包挂其上),**Java 侧无需任何前置**,也**不会再返回 `PERSONAL_WORKSPACE_MISSING`**。
- **负余额(欠款)**:`migrate` 接受负 `balance`,**原样迁入**(钱包余额为负 = 欠款)。余额为负时**禁止消费**(`deduct` 会被拒),直到下次 `grant` / 充值把余额抵扣回 ≥ 0 —— 入账时**优先抵欠款**,记账一致、不重复计欠款。
- **安全(公网调用)**:跨云走公网,依赖 ① 全程 HTTPS ② `x-service-token`(未配置则 503)。强烈建议把 **Java 固定出口公网 IP 加网关 / WAF 白名单** + 该路径单独限流(请 Java 提供出口 IP)。
- **待我们 / 运维处理**:① `INTERNAL_SERVICE_TOKEN` 下发到 `.com` / `.cn` 生产并与 Java 对齐;② 配置 Java 出口 IP 白名单。
- 迁移是**单向**的(老库 → 新库);新库这边的扣 / 加不回写老 MySQL。
