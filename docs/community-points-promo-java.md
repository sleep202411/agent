# 社区积分发放接口 — Java 对接

> 草案(2026-08-21),Nest 侧实现部署后可用。活动码的校验/防重/上限由 Java 负责,本接口只负责入账。

## 接口

`POST {BASE_URL}/internal/points/community/grant`

- `.com`:`https://fizzdragon.com/aurora`
- `.cn`:`https://fizzstudio.fizzspace.cn/aurora`(本期先只开 .com)

认证:请求头 `x-service-token`,密钥同现有算力积分桥(`INTERNAL_SERVICE_TOKEN`),无需新配置。

## 请求参数

```json
{
  "userId": "10086",
  "amount": 2000,
  "reason": "promo_2026_cathy",
  "idempotencyKey": "promo_redeem:A8K3F2:10086"
}
```

| 字段             | 类型              | 说明                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------ |
| `userId`         | string(1–64)      | Java 用户 ID                                                       |
| `amount`         | int ≥ 1           | 发放的社区积分数,单笔上限 50000(待定)                              |
| `reason`         | string(≤500),可选 | 业务备注,建议带活动标识                                            |
| `idempotencyKey` | string(1–180)     | 幂等键,必填。建议 `promo_redeem:<活动码>:<userId>`,同 key 重试安全 |
| `expiresAt`      | ISO8601,可选      | 积分过期时间,不传则不过期(是否启用待定)                            |

## 响应

```json
{
  "code": 200,
  "data": { "userId": "10086", "granted": "2000", "balance": "2000", "deduped": false }
}
```

`deduped: true` = 此前已入账、本次未重复发放,视同成功。

## 错误码

| HTTP | code                            | 含义                    |
| ---- | ------------------------------- | ----------------------- |
| 400  | (参数校验)/`AMOUNT_EXCEEDS_CAP` | 参数不合法 / 超单笔上限 |
| 401  | `INVALID_SERVICE_TOKEN`         | token 缺失或错误        |
| 503  | `INTERNAL_AUTH_NOT_CONFIGURED`  | 服务端未配置密钥        |

```bash
curl -X POST "https://fizzdragon.com/aurora/internal/points/community/grant" \
  -H "x-service-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"10086","amount":2000,"reason":"promo_2026_cathy","idempotencyKey":"promo_redeem:A8K3F2:10086"}'
```

> 注意:请在收到成功响应(含 `deduped:true`)后再把码标记为已核销;超时/5xx 用同一个 `idempotencyKey` 重试即可,不会重复发放。
