# Story Bible Extractor Skill

## 任务

从长篇小说全文 + 用户指令中提取**紧凑的结构化 Story Bible JSON**，作为全项目的权威锚点。

## 输出 Schema

```json
{
  "meta": {
    "title": "string — 作品名",
    "genre": "string — 类型（悬疑/复仇/爽剧/狼人/言情…）",
    "tone": "string — 基调（暗黑写实/轻松幽默/史诗…）",
    "era": "string — 时代背景",
    "setting": "string — 主要场景/地域",
    "worldRules": ["string — 世界观核心规则，≤5条"],
    "targetAudience": "string — 目标受众"
  },
  "characters": [
    {
      "name": "string — 角色全名",
      "aliases": ["string — 昵称/别名"],
      "pronouns": "he/him | she/her | they/them",
      "age": "string — 年龄或年龄段",
      "look": "string — 外貌关键词，≤80字",
      "personality": "string — 性格关键词，≤50字",
      "role": "protagonist | deuteragonist | antagonist | supporting",
      "arc": "string — 角色弧线（一句话）",
      "keyRelationships": { "角色名": "关系描述" }
    }
  ],
  "userDirectives": {
    "characterNotes": "string — 用户原始人物备注（原样保留）",
    "globalInstructions": "string — 用户全局指令（原样保留）",
    "stylePreferences": "string — 用户风格偏好（原样保留）"
  }
}
```

## 角色识别规则

1. **主角（protagonist）**：出场频率最高 + 视角人物 + 主线推动者，最多2人
2. **重要配角（deuteragonist）**：与主角有直接关系线、影响主线走向，3-6人
3. **反派（antagonist）**：主线对抗力量，1-3人
4. **配角（supporting）**：重要程度降序，最多取前5人
5. **剔除**：仅出场1-2次的路人、无名角色
6. **总数上限**：≤15个角色

## 外貌提取规则

- 从原文直接描写中提取（"他有一双蓝眼睛"→ "蓝眼睛"）
- 无直接描写时从行为/对话推断（"她总是把头发扎成马尾"→ "马尾"）
- 原文完全没提的特征**不编造**，留空即可
- 每个角色外貌 ≤80字（关键区分特征优先）

## 性格提取规则

- 从行为模式归纳（总是冲动行事→"冲动"）
- 从对话风格归纳（说话带刺→"尖锐"）
- 对比原文的明确评价（"她是个温柔的人"→ "温柔"）
- 每个角色性格 ≤50字

## 世界观提炼规则

- worldRules 只提取**故事运作必须遵守的硬规则**（如：狼人满月必须变身、魔法需要咒语）
- 软设定（如城市名、小店名）归入 setting
- genre/tone 从整体叙事风格归纳

## 用户指令融合规则（优先级）

1. **用户明确指定的 > 小说推断的**（用户说"主角30岁"，即使小说写28岁，以用户为准）
2. **用户补充的不覆盖原文**（用户加了新信息但没矛盾，合并进去）
3. **用户的 characterNotes/globalInstructions/stylePreferences 原样保留到 userDirectives**

## 紧凑性约束

- 整个 JSON ≤ 3000 tokens
- meta 部分 ≤ 200 tokens
- 每个角色 ≤ 150 tokens
- userDirectives 原样保留用户输入
- 禁止冗长叙述，用关键词/短语

## 语言规则

- **输出语言跟随输入语言**（英文小说→全英文 Bible，中文小说→全中文 Bible）
- 角色名保留原文形式
