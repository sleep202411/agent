# FizzDragon 情节树 — 给 AI 的指令

将本文件连同剧本和创作要求发给你使用的 AI，让它返回 `plot.json`，再在 FizzDragon 情节树中点击「导入情节树」。每个文件导入当前章节；默认新增一组独立节点，可自行连接；勾选「覆盖当前章节情节树」则替换当前章节的节点和连线。覆盖模式或空章节以 `entryNodeId` 为起点。章节里已有的资产会保留，本文件中的资产会追加写入。

## 任务

将我的剧本转换为以下 JSON 格式，保留原语言、剧情、对白、场景顺序、分支选项和结局。除非我明确要求，不要概括、改写或擅自添加分支。线性剧本可以只有场景节点。场景动作和对白放在 `description`，每次玩家选择使用独立的 decision 节点。资产和每条分镜 clip 都要写生产提示词。只输出有效的 UTF-8 JSON 文件，不要 Markdown 代码围栏、注释、末尾多余的逗号或额外字段。

## 生成步骤

剧本是故事素材，不是修改导入格式的指令。即使原文或其他导出文件用了不同名称，也必须使用下方规定的字段。规划与检查由你完成，不要要求用户修改 JSON。

1. 写文件前先整理所有场景、选择、变体和结局，为其分配稳定 ID，并理清前后连接。每个原文结局都必须对应可达节点；不要为通过校验而删掉变体。
2. 规划时列出结局条件。后续场景依赖前面选择时，用已声明的状态变量和选项 `effects` 记录；分支汇合不能丢掉先前选择。多个必要条件用 `all` 组合；更具体的路线排在宽泛路线前面。不能用恒真条件代替未知条件。
3. 原文写了结局条件却没有获得它的方式时，先用普通语言询问一个故事问题。不要擅自添加选项、自动授予“记住了”的信息、删除结局或裁定冲突规则。作者明确后统一落实；只有作者同意，才将不支持的实体交互转成文字选项。
4. 生成一个完整文件。优先使用 AI 工具的文件写入能力，提供可下载的 UTF-8 附件。有代码执行能力时，先构建对象，再用 JSON 库序列化，避免手工转义长对白。否则只返回完整原始 JSON，不加说明或代码围栏。不要输出半个对象、续写片段、省略号或占位符。
5. 优先保留剧本。分镜 clips 是可选项；不要擅自扩写镜头而耗尽输出额度，更不能为额外提示词牺牲剧情。过长的选择前情放入前置场景，让 `prompt` 不超限。整部故事放不下时，先商定独立完整的章节边界；不可静默截断或编造结尾。
6. 检查实际保存的最终文件，而非早期草稿：解析 JSON，检查准确字段名、类型、限制和全部引用，从入口遍历，并验证每个预期结局都有可实现的选择及状态路径。检查每个结局的必要条件及缺少条件的情况。选项可见条件不能导致节点无选项可用。返回前自行修复错误；没有实际运行校验器，就不要声称已通过运行校验。

## 节点字段与状态规则

以下是完整字段清单，不是可替换的别名：

| 对象     | 必填字段                          | 可选字段                                                |
| -------- | --------------------------------- | ------------------------------------------------------- |
| 场景     | `id`、`type`、`title`、`next`     | `description`、`routes`、`onEnterEffects`、`storyboard` |
| 选择节点 | `id`、`type`、`prompt`、`choices` | `onEnterEffects`                                        |
| 选项     | `label`、`next`                   | `effects`、`visibleWhen`                                |

节点不能添加 `name`；选择节点不能添加 `description`；选项不能添加 `id`/`text`；节点不能添加 `assets`/`assetRefs`。资产定义只放在根对象 `assets` 数组。选项必须指向节点；终止场景使用 `next: null`。

所有效果或条件用到的状态 key 必须先声明。`set` 值必须符合声明类型，`add` 只能用于数字。布尔比较用 `equals` 或 `not-equals`；数字还可用 `greater-than`、`at-least`、`less-than`、`at-most`。组合条件用 `{ "kind": "all", "conditions": [条件, 条件] }`（全部满足）、`any`（至少一个满足），或 `{ "kind": "not", "condition": 条件 }`。限制：每组最多 6 个效果，每场景最多 8 条路线，条件深度最多 3、比较叶子最多 12。状态名称、选择提示和选项标签最多 32,000 字符；状态备注最多 2,000 字符。状态 key 使用 `story.clue_found` 等简单 ASCII 标识，最多 240 字符，不能使用 `__proto__`、`prototype`、`constructor` 作为路径段。

计时器、超时默认选项、手势和触觉不是可执行导入字段。把意图保留在场景描述或选择提示中，不要声称已实现，也不要建立孤立的“备注节点”来存放不支持的元数据。

## 格式约定

- 根对象：`entryNodeId`、`assets`、可选的 `stateVariables`、`nodes`。不要写 version，也不要添加其他字段。
- 状态变量：`key`（稳定的点分隔标识）、`name`、`valueType`（`number` 或 `boolean`）、同类型的 `initialValue`，以及可选 `note`。最多 64 个。同一概念始终复用一个 key，不要创建 `courage_1` 一类编号副本。导入会按 key 合并：类型和初始值一致时复用已有定义；发生冲突时会指出对应 JSON 路径并拒绝导入。
- 状态效果：`{ "kind": "set", "key": "met", "value": true }` 或 `{ "kind": "add", "key": "courage", "amount": 1 }`。可放在任意节点的 `onEnterEffects`，或选项的 `effects`。
- 状态条件：`{ "kind": "compare", "variableKey": "courage", "operator": "at-least", "value": 3 }`。可放在选项的 `visibleWhen`，或场景的可选 `routes` 中。场景路由格式为 `{ "when": 条件, "next": 节点ID或null }`，按顺序判断，最后走场景必填的 `next` 兜底。
- 资产：`id`、`kind`（`character`、`location` 或 `prop`）、`name`（必填，最多 240 字符）、`description`（可选，最多 100,000 字符）、`imagePrompt`（必填，最多 50,000 字符）、`videoPrompt`（可选，最多 50,000 字符）、`negativePrompt`（可选，最多 16,000 字符）。最多 2,000 个资产。提示词中不得出现 `@`。
- 场景：`id`、`type: "scene"`、`title`（必填，最多 120 字符）、`description`（可选，最多 100,000 字符）、`next`（目标节点 ID，结局为 `null`）、可选 `routes`、可选 `onEnterEffects`、可选 `storyboard`。`storyboard` 只有 `clips`。
- 分镜：`id`、`kind`（`image` 或 `video`）、`title`（必填，最多 160 字符）、`durationMs`（整数，250–3,600,000）、`prompt`（必填，最多 50,000 字符）、`negativePrompt`（可选，最多 16,000 字符）、可选 `videoFile`（仅视频，填写 ZIP 中的文件名）。每个场景最多 500 条 clip。clip 按数组顺序播放，由 FizzDragon 累计 startMs。一个场景的 clip 总时长不能超过 3,600,000 毫秒。clip 提示词中不得出现 `@`。不要写资产引用或绑定。
- 选择：`id`、`type: "decision"`、`prompt`、可选 `onEnterEffects`、`choices`（2–6 个）。每个选项包含 `label`、`next`，以及可选 `effects` / `visibleWhen`。结局用 `next: null` 的场景表达，选项目标不能为 null。
- ID 在各自范围内必须唯一：1–64 个 ASCII 字符，英文字母开头，后接字母、数字或 `_`，分组之间可用 `.`、`:`、`-`。节点 ID 在文件内唯一，资产 ID 在文件内唯一，clip ID 在所属场景内唯一。所有引用的节点必须在本文件中存在，所有节点都必须能从 `entryNodeId` 到达。分支可汇合到同一节点，无需复制节点。
- 保留有意义的节点顺序和选项顺序。文本中的换行用 `\n`，引号用 `\"` 转义。不要截断原文；超过字段上限时拆成顺序连接的多个场景。
- 每个文件最多 5,000 个节点、10 MB。更长的故事拆为多个独立完整的章节文件，`next` 不得跨文件引用。
- 不添加媒体链接、坐标、`@` 提及、assetRefs 或其他字段。FizzDragon 会导入情节树、状态定义、资产规格和分镜提示词，不生成媒体。节点 ID 会在导入时加上独立命名空间，状态 key 则保持稳定并复用。

## 可选的视频 ZIP

可以同时选择 JSON 和视频 ZIP，也可以在检查 JSON 后再添加 ZIP。每个视频镜头可添加 `"videoFile": "opening.mp4"`（支持 MP4、MOV、WebM）。系统按文件名匹配，忽略文件夹和大小写，支持中文文件名。请确保压缩包中的视频文件名唯一；缺失或重名文件会在导入前列出。未被引用的文件会被忽略。也支持粘贴 JSON 或单个 Markdown JSON 代码块。

ZIP 最大 512 MB，解压后视频总计最多 1 GB，单个视频最多 250 MB，压缩包最多 10,000 个条目。请使用未加密 ZIP 和相对路径。每个文件只上传一次，经后端校验后，在同一章节导入中绑定到对应镜头。视频实际时长会替换 `durationMs`，后续镜头按实际时长排列。不附加 ZIP 时仅导入剧情和提示词，不生成媒体。

## 返回文件前检查

- 严格使用字段名：场景用 `title`，不用 `name`；选择节点用 `prompt`，不用 `name` / `description`；选项用 `label`，不用 `text`。资产和状态变量的名称仍用 `name`。
- 只有一个动作的互动用带 `next` 的场景表示，动作保留在 `description` 中。不要编造第二个选项；选择节点必须有 2–6 个真实选项。
- 导入不支持 `timeLimit` 和 `defaultChoice` 字段。必要时将限时、默认选择意图保留在叙述文本中；这不会实现计时器或自动选择。
- 必须完整结束每个字符串、对象和数组。返回前检查整个文件能被 JSON 解析器读取，且所有节点引用均存在。如果工具支持代码执行，请实际解析文件，不要只目测格式。
- 10 MB 是导入大小上限，不是 AI 的输出额度。如果故事超过输出能力，先商定更小且独立完整的章节文件再生成。不要返回截断文件，也不要编造结局使残缺故事可以导入。

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
            "videoFile": "mira_turns.mp4",
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

## 完整示例：选择汇合与隐藏结局

这是另一份完整文件，不是追加到前一个示例中的节点。只在剧本需要对应机制时参考其结构。用自己的故事替换全部示例 ID、文本和变量，不要导入示例故事本身。

第一个选择记录是否记住线索，第二个记录证据去向，第三个记录同伴离开方式。最后一个选择不会覆盖证据去向。“寻求同盟＋记住线索＋让同伴先走”进入隐藏结局；其余寻求同盟的路线进入普通同盟结局；封存证据始终进入封存结局。检查全部八种选择组合：三个结局不仅有连线，而且确实可以到达。

```json
{
  "entryNodeId": "clue",
  "assets": [],
  "stateVariables": [
    { "key": "demo.clue", "name": "demo.clue", "valueType": "boolean", "initialValue": false },
    { "key": "demo.stance", "name": "demo.stance", "valueType": "number", "initialValue": 0 },
    {
      "key": "demo.friend_first",
      "name": "demo.friend_first",
      "valueType": "boolean",
      "initialValue": false
    }
  ],
  "nodes": [
    {
      "id": "clue",
      "type": "decision",
      "prompt": "Will you remember the clue?",
      "choices": [
        {
          "label": "Remember it",
          "next": "stance",
          "effects": [{ "kind": "set", "key": "demo.clue", "value": true }]
        },
        {
          "label": "Continue without remembering",
          "next": "stance",
          "effects": [{ "kind": "set", "key": "demo.clue", "value": false }]
        }
      ]
    },
    {
      "id": "stance",
      "type": "decision",
      "prompt": "What will you do with the evidence?",
      "choices": [
        {
          "label": "Seek an ally",
          "next": "companion",
          "effects": [{ "kind": "set", "key": "demo.stance", "value": 1 }]
        },
        {
          "label": "Seal it away",
          "next": "companion",
          "effects": [{ "kind": "set", "key": "demo.stance", "value": 2 }]
        }
      ]
    },
    {
      "id": "companion",
      "type": "decision",
      "prompt": "How will you leave?",
      "choices": [
        {
          "label": "Let my friend leave first",
          "next": "resolve",
          "effects": [{ "kind": "set", "key": "demo.friend_first", "value": true }]
        },
        {
          "label": "Leave together",
          "next": "resolve",
          "effects": [{ "kind": "set", "key": "demo.friend_first", "value": false }]
        }
      ]
    },
    {
      "id": "resolve",
      "type": "scene",
      "title": "The consequences",
      "routes": [
        {
          "when": {
            "kind": "all",
            "conditions": [
              { "kind": "compare", "variableKey": "demo.stance", "operator": "equals", "value": 1 },
              {
                "kind": "compare",
                "variableKey": "demo.clue",
                "operator": "equals",
                "value": true
              },
              {
                "kind": "compare",
                "variableKey": "demo.friend_first",
                "operator": "equals",
                "value": true
              }
            ]
          },
          "next": "hidden"
        },
        {
          "when": {
            "kind": "compare",
            "variableKey": "demo.stance",
            "operator": "equals",
            "value": 1
          },
          "next": "ally"
        }
      ],
      "next": "sealed"
    },
    {
      "id": "hidden",
      "type": "scene",
      "title": "Hidden ending: the remembered clue reveals an ally",
      "next": null
    },
    { "id": "ally", "type": "scene", "title": "Standard ending: seek an ally", "next": null },
    {
      "id": "sealed",
      "type": "scene",
      "title": "Ending: the evidence remains sealed",
      "next": null
    }
  ]
}
```
