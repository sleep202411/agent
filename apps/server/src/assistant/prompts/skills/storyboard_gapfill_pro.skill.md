# 专业分镜补足（Storyboard Gap-Fill Pro）

> 目标：当用户导入的分镜表字段不全/缺Prompt/缺运镜/缺景别/缺光线等时，按照专业分镜方法论进行补足，使其达到“可制作”的标准。

---

## 1) 输入

输入是 JSON：

```json
{
  "episode": 1,
  "episode_title": "",
  "story_context": "（可选）剧本/大纲/概念/人物设定",
  "style": "（可选）画风/导演参考",
  "storyboard": [
    {
      "scene_no": 1,
      "shot_no": 1,
      "scene": "",
      "time": "",
      "lighting": "",
      "mood": "",
      "character": "",
      "action": "",
      "dialogue": "-",
      "movement": "",
      "shot_type": "",
      "description": "",
      "Image_Prompt": "",
      "Video_Prompt": ""
    }
  ]
}
```

---

## 2) 补足优先级（按制作影响排序）

1. `description`（画面描述）
2. `shot_type`（景别） + `movement`（运镜）
3. `lighting`（光线） + `mood`（氛围）
4. `character`/`action`（信息不清时补清）
5. `Image_Prompt`/`Video_Prompt`

规则：

- **不改用户已有内容**（除非明显为空/无意义）。
- 对缺失字段进行补足，且保持简短，避免 JSON 截断。

---

## 3) Prompt 规范（必须遵守）

- `Image_Prompt`：英文，10–16 词，末尾必须包含 `--ar 16:9, cinematic`
- `Video_Prompt`：英文，8–12 词，必须包含 `cinematic`
- 禁止中英混杂

---

## 4) 镜头专业性（最低标准）

- 对话镜头必须有反应镜头（至少每 3–5 句一个反应）
- 爽点/关键证据必须特写（CU/ECU）
- 结尾钩子镜头：最后一镜必须是“信息炸弹”（短信/录音/门口出现/证据出现）

---

## 5) 输出（纯 JSON）

输出必须是：

```json
{
  "episode": 1,
  "episode_title": "",
  "storyboard": [ { ...已补足shot... } ],
  "stats": {
    "filled_fields": {
      "description": 0,
      "shot_type": 0,
      "movement": 0,
      "lighting": 0,
      "mood": 0,
      "Image_Prompt": 0,
      "Video_Prompt": 0
    }
  }
}
```

只输出 JSON，不要解释。
