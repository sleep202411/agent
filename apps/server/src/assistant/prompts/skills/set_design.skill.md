# 场景设计 Skill

## 核心理论来源

- **Ken Adam** 007系列经典场景设计
- **Dante Ferretti** 马丁斯科塞斯御用美术
- **张叔平/张兆康** 王家卫电影美学
- **Stuart Craig** 哈利波特魔法世界
- **Roger Deakins** 摄影与场景的完美融合

## 场景设计五大维度

### 1. 空间叙事 (Spatial Storytelling)

- **开放 vs 封闭**：自由/压抑
- **高 vs 低**：权力/卑微
- **明 vs 暗**：希望/绝望
- **整洁 vs 混乱**：控制/失控
- **空旷 vs 拥挤**：孤独/窒息

### 2. 时空定位

- **年代感**：建筑风格、装潢、陈设
- **地域性**：文化符号、本土元素
- **季节性**：光线、植被、氛围
- **昼夜**：灯光、阴影、色温

### 3. 情绪氛围设计

| 情绪 | 空间特征       | 色彩       | 光线       |
| ---- | -------------- | ---------- | ---------- |
| 温馨 | 低天花、暖材质 | 暖黄、橙   | 柔和、低位 |
| 压抑 | 低矮、狭窄     | 灰绿、深褐 | 顶光、硬光 |
| 神秘 | 深远、多层次   | 深紫、靛蓝 | 逆光、烟雾 |
| 危险 | 工业、尖锐     | 红黑、金属 | 频闪、对比 |
| 梦幻 | 超现实、流动   | 粉蓝、银白 | 漫射、霓虹 |

### 4. 关键场景类型

- **起点场景**：角色日常世界
- **过渡场景**：跨越边界的空间
- **核心场景**：重要事件发生地
- **对峙场景**：冲突爆发的舞台
- **终点场景**：故事收尾的空间

### 5. 场景档案格式

```json
{
  "name": "场景名称",
  "type": "类型（室内/室外/混合）",
  "location": "地理位置",
  "era": "时代背景",
  "time_of_day": "时间（黎明/白天/黄昏/夜晚）",
  "weather": "天气（晴/雨/雪/雾）",
  "atmosphere": {
    "mood": "情绪关键词",
    "color_palette": ["#主色", "#辅色", "#点缀"],
    "lighting": "光线类型",
    "sound_atmosphere": "声音氛围"
  },
  "key_elements": ["元素1", "元素2", "元素3"],
  "narrative_function": "叙事功能（日常/转折/高潮）",
  "scenes_used": ["出现的剧情场次"],
  "ai_prompt": "完整的AI生图prompt"
}
```

## AI Prompt 模板

```
[Scene Type] [Location], [era/style] architecture.
TIME: [time of day], [weather]
ATMOSPHERE: [mood keywords]
KEY ELEMENTS: [architectural features, furniture, objects]
LIGHTING: [natural/artificial, direction, color temperature]
CAMERA: [wide establishing shot / interior detail]
--style cinematic, film production design, 8K, --ar 16:9
```

## 经典场景参考

- **王家卫**：霓虹、雨夜、狭窄走廊、百叶窗光影
- **宫崎骏**：自然、飞行、蒸汽朋克、欧洲小镇
- **诺兰**：几何、对称、冷色调、建筑感
- **韦斯安德森**：对称、糖果色、复古、精致

## 常见错误避免

- ❌ 场景与剧情情绪不匹配
- ❌ 忽略时代/地域准确性
- ❌ 所有场景风格雷同
- ❌ 缺少环境细节（天气、时间）
- ❌ Prompt缺少光线和氛围描述
