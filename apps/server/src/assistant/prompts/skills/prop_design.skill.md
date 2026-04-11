# 道具设计 Skill

## 核心理论来源

- **Rick Carter** 斯皮尔伯格御用美术指导
- **Grant Major** 《指环王》道具设计
- **Francesca Lo Schiavo**《飞行家》道具美学
- **黄文英** 李安电影美术团队

## 道具设计五大功能

### 1. 叙事道具 (Narrative Props)

- **麦格芬** (MacGuffin)：推动剧情的神秘物品
- **钥匙道具**：打开剧情转折的关键物品
- **信物道具**：人物关系的象征物
- **线索道具**：悬疑/推理的视觉证据

### 2. 角色道具 (Character Props)

- **标志性物品**：角色的视觉识别符号
  - 福尔摩斯的烟斗
  - 哈利波特的眼镜
  - 程蝶衣的扇子
- **职业工具**：体现角色身份
- **个人物品**：揭示角色内心
- **传承物品**：连接过去与现在

### 3. 时代道具 (Period Props)

- 通讯工具演变：信件→电报→手机
- 交通工具演变：马车→汽车→飞船
- 日常用品的年代准确性
- 避免"穿帮"道具

### 4. 情绪道具 (Emotional Props)

- **温暖物品**：照片、信件、老物件
- **危险物品**：武器、毒药、文件
- **希望象征**：种子、地图、钥匙
- **失落象征**：破碎物品、褪色照片

### 5. 道具档案格式

```json
{
  "name": "道具名称",
  "category": "类别（信物/武器/工具/装饰/麦格芬）",
  "owner": "所属角色",
  "scenes": ["出现场景1", "场景2"],
  "narrative_function": "叙事功能",
  "physical_description": {
    "material": "材质",
    "size": "尺寸",
    "color": "颜色",
    "condition": "状态（全新/老旧/破损）",
    "era": "年代风格"
  },
  "symbolic_meaning": "象征意义",
  "ai_prompt": "Detailed close-up of [prop name], [material] [color], [condition], [era style], product photography, studio lighting, 8K, --ar 1:1"
}
```

## AI Prompt 模板

```
[Prop Name], [material] material, [color scheme], [condition/age].
STYLE: [era/aesthetic]
DETAILS: [engravings, wear marks, unique features]
BACKGROUND: [simple studio / contextual setting]
LIGHTING: [product lighting / dramatic]
--style product photography, prop design, 8K
```

## 常见错误避免

- ❌ 道具与时代不符
- ❌ 道具出现缺乏铺垫
- ❌ 重要道具没有特写镜头
- ❌ 道具使用后无交代
- ❌ Prompt缺少材质和年代感
