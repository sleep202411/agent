# FizzAgent 接口

前缀 `/agent-os`，鉴权用现有会话，响应信封 `{ code, data }`。请求体 `.strict()`，多传字段会被拒。

必接 7 个：0 打开会话 → 1 发起 → 2 轮询 →（3 批准 / 4 回答 / 5 中断）→ 继续轮询，6 是模型档位。

---

## 0. 拉历史

`GET /agent-os/projects/:projectId/conversation`

冷启动恢复对话。不传 `conversationId` 就返回该项目最近的一个会话。

| 参数           | 类型 | 必填 | 说明                    |
| -------------- | ---- | ---- | ----------------------- |
| conversationId | uuid |      | query，省略则取最近会话 |

**响应**

| 字段           | 类型         | 说明                                          |
| -------------- | ------------ | --------------------------------------------- |
| conversationId | uuid \| null | 该项目还没有任何 run 时为 null，runs 为空数组 |
| runs           | object[]     | 按回合，每项见下                              |

**runs[]**

| 字段                  | 类型           | 说明                             |
| --------------------- | -------------- | -------------------------------- |
| runId                 | uuid           |                                  |
| status                | enum           | 同 RunResponse.status            |
| modelProfileId        | string         |                                  |
| events                | Event[]        | 该回合全部事件，按 sequence 升序 |
| pendingApproval       | object         | 可选                             |
| pendingUserInput      | object         | 可选                             |
| pendingExternal       | object         | 可选                             |
| assistantText         | string \| null |                                  |
| createdAt / updatedAt | ISO8601        |                                  |

最多返回 40 个回合（服务端上限 80）。

---

## 1. 发起一个回合

`POST /agent-os/runs`

立即返回 `runId`，不等 agent 跑完。

| 字段                                | 类型     | 必填 | 说明                                     |
| ----------------------------------- | -------- | ---- | ---------------------------------------- |
| projectId                           | uuid     | ✅   |                                          |
| conversationId                      | uuid     | ✅   | 客户端生成并持久化，多次 run 复用        |
| clientSubmissionId                  | uuid     | ✅   | 幂等键，重试复用                         |
| turnId                              | uuid     | ✅   | 客户端生成                               |
| messageId                           | uuid     | ✅   | 客户端生成                               |
| message                             | string   | ✅   | ≤20000 字；为空时必须有 attachmentIds    |
| modelProfileId                      | string   | ✅   | 无服务端默认值                           |
| workbenchMode                       | string   | ✅   | story 项目传 `story`                     |
| workbenchContext                    | object   |      | `{chapterId}` 或 `{sectionId}`，恰好一个 |
| attachmentIds                       | uuid[]   |      | ≤20                                      |
| permissionMode                      | enum     |      | `ask` \| `smart` \| `full`，默认 smart   |
| skillIds                            | string[] |      | ≤16                                      |
| projectSkillInstallationIds         | uuid[]   |      | ≤32                                      |
| disabledDefaultSkillInstallationIds | uuid[]   |      | ≤32                                      |

**响应 `RunResponse`**

| 字段             | 类型    | 说明                                                                                                                                                   |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| runId            | uuid    |                                                                                                                                                        |
| status           | enum    | `queued` \| `running` \| `waiting_for_approval` \| `waiting_for_input` \| `waiting_for_external` \| `paused` \| `completed` \| `failed` \| `cancelled` |
| events           | Event[] | 可选                                                                                                                                                   |
| assistantText    | string  | 可选                                                                                                                                                   |
| pendingApproval  | object  | 可选，status=waiting_for_approval 时有                                                                                                                 |
| pendingUserInput | object  | 可选，status=waiting_for_input 时有                                                                                                                    |
| pendingExternal  | object  | 可选                                                                                                                                                   |

---

## 2. 拉进度

`GET /agent-os/runs/:runId/events`

增量拉取，游标是 `sequence`。返回同 `RunResponse` 外加 `source`。

| 参数      | 类型 | 必填 | 说明                                     |
| --------- | ---- | ---- | ---------------------------------------- |
| projectId | uuid | ✅   | query                                    |
| after     | int  |      | query，上次收到的最大 sequence，首次传 0 |

**Event**

| 字段            | 类型    | 说明                                             |
| --------------- | ------- | ------------------------------------------------ |
| id              | string  |                                                  |
| protocolVersion | string  |                                                  |
| sessionId       | uuid    |                                                  |
| runId           | uuid    |                                                  |
| conversationId  | uuid    |                                                  |
| sequence        | int     | 单调递增，游标                                   |
| timestamp       | ISO8601 |                                                  |
| type            | string  | `MessageDelta` 为 token 级增量，追加即打字机效果 |
| data            | object  |                                                  |

---

## 3. 批准写入

`POST /agent-os/runs/:runId/approvals`

`status=waiting_for_approval` 时调用，待批内容在 `pendingApproval`：
`kind` / `toolId` / `toolCallId` / `arguments` / `title` / `description` / `approvalId` / `turnId`。

| 字段           | 类型   | 必填 | 说明                               |
| -------------- | ------ | ---- | ---------------------------------- |
| approvalId     | uuid   | ✅   | 取自 pendingApproval               |
| responseId     | uuid   | ✅   | 幂等键，重试复用                   |
| decision       | enum   | ✅   | `approve` \| `reject`              |
| responseText   | string | ✅   | 仅展示，非授权依据                 |
| locale         | string | ✅   | 决定服务端确认话术语言，如 `zh-CN` |
| conversationId | uuid   | ✅   |                                    |
| projectId      | uuid   | ✅   |                                    |
| modelProfileId | string | ✅   | 须与该 run 一致                    |
| permissionMode | enum   |      |                                    |

---

## 4. 回答提问

`POST /agent-os/runs/:runId/user-input`

`status=waiting_for_input` 时调用，问题在 `pendingUserInput`，每个含
`id` / `header` / `question` / `options[{value, label, description}]`。

| 字段           | 类型   | 必填 | 说明                                          |
| -------------- | ------ | ---- | --------------------------------------------- |
| requestId      | uuid   | ✅   | 取自 pendingUserInput                         |
| responseId     | uuid   | ✅   | 幂等键，重试复用                              |
| answers        | object | ✅   | `{问题id: 选项value}`，key/value 各 1–64 字符 |
| conversationId | uuid   | ✅   |                                               |
| projectId      | uuid   | ✅   |                                               |
| modelProfileId | string | ✅   |                                               |
| permissionMode | enum   |      |                                               |

---

## 5. 中断

`POST /agent-os/runs/:runId/cancel`

停止一个进行中的回合。

| 字段      | 类型   | 必填 | 说明         |
| --------- | ------ | ---- | ------------ |
| projectId | uuid   | ✅   |              |
| reason    | string |      | 记入 journal |

---

## 6. 模型档位

`GET /agent-os/models`

`modelProfileId` 必填且服务端不给默认值，档位表由服务端持有，不要在客户端硬编码。无参数。

**响应**

| 字段           | 类型   | 说明                     |
| -------------- | ------ | ------------------------ |
| models[].id    | string | 传给 `modelProfileId`    |
| models[].label | string | 展示名，专有名词，不翻译 |
| models[].hint  | string | 可选，一句话适用场景     |

---

## 可选

| 接口                                                   | 用途                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `GET /agent-os/skills`                                 | 技能选择                                                                          |
| `GET`/`POST /agent-os/projects/:projectId/attachments` | 附件上传，不接则为纯文字对话                                                      |
| `POST /agent-os/realtime/token`                        | Ably 推送 token，纯加速；不接不缺功能，只是新消息延迟等于轮询间隔。**.cn 不要接** |
