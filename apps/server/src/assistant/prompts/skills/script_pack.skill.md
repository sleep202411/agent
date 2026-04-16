# script_pack.skill.md

## 目标

为每一集生成“剧本包（Script Pack）”：

1. **该集对应的原始小说原文**（溯源窗口）
2. **该集可拍剧本**（场景/动作/对白/VO）

> Pax 硬规则：剧本包里必须带相应原文。

## 输出语言

必须遵守 **language_follow**：输出语言 = 输入语言。

## 输出格式（JSON，严禁夹杂解释文本）

```json
{
  "episode": "E001",
  "source_excerpt": "(原始小说原文片段，原样保留)",
  "source_excerpt_range": {
    "file": "book.txt",
    "offset": 0,
    "length": 0,
    "note": "可选：章节标题/定位关键词"
  },
  "episode_script": {
    "duration_target_seconds": 78,
    "scenes": [
      {
        "scene_id": "S1",
        "location": "LAB CELL",
        "time": "DAY",
        "action": "(可拍外显动作与环境描写)",
        "dialogue": [{ "speaker": "LILY", "line": "11… 12… 13…", "type": "VO" }]
      }
    ],
    "notes": {
      "vo_policy": "仅保留剧本明确标注的 VO，不额外添加",
      "language": "en"
    }
  }
}
```

## 注意

- `source_excerpt` 必须来自输入提供的原文或系统可定位读取的原文窗口。
- 不要凭空扩写原文事实；改写只发生在 `episode_script`。
- 台词为空时，后续分镜抽取允许为空（不硬补）。
