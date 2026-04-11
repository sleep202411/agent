# storyboard_episode_pack.skill.md

## 目标

为每一集生成“分镜集数包（Storyboard Episode Pack）”，作为分镜生成的**中观规划底稿**。

> Pax 硬规则：分镜包里必须包含该集剧本。

## 输入

- 概念包（concept_pack）
- 该集完整剧本（episode_script，来自 script_pack）

## 输出语言（硬规则）

必须遵守 **language_follow**：输出语言 = 输入语言。

- 如果输入是 **English**：JSON 的 **所有字符串值** 必须是英文（禁止中文/混写）。
- JSON 的 key 请使用英文 snake_case（如 episode_title / scene_plan / continuity_redlines）。

## 输出格式（JSON，严禁夹杂解释文本）

```json
{
  "episode": "E001",
  "concept_pack": { "ref": "E001.concept.v1" },
  "episode_script": { "ref": "E001.script.v1", "embedded": true, "data": {} },
  "scene_plan": {
    "total_scenes": 2,
    "scenes": [
      {
        "scene_id": "S1",
        "location": "LAB CELL",
        "visual_continuity": {
          "lighting": "dim / cold",
          "color": "desaturated",
          "environment": ["damp concrete", "wire-mesh bulb"]
        }
      }
    ]
  },
  "character_plan": {
    "characters": [
      {
        "name": "LILY",
        "costume": "tattered gray jumpsuit #56",
        "makeup": "pale, bruised"
      }
    ]
  },
  "props_plan": { "props": [] },
  "vfx_plan": { "vfx": [] },
  "continuity_redlines": [
    "同一场次灯光色彩必须统一",
    "同一角色服装/伤痕必须连续"
  ]
}
```

## 注意

- 该包必须可直接被程序解析。
- 不要求全书上下文；缺失项用最小可用规划，写入 continuity_redlines 或 notes。
