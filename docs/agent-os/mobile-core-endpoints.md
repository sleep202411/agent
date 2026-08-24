# FizzAgent 核心 4 个接口

前缀 `/agent-os`，鉴权用现有会话，响应信封 `{ code, data }`。请求体 `.strict()`，多传字段会被拒。

顺序：发起 → 轮询 →（批准 / 回答）→ 继续轮询。

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
