# 服装设计 Skill

## 核心理论来源

- **Deborah Nadoolman Landis**《Dressed: A Century of Hollywood Costume Design》- 好莱坞服装设计圣经
- **Sandy Powell** 三届奥斯卡得主的设计哲学
- **Colleen Atwood** 时代剧服装大师
- **张叔平** 华语电影美学巅峰

## 服装设计六要素

### 1. 角色身份映射

- 社会阶层：贵族/平民/边缘人
- 职业特征：军人/学生/艺术家
- 年代背景：民国/现代/未来
- 地域文化：东方/西方/混搭

### 2. 心理外化原则

- **颜色心理学**
  - 红：激情/危险/权力
  - 黑：神秘/权威/悲伤
  - 白：纯洁/脆弱/新生
  - 蓝：冷静/忧郁/智慧
- **材质语言**
  - 丝绸：奢华/脆弱
  - 皮革：叛逆/保护
  - 棉麻：朴素/自然
  - 金属：未来/冷酷

### 3. 角色弧线服装变化

- 开场服装 → 确立角色初始状态
- 转折服装 → 标记重大变化
- 高潮服装 → 角色最终面貌
- 符号性配件 → 贯穿全片的视觉锚点

### 4. 场景适配

- 日常场景 vs 仪式场景
- 室内 vs 室外
- 私密空间 vs 公共空间
- 冲突场景的服装对比

### 5. AI生图Prompt要素

```
[Character Name], [age] [gender], wearing [detailed outfit description].
FABRIC: [material and texture]
COLOR: [primary and accent colors]
STYLE: [era/aesthetic reference]
ACCESSORIES: [jewelry, bags, shoes]
POSE: [standing/sitting/action]
LIGHTING: [studio/natural/dramatic]
--style fashion photography, editorial, 8K
```

### 6. 服装档案格式

```json
{
  "character": "角色名",
  "occasion": "场合（日常/正式/战斗/睡眠）",
  "outfit": {
    "top": "上装描述",
    "bottom": "下装描述",
    "outerwear": "外套",
    "footwear": "鞋子",
    "accessories": ["配饰1", "配饰2"]
  },
  "color_palette": ["#主色", "#辅色", "#点缀色"],
  "fabric": "主要材质",
  "style_reference": "风格参考（如：王家衛電影/赛博朋克）",
  "symbolic_meaning": "服装象征意义",
  "ai_prompt": "完整的AI生图prompt"
}
```

## 常见错误避免

- ❌ 服装与角色性格不符
- ❌ 忽略年代/地域准确性
- ❌ 所有角色穿着同质化
- ❌ 忽略服装的叙事功能
- ❌ Prompt缺少材质和光线描述
