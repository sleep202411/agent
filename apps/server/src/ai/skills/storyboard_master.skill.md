# 分鏡大師技能 (Storyboard Master)

> 融合：storyboard_complete + cinematography_complete
> 精簡重複，保留核心技術

---

## 一、鏡頭密度公式

```
鏡頭數 = 時長(分鐘) × 密度(10-20)
```

| 場景類型    | 每分鐘鏡頭 | ASL    |
| ----------- | ---------- | ------ |
| 🔥 高潮衝突 | 20-30      | 2-3秒  |
| ⚡ 動作追逐 | 20-30      | 2-3秒  |
| 😢 情感爆發 | 15-20      | 3-4秒  |
| 💬 對話博弈 | 12-15      | 4-5秒  |
| 🏠 日常場景 | 9-12       | 5-7秒  |
| 🌅 氛圍環境 | 6-10       | 6-10秒 |

---

## 二、HERO SHOT系統

| 等級 | 比例 | 說明                |
| ---- | ---- | ------------------- |
| S 🔴 | 5%   | HERO - 視覺衝擊最強 |
| A 🟠 | 15%  | KEY - 劇情轉折點    |
| B 🟡 | 30%  | 推進敘事            |
| C 🟢 | 50%  | 常規過渡            |

**必出場景**：角色登場、道具揭示、情感高潮、戲劇反轉、每集鉤子

---

## 三、景別 (Shot Sizes)

| 景別 | 範圍       | Prompt                          | 比例   |
| ---- | ---------- | ------------------------------- | ------ |
| ECU  | 局部細節   | `extreme close-up, eyes detail` | 5-10%  |
| CU   | 面部滿畫面 | `close-up, face filling frame`  | 20-25% |
| MCU  | 胸部以上   | `medium close-up, chest up`     | 15-20% |
| MS   | 腰部以上   | `medium shot, waist up`         | 20-25% |
| MLS  | 膝蓋以上   | `medium long shot, knees up`    | 10-15% |
| LS   | 全身可見   | `long shot, full body`          | 10-15% |
| ELS  | 人物極小   | `extreme long shot, vast`       | 5-10%  |

---

## 四、機位角度 (Angles)

| 角度       | 情緒     | Prompt                   | 比例   |
| ---------- | -------- | ------------------------ | ------ |
| Eye Level  | 中性平等 | `eye level angle`        | 60-70% |
| Low Angle  | 強大威嚴 | `low angle, empowering`  | 10-15% |
| High Angle | 弱小脆弱 | `high angle, vulnerable` | 10-15% |
| Dutch      | 失衡扭曲 | `Dutch angle 20deg`      | 3-5%   |
| POV        | 主觀沉浸 | `POV shot, subjective`   | 5-10%  |
| OTS        | 對話關係 | `over-the-shoulder`      | 常用   |

---

## 五、運鏡 (Movements)

| 運鏡     | 情緒     | Prompt                    | 比例   |
| -------- | -------- | ------------------------- | ------ |
| Static   | 穩定觀察 | `static, locked camera`   | 40-50% |
| Push     | 親密強調 | `dolly push in, emphasis` | 10-15% |
| Pull     | 孤獨揭示 | `dolly out, revealing`    | 5-10%  |
| Pan/Tilt | 跟隨展示 | `slow pan right`          | 15-20% |
| Track    | 移動跟隨 | `tracking shot`           | 5-10%  |
| Crane    | 史詩宏觀 | `crane up, epic`          | 3-5%   |
| Handheld | 緊張真實 | `handheld, documentary`   | 5-10%  |
| Orbit    | 命運審視 | `slow orbit 180deg`       | 特殊   |

---

## 六、燈光 (Lighting)

| 類型       | 特點     | Prompt                               |
| ---------- | -------- | ------------------------------------ |
| High Key   | 明亮樂觀 | `high key lighting, bright`          |
| Low Key    | 戲劇陰影 | `low key, dramatic shadows, noir`    |
| Rembrandt  | 臉部三角 | `Rembrandt lighting, triangle cheek` |
| Rim        | 輪廓勾勒 | `rim lighting, backlit silhouette`   |
| Natural    | 真實柔和 | `natural window light`               |
| Volumetric | 可見光束 | `volumetric god rays`                |

### 色溫時段

| 時段     | 色溫K      | Prompt                     |
| -------- | ---------- | -------------------------- |
| 金色時刻 | 3000-4000  | `golden hour, warm orange` |
| 藍色時刻 | 9000-12000 | `blue hour, cool twilight` |
| 日光     | 5600       | `daylight, neutral white`  |
| 鎢絲燈   | 3200       | `tungsten, warm interior`  |
| 霓虹     | 混合       | `neon lights, cyberpunk`   |

---

## 七、節奏曲線

### 起承轉合分配

```
起 (20%): ASL 5-8秒，建立場景
承 (30%): ASL 4-6秒，推進敘事
轉 (30%): ASL 3-4秒，衝突爆發
合 (20%): ASL 2-6秒，收束結尾
```

---

## 八、AI Prompt格式

### ⚠️ 重要：Image_Prompt 和 Video_Prompt 必須是**純英文**！

**禁止中英混杂**：

- ❌ "a veiled witch facing a贵妇"
- ✅ "a veiled witch facing a noble lady"
- ❌ "神秘 atmosphere"
- ✅ "mysterious atmosphere"

**翻译对照**：
| 中文 | 英文 |
|------|------|
| 贵妇 | noble lady / noblewoman |
| 占梦女巫 | dream-divination witch |
| 神秘 | mysterious / enigmatic |
| 西域 | Western Regions / Central Asian |
| 草棚 | thatched hut / straw hut |

### Image_Prompt (純英文50-150詞)

```
Cinematic [shot_type] shot, [angle], [movement].
[Subject: age, appearance, clothing, expression, action].
[Environment: location, time, atmosphere].
[Lighting: type, color temperature, direction].
[Technical: lens mm, aperture f-stop, depth of field].
[Style: color palette, texture, reference].
8K, --ar 16:9 --no [negative prompts]
```

### Video_Prompt (純英文30-80詞)

```
[Shot type], [camera movement].
[Subject action: who does what].
[Environment changes: lighting, atmosphere].
[Duration] seconds, [style keywords].
```

---

## 九、輸出JSON（新格式：14列）

```json
{
  "scene_no": 1,
  "shot_no": 1,
  "scene": "場景位置",
  "time": "時間段",
  "lighting": "光線描述",
  "mood": "氛圍情緒",
  "character": "出場角色",
  "action": "動作描述",
  "dialogue": "台詞對白",
  "movement": "運鏡方式",
  "shot_type": "景別",
  "description": "畫面描述（取代舊的camera/機位角度欄位）",
  "Image_Prompt": "英文50-150詞",
  "Video_Prompt": "英文30-80詞"
}
```

---

## 十、質量檢查

✅ 每分鐘 ≥10 鏡頭
✅ 景別覆蓋 ≥5 種
✅ 每集 ≥2 HERO SHOT
✅ 高潮密度 = 日常 ×1.5-2
