# FizzDragon 情节树 — 给 AI 的指令

将本文件连同剧本和创作要求发给你使用的 AI，让它返回 `plot.json`，再在 FizzDragon 情节树中点击「导入 JSON」。每个文件导入当前章节；默认新增一组独立节点，可自行连接；勾选「覆盖当前章节情节树」则替换当前章节的节点和连线。覆盖模式或空章节以 `entryNodeId` 为起点。

## 任务

将我的剧本转换为以下 JSON 格式，保留原语言、剧情、对白、场景顺序、分支选项和结局。除非我明确要求，不要概括、改写或擅自添加分支。线性剧本可以只有场景节点。场景动作和对白放在 `description`，每次玩家选择使用独立的 decision 节点。只输出有效的 UTF-8 JSON 文件，不要 Markdown 代码围栏、注释、末尾多余的逗号或额外字段。

## 格式约定（版本 1）

- 根对象：`version`（固定为 `1`）、`entryNodeId`、`nodes`。
- 场景：`id`、`type: "scene"`、`title`（必填，最多 120 字符）、`description`（可选，最多 4,000 字符）、`next`（目标节点 ID，结局为 `null`）。
- 选择：`id`、`type: "decision"`、`prompt`（必填，最多 4,000 字符）、`choices`（按展示顺序排列的 2–6 个选项）。每个选项包含 `label`（必填，最多 4,000 字符）和 `next`（已存在的节点 ID）。结局用 `next: null` 的场景表达，选项目标不能为 null。
- 节点 ID 必须唯一：1–64 个 ASCII 字符，英文字母开头，后接字母、数字、`.`、`_`、`:` 或 `-`。所有引用的节点必须在本文件中存在，所有节点都必须能从 `entryNodeId` 到达。分支可汇合到同一节点，无需复制节点。
- 保留有意义的节点顺序和选项顺序。文本中的换行用 `\n`，引号用 `\"` 转义。不要截断原文；超过字段上限时拆成顺序连接的多个场景。
- 每个文件最多 1,000 个节点、2 MB。更长的故事拆为多个独立完整的章节文件，`next` 不得跨文件引用。
- 不添加媒体链接、生成提示词、坐标、资产 ID 或其他字段。FizzDragon 只建立可编辑骨架并自动排版。内部 ID 会在导入时加上独立命名空间，避免与已有节点及素材绑定冲突，原文、选项和拓扑关系保持一致。

## 示例

请用我的剧本替换示例；示例使用英文不代表输出必须使用英文。

```json
{
  "version": 1,
  "entryNodeId": "arrival",
  "nodes": [
    {
      "id": "arrival",
      "type": "scene",
      "title": "The unopened letter",
      "description": "At dawn, Mira discovers a letter beneath the door.\nMira: “Who brought this?”",
      "next": "open_or_leave"
    },
    {
      "id": "open_or_leave",
      "type": "decision",
      "prompt": "What will Mira do?",
      "choices": [
        {
          "label": "Open the letter",
          "next": "truth"
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
