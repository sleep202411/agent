# FizzDragon 情节树 — 给 AI 的指令

将本文件连同剧本和创作要求发给你使用的 AI，让它返回 `plot.json`，再在 FizzDragon 情节树中点击「导入 JSON」。每个文件导入当前章节；默认新增一组独立节点，可自行连接；勾选「覆盖当前章节情节树」则替换当前章节的节点和连线。覆盖模式或空章节以 `entryNodeId` 为起点。章节里已有的资产会保留，本文件中的资产会追加写入。

## 任务

将我的剧本转换为以下 JSON 格式，保留原语言、剧情、对白、场景顺序、分支选项和结局。除非我明确要求，不要概括、改写或擅自添加分支。线性剧本可以只有场景节点。场景动作和对白放在 `description`，每次玩家选择使用独立的 decision 节点。资产和每条分镜 clip 都要写生产提示词。只输出有效的 UTF-8 JSON 文件，不要 Markdown 代码围栏、注释、末尾多余的逗号或额外字段。

## 格式约定

- 根对象：`entryNodeId`、`assets`、可选的 `stateVariables`、`nodes`。不要写 version，也不要添加其他字段。
- 状态变量：`key`（稳定的点分隔标识）、`name`、`valueType`（`number` 或 `boolean`）、同类型的 `initialValue`，以及可选 `note`。最多 64 个。同一概念始终复用一个 key，不要创建 `courage_1` 一类编号副本。导入会按 key 合并：类型和初始值一致时复用已有定义；发生冲突时会指出对应 JSON 路径并拒绝导入。
- 状态效果：`{ "kind": "set", "key": "met", "value": true }` 或 `{ "kind": "add", "key": "courage", "amount": 1 }`。可放在任意节点的 `onEnterEffects`，或选项的 `effects`。
- 状态条件：`{ "kind": "compare", "variableKey": "courage", "operator": "at-least", "value": 3 }`。可放在选项的 `visibleWhen`，或场景的可选 `routes` 中。场景路由格式为 `{ "when": 条件, "next": 节点ID或null }`，按顺序判断，最后走场景必填的 `next` 兜底。
- 资产：`id`、`kind`（`character`、`location` 或 `prop`）、`name`（必填，最多 240 字符）、`description`（可选，最多 4,000 字符）、`imagePrompt`（必填，最多 12,000 字符）、`videoPrompt`（可选，最多 12,000 字符）、`negativePrompt`（可选，最多 4,000 字符）。最多 500 个资产。提示词中不得出现 `@`。
- 场景：`id`、`type: "scene"`、`title`（必填，最多 120 字符）、`description`（可选，最多 4,000 字符）、`next`（目标节点 ID，结局为 `null`）、可选 `routes`、可选 `onEnterEffects`、可选 `storyboard`。`storyboard` 只有 `clips`。
- 分镜：`id`、`kind`（`image` 或 `video`）、`title`（必填，最多 160 字符）、`durationMs`（整数，250–3,600,000）、`prompt`（必填，最多 12,000 字符）、`negativePrompt`（可选，最多 4,000 字符）。每个场景最多 100 条 clip。clip 按数组顺序播放，由 FizzDragon 累计 startMs。一个场景的 clip 总时长不能超过 3,600,000 毫秒。clip 提示词中不得出现 `@`。不要写资产引用或绑定。
- 选择：`id`、`type: "decision"`、`prompt`、可选 `onEnterEffects`、`choices`（2–6 个）。每个选项包含 `label`、`next`，以及可选 `effects` / `visibleWhen`。结局用 `next: null` 的场景表达，选项目标不能为 null。
- ID 在各自范围内必须唯一：1–64 个 ASCII 字符，英文字母开头，后接字母、数字或 `_`，分组之间可用 `.`、`:`、`-`。节点 ID 在文件内唯一，资产 ID 在文件内唯一，clip ID 在所属场景内唯一。所有引用的节点必须在本文件中存在，所有节点都必须能从 `entryNodeId` 到达。分支可汇合到同一节点，无需复制节点。
- 保留有意义的节点顺序和选项顺序。文本中的换行用 `\n`，引号用 `\"` 转义。不要截断原文；超过字段上限时拆成顺序连接的多个场景。
- 每个文件最多 500 个节点、2 MB。更长的故事拆为多个独立完整的章节文件，`next` 不得跨文件引用。
- 不添加媒体链接、坐标、`@` 提及、assetRefs 或其他字段。FizzDragon 会导入情节树、状态定义、资产规格和分镜提示词，不生成媒体。节点 ID 会在导入时加上独立命名空间，状态 key 则保持稳定并复用。

## 示例

请用我的剧本替换示例；示例使用英文不代表输出必须使用英文。

```json
{
  "entryNodeId": "arrival",
  "stateVariables": [
    {
      "key": "courage",
      "name": "勇气",
      "valueType": "number",
      "initialValue": 0,
      "note": "面对困难选择时积累的勇气。"
    }
  ],
  "assets": [
    {
      "id": "mira",
      "kind": "character",
      "name": "Mira",
      "description": "A courier who finds a letter at dawn.",
      "imagePrompt": "Cinematic portrait of Mira, early thirties, dark coat, dawn light on her face.",
      "videoPrompt": "Mira stands still, coat shifting in a cold breeze.",
      "negativePrompt": "cartoon, extra fingers"
    },
    {
      "id": "hallway",
      "kind": "location",
      "name": "Boarding-house hallway",
      "imagePrompt": "Narrow wooden hallway at dawn, a sealed letter under the door."
    }
  ],
  "nodes": [
    {
      "id": "arrival",
      "type": "scene",
      "title": "The unopened letter",
      "description": "At dawn, Mira discovers a letter beneath the door.\nMira: “Who brought this?”",
      "next": "open_or_leave",
      "storyboard": {
        "clips": [
          {
            "id": "letter_still",
            "kind": "image",
            "title": "Letter under the door",
            "durationMs": 2000,
            "prompt": "A sealed letter on worn floorboards in dawn light."
          },
          {
            "id": "mira_turns",
            "kind": "video",
            "title": "Mira looks down",
            "durationMs": 4000,
            "prompt": "Mira looks down at the letter, then toward the empty hallway."
          }
        ]
      }
    },
    {
      "id": "open_or_leave",
      "type": "decision",
      "prompt": "What will Mira do?",
      "choices": [
        {
          "label": "Open the letter",
          "next": "truth",
          "effects": [{ "kind": "add", "key": "courage", "amount": 1 }]
        },
        {
          "label": "Leave it unopened",
          "next": "departure"
        }
      ]
    },
    {
      "id": "truth",
      "type": "scene",
      "title": "The truth",
      "description": "The letter reveals who has been waiting for her.",
      "next": null
    },
    {
      "id": "departure",
      "type": "scene",
      "title": "A fresh start",
      "description": "Mira leaves town without looking back.",
      "next": null
    }
  ]
}
```
