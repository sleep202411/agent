# IP / 剧集积分定价接口对接说明

本文用于对齐 IP 编辑页「Pricing / 积分定价」与 Java 后端
`/project/point/price/*` 接口的真实语义，避免前端把「价格规则 id」、
「项目 id」和「剧集 id」混用。

## 结论摘要

- 后端把 **IP 项目** 和 **剧集** 当成两类平级定价目标，用
  `priceType` 区分。
- `priceType = 1` 表示项目 / IP 维度定价，`targetId = projectId`。
- `priceType = 2` 表示剧集维度定价，`targetId = episodeId`。
- 所有不带 `priceType` 的 path 参数 `{id}`，都是 **价格规则 id**，
  不是项目 id，也不是剧集 id。
- `/project/point/price/list` 暂时不接入；前端使用
  `/project/point/price/get` 按目标查询。
- 后端目前是单条价格规则 CRUD，不是批量接口，所以前端交互应按
  「项目定价单独保存」和「每一集单独保存」处理，不能继续用一个
  tab 级全局保存按钮假装批量成功。

## 核心概念

| 名称        | 含义                | 例子                                               |
| ----------- | ------------------- | -------------------------------------------------- |
| `priceType` | 定价目标类型        | `1` = 项目 / IP，`2` = 剧集                        |
| `targetId`  | 被定价目标的业务 id | 项目 id 或剧集 id                                  |
| `id`        | 价格规则 id         | `/price/{id}`、`/delete/{id}`、`/status/{id}` 使用 |
| 项目规则    | 整 IP 打包价规则    | `priceType=1,targetId=projectId`                   |
| 剧集规则    | 单集维度的价格规则  | `priceType=2,targetId=episodeId`                   |

需要特别注意：`GET /project/point/price/{id}` 这里的 `id` 是规则 id。
如果要通过项目或剧集查询价格，必须使用
`GET /project/point/price/get?priceType=...&targetId=...`。

## 后端接口

| 方法     | 路径                               | 语义                               | 前端使用建议           |
| -------- | ---------------------------------- | ---------------------------------- | ---------------------- |
| `GET`    | `/project/point/price/{id}`        | 按价格规则 id 查询单条规则         | 只有已知规则 id 时使用 |
| `GET`    | `/project/point/price/get`         | 按 `priceType + targetId` 查询规则 | 主查询接口             |
| `POST`   | `/project/point/price/add`         | 新增价格规则                       | 目标还没有规则时使用   |
| `PUT`    | `/project/point/price/update`      | 更新价格规则                       | 目标已有规则时使用     |
| `PUT`    | `/project/point/price/status/{id}` | 启用 / 禁用价格规则                | 只用于状态切换         |
| `DELETE` | `/project/point/price/delete/{id}` | 删除价格规则                       | 清除自定义规则时使用   |
| `GET`    | `/project/point/price/list`        | 规则列表                           | 暂不接入               |

`/project/point/price/get` 查询参数：

| 参数        | 类型    | 必填 | 说明                                                 |
| ----------- | ------- | ---- | ---------------------------------------------------- |
| `priceType` | `int32` | 是   | `1` = 项目 / IP，`2` = 剧集                          |
| `targetId`  | `int64` | 是   | `priceType=1` 时为项目 id；`priceType=2` 时为剧集 id |

## 前端数据模型建议

前端不要让页面组件直接理解后端这套规则表 CRUD。建议在
`apps/web/app/(site)/ips/_hooks/use-pricing.ts` 或相邻 adapter 中统一转换：

```ts
type PointPriceRule = {
  id: string | number;
  priceType: 1 | 2;
  targetId: string | number;
  points: number;
  enabled: boolean;
};

type IpPricingViewModel = {
  projectPackageRule?: PointPriceRule;
  episodeRulesByEpisodeId: Map<string, PointPriceRule>;
};
```

后端实际字段名需要以接口返回为准，例如积分字段可能叫 `price`、
`point`、`points` 或其他名字。前端 adapter 负责把后端字段归一化成
页面可读的 `points/enabled`，页面只消费稳定的 view model。

## 加载流程

1. 加载 IP / 项目详情，拿到 `projectId`。
2. 加载该 IP 下的剧集列表，拿到所有 `episodeId`。
3. 查询项目维度定价：
   `GET /project/point/price/get?priceType=1&targetId={projectId}`。
4. 对每一集查询剧集维度定价：
   `GET /project/point/price/get?priceType=2&targetId={episodeId}`。
5. 把返回结果归一化：
   - 项目规则进入 `projectPackageRule`，用于整 IP 打包购买。
   - 剧集规则按 `episodeId` 放入 `episodeRulesByEpisodeId`。
   - 没查到规则的剧集，在 UI 中显示为「未设置单集价」。

因为后端暂时没有批量查询接口，前端需要控制并发，避免一次性对几十集
打满请求。建议使用有限并发，例如 4 到 8 个请求并行。

## 保存流程

### 项目 / IP 打包价保存

项目维度定价只操作一条规则，语义是整 IP 打包价：

- 如果已经有 `projectRule.id`：调用 `PUT /project/point/price/update`。
- 如果没有规则：调用 `POST /project/point/price/add`，body 中带
  `priceType=1,targetId=projectId`。
- 如果设置为不提供打包购买，可以删除规则或禁用规则。
- 如果只是启用 / 禁用：调用
  `PUT /project/point/price/status/{ruleId}`。

### 剧集定价保存

每一集都是一条独立规则，所以 UI 必须每行单独保存：

- 如果该 `episodeId` 已有规则：调用 `PUT /project/point/price/update`。
- 如果该 `episodeId` 没有规则，但用户设置了价格：调用
  `POST /project/point/price/add`，body 中带
  `priceType=2,targetId=episodeId`。
- 如果用户清空单集价格，表示不再设置该集单独价格：
  - 可以调用 `DELETE /project/point/price/delete/{ruleId}` 删除规则；
  - 或调用 `status/{ruleId}` 禁用规则。

删除和禁用的产品语义需要团队统一：

- 「删除」更适合表示这集不再有单集价。
- 「禁用」更适合表示这条价格规则保留，但暂时不生效。
- 「0 积分免费」不应该和「禁用」混在一起；如果产品需要显式免费，
  推荐保存一条 `points=0` 且 `enabled=true` 的规则。

## UI / UX 规则

由于后端是单条 CRUD，前端不要做一个 tab 顶部的「保存全部」作为主交互。
产品级交互建议如下：

- 项目 / IP 定价区域有自己的保存按钮。
- 每一集价格行有自己的保存按钮。
- 每一行显示独立状态：未修改、未保存、保存中、已保存、保存失败。
- 某一集保存失败时，只影响该集，不应该阻塞其他集。
- 错误 toast 展示后端 `msg` 或真实错误信息，不要吞成泛化文案。
- 保存成功后 refetch 当前目标规则，拿到最新 `ruleId/status/points`。
- 离开页面前如果存在未保存行，需要提示用户。

## 异常与边界处理

- `get` 查不到规则：视为未配置，不应直接报错阻断页面。
- `add` 返回重复规则：前端应重新 `get`，再走 `update`。
- `update` 找不到规则：前端应重新 `get`，如果仍不存在则提示用户刷新。
- 网络失败：保留本行草稿，允许用户重试。
- 部分剧集查询失败：页面仍可展示已成功加载的剧集，并在失败行展示错误。
- 权限失败：展示后端原始错误，并阻止继续保存。

## 当前代码落点

当前 IP 定价页面相关代码主要在：

- `apps/web/app/(site)/ips/_hooks/use-pricing.ts`
- `apps/web/app/(site)/ips/[id]/edit/_pricing/pricing-tab.tsx`
- `apps/web/app/(site)/ips/[id]/edit/_pricing/episode-overrides-list.tsx`

其中 `use-pricing.ts` 应作为后端接口 adapter 的主要落点。页面组件不应直接
拼接 `/project/point/price/*`，否则后端这套规则表设计会扩散到 UI 层。

## 需要后端确认的问题

上线前需要后端明确以下字段和行为：

1. `add/update/get` 的完整 request / response 字段名。
2. 积分字段到底叫什么，单位是否永远是整数。
3. `status/{id}` 的参数形式和状态枚举，例如启用 / 禁用传 query、body
   还是固定 toggle。
4. `get` 查不到规则时返回什么：`code=200,data=null` 还是错误码。
5. `add` 对同一个 `priceType + targetId` 重复创建时如何处理。
6. `update` 是全量更新还是局部更新。
7. `points=0` 是否允许，是否表示免费。
8. 删除规则是否会物理删除，还是软删除。
9. 是否有权限校验，哪些角色可以修改项目和剧集价格。

## 后续接口优化建议

当前接口可以先接，但不是理想形态。后续建议后端补两个批量接口：

```http
POST /project/point/price/batch-get
POST /project/point/price/batch-upsert
```

批量查询示例：

```json
{
  "targets": [
    { "priceType": 1, "targetId": "projectId" },
    { "priceType": 2, "targetId": "episodeId1" },
    { "priceType": 2, "targetId": "episodeId2" }
  ]
}
```

批量 upsert 示例：

```json
{
  "rules": [
    { "priceType": 1, "targetId": "projectId", "points": 100, "enabled": true },
    { "priceType": 2, "targetId": "episodeId1", "points": 10, "enabled": true }
  ]
}
```

这样前端可以保持页面级编辑体验，同时后端保证事务和一致性。当前阶段则
先按单条规则 CRUD 落地，UI 上明确每个目标独立保存。
