# 分鏡表完整技能 (Storyboard Complete)

> 📚 **融合專業分鏡知識**
>
> - Steven D. Katz《Film Directing Shot by Shot》
> - Francis Glebas《Directing the Story》(迪士尼)
> - DeepSeek 3輪專業諮詢優化方案

---

## 一、ASL鏡頭密度公式

```
鏡頭數 = 總時長(秒) ÷ ASL(秒/鏡頭)
```

### 專業ASL參考

| 風格           | ASL       | 每分鐘鏡頭 | 代表     |
| -------------- | --------- | ---------- | -------- |
| 快節奏動作     | 2-3秒     | 20-30      | 諜影重重 |
| 現代商業片     | 3-5秒     | 12-20      | 低俗小說 |
| 經典好萊塢     | 5-8秒     | 8-12       | 希區柯克 |
| 藝術沉思       | 8-13秒    | 5-8        | 庫布里克 |
| **AI番劇推薦** | **3-5秒** | **12-20**  | 平衡叙事 |

### 每集鏡頭數計算

```
最小 = 時長(分鐘) × 10
推薦 = 時長(分鐘) × 15
最大 = 時長(分鐘) × 25
```

---

## 二、場景類型→密度映射

| 場景類型    | 強度  | ASL    | 每分鏡頭 |
| ----------- | ----- | ------ | -------- |
| 🔥 高潮衝突 | ★★★★★ | 2-3秒  | 20-30    |
| ⚡ 動作追逐 | ★★★★★ | 2-3秒  | 20-30    |
| 😢 情感爆發 | ★★★★☆ | 3-4秒  | 15-20    |
| 💬 對話博弈 | ★★★☆☆ | 4-5秒  | 12-15    |
| 🎭 角色內心 | ★★★☆☆ | 4-6秒  | 10-15    |
| 🏠 日常場景 | ★★☆☆☆ | 5-7秒  | 9-12     |
| 🌅 氛圍環境 | ★☆☆☆☆ | 6-10秒 | 6-10     |

---

## 三、HERO SHOT系統

### 重要性等級

| 等級     | 比例 | 說明                       |
| -------- | ---- | -------------------------- |
| **S** 🔴 | 5%   | HERO SHOT - 視覺衝擊力最強 |
| **A** 🟠 | 15%  | KEY SHOT - 劇情轉折點      |
| **B** 🟡 | 30%  | IMPORTANT - 推進敘事       |
| **C** 🟢 | 50%  | STANDARD - 常規過渡        |

### HERO SHOT必出現場景

- 角色首次登場
- 關鍵道具/場景揭示
- 情感高潮時刻
- 戲劇反轉瞬間
- 每集鉤子/懸念點

### 每集HERO數量

| 時長   | 總鏡頭 | HERO  | KEY     |
| ------ | ------ | ----- | ------- |
| 3分鐘  | 45     | 2-3個 | 6-7個   |
| 5分鐘  | 75     | 4-5個 | 10-12個 |
| 10分鐘 | 150    | 7-8個 | 20-25個 |

---

## 四、分鏡節奏曲線

### 起承轉合分配

```
起 (Setup)   : 20% 鏡頭，ASL較長(5-8秒)
承 (Build)   : 30% 鏡頭，ASL中等(4-6秒)
轉 (Turn)    : 30% 鏡頭，ASL較短(3-4秒)
合 (Resolve) : 20% 鏡頭，ASL變化(2-6秒)
```

### 45鏡頭示例

```
【起】1-9 (20%): 建立2 + 人物3 + 鋪墊4
【承】10-22 (30%): 對話6 + 推進4 + 酝酿3
【轉】23-35 (30%): 爆發5 + 升級4 + 揭示4
【合】36-45 (20%): 收尾4 + 結果3 + 鉤子2
```

---

## 五、鏡頭類型分布

---

## 0.5 新增：分集維度導演包（Episode-Level Direction Pack）【2026-03-06 重構】

> 本 skill 原本以「逐鏡頭」給方法論，會導致：
>
> - 人/道具/環境的物理關係在鏡頭間漂移
> - 動作/表情缺少源頭與目的（演技不一致）
> - 鏡頭語法不穩定（同場景左右跳、運鏡亂）
>
> ✅ 新方案：**先分集設計，再逐鏡頭落地**。每集先生成三本“聖經”，由「總導演」統一指令：
>
> 1. 分集美術聖經 episode_art_bible（物理/服化道/人-道具-環境關係）
> 2. 分集演技聖經 episode_acting_bible（trigger/objective/subtext/動作限制→表情結果）
> 3. 分集攝影聖經 episode_camera_bible（機位錨點/鏡頭語法/運鏡節奏）
>
> 最終每個鏡頭必須把三者**強制注入**到 `description + Image_Prompt + Video_Prompt`，而不是只存在於導演筆記。
>
> ✅ 跨系统协议（@Token）：
>
> - 每个镜头的 `description` / `Image_Prompt` / `Video_Prompt` 必须以 `@Token` 列表开头（后跟空格）。
> - **人物 LookToken** = `角色名 + 服装名`（字符串拼接），例：`Jason綠色西裝`、`Lily囚服`。
> - **道具 PropToken** = `道具名`（前缀@），用于标记关键道具/束缚/器具，例：`@鐵鏈`、`@鎖扣`、`@注射器`、`@針桶`、`@籠車`、`@小刀`。
>   - ⚠️ PropToken 必须来自服化道/道具智能体识别或资产库（见 episode_art_bible.allowed_prop_tokens）。
>   - 禁止把身体部位/针孔等写成 @。
> - 多人/多道具镜头：`@Jason綠色西裝 @Lily囚服 @咖啡杯 男人正在和女人一起喝咖啡...`
> - QC：LookToken 与 character+costume 不一致 → 判错重写；关键道具尽量带 PropToken。
>
> 對接 skills：
>
> - `chief_director_episode.skill.md`
> - `episode_art_bible.skill.md`
> - `episode_acting_bible.skill.md`
> - `episode_camera_bible.skill.md`

### 景別要求

| 景別   | 比例   | 用途     |
| ------ | ------ | -------- |
| ECU/CU | 25-35% | 情感傳遞 |
| MCU/MS | 35-45% | 對話敘事 |
| MLS/LS | 15-25% | 空間關係 |
| ELS    | 5-10%  | 建立場景 |

### 運鏡要求

| 運鏡        | 比例   | 用途     |
| ----------- | ------ | -------- |
| Static      | 40-50% | 穩定敘事 |
| Pan/Tilt    | 20-30% | 跟隨視線 |
| Dolly/Track | 10-20% | 情感參與 |
| Handheld    | 5-15%  | 緊張真實 |
| Crane/Drone | 5-10%  | 史詩宏觀 |

### 機位角度

| 角度       | 比例   | 情緒     |
| ---------- | ------ | -------- |
| Eye Level  | 60-70% | 中立客觀 |
| High Angle | 10-15% | 脆弱渺小 |
| Low Angle  | 10-15% | 威嚴強大 |
| Dutch      | 3-5%   | 不安混亂 |
| POV        | 5-10%  | 代入沉浸 |

---

## 六、DeepSeek優化元素

### 視覺節奏

| 字段              | 選項                                   |
| ----------------- | -------------------------------------- |
| shot_duration     | 1-10秒                                 |
| cut_style         | Hard-cut/Dissolve/Fade/Match-cut/J-cut |
| transition_intent | 時間流逝/情緒轉換/空間跳躍             |

### 情感弧線

| 字段                | 選項                     |
| ------------------- | ------------------------ |
| emotional_intensity | 1-10級                   |
| purpose_in_arc      | 鋪墊/升溫/爆發/回落/餘韻 |
| emotional_target    | 緊張/釋放/悲傷/希望      |

### 視覺潛台詞

| 字段             | 範例                   |
| ---------------- | ---------------------- |
| visual_subtext   | "被困在回憶中"         |
| show_not_tell    | 冷卻的咖啡暗示時間流逝 |
| symbolic_element | 破碎的鏡子代表自我分裂 |

### 空間敘事

| 字段           | 選項                   |
| -------------- | ---------------------- |
| fg_element     | 遮擋物/引導線/象徵物   |
| mg_focus       | 主角/互動/動作         |
| bg_ambiance    | 城市燈光/自然景觀/虛化 |
| space_emotion  | 壓抑/開闊/疏離/溫馨    |
| negative_space | 大量(孤獨)/緊湊(緊張)  |

---

## 七、AI生成Prompt (必填)

> ⚠️ 本系統的最終提示詞格式以 `prompt_format_cn.skill.md` 為準（Image_Prompt=中文字段化画面提示词卡；Video_Prompt=中文三段式）。

### 画面描述（必须“可拍且信息足够”）

- 建议 **120–220字**（宁可长一点，不要短到“像摘要”）。
- 必须包含：主体/环境/材质细节/空间位置关系(前景-中景-后景)/光影/关键物理现象（风雪、尘埃、滴水、反光等）。
- 禁止：一句话带过；或只写“中景+情绪”这种不可生成描述。

示例：

```
❌ "CU, 恐惧"
✅ "近景，女孩蜷缩在墙角，左侧门缝透进一条冷白光，照亮她脸颊的汗与泪。前景有半截铁链压在地面的水渍里，链环反光。后景是模糊的走廊栅栏与监控红点，空气里漂着尘粒。"
```

**角色命名要求（必須）**

- 画面描述 / Image_Prompt / Video_Prompt **必須包含具體角色名**（如 Arian/Jake）
- 禁止使用「男人/女人/男/女/人」等泛稱作主體
- **語言一致**：description / Image_Prompt / Video_Prompt 必須使用與原文一致的語言（本案為英文）
- **對話格式**：
  - 真实对话：`角色名: 台词`（如 `Brad: How are you feeling?`）
  - 旁白/独白：`角色名 (VO): 内容`（如 `Lily (VO): 11...12...13..`）
  - 禁止使用单独的 VO 或 NARRATOR，必须标注是谁的旁白

### Image_Prompt (英文50-150詞)

**公式**: Subject + Environment + Lighting + Camera + Style + Negative

```
Cinematic close-up shot of a young Chinese opera boy (age 8, shaved head, tear-stained face, blue training uniform) crouching in corner with terrified expression, tears welling up. 1920s Beijing opera school, dim candlelight casting flickering shadows. Low-key dramatic lighting, 85mm f/2.8, shallow depth of field. Desaturated blue-gray palette, film grain, cinematic, 8K. --ar 16:9 --no cartoon, distorted face
```

### Video_Prompt (英文30-80詞)

**公式**: Subject + Action + Camera + Scene + Style + Duration

```
A terrified young Chinese opera boy slowly turns his head towards the door. Candlelight flickers on wet cheeks, casting dancing shadows. Camera slowly pushes in from medium to extreme close-up. 1920s Beijing opera school, low-key lighting, cinematic quality. Keep face consistent, no flicker. 4 seconds.
```

---

## 十、KLING 3.0 Omni 中文格式（推薦！）

> 適用於可靈KLING等中文視頻AI，更簡潔直觀

### 格式模板

```
【場景】[類型]，[地點]，[環境細節]，[氛圍]；
分鏡1（[景別][時長]）：[人物動作描寫]，[表情/情緒]，[環境互動]。
分鏡2（[景別][時長]）：[人物動作]，[對白："台詞內容。"]
分鏡3（[景別][時長]）：[動作]，[對白]，[環境變化]。
```

### 景別術語

| 中文 | 英文 | 範圍      |
| ---- | ---- | --------- |
| 全景 | LS   | 全身+環境 |
| 中景 | MS   | 腰部以上  |
| 近景 | CU   | 胸部以上  |
| 特寫 | ECU  | 面部/細節 |

### 完整範例（古裝言情）

```
【場景】古裝言情劇，庭院，紅燈籠滿廊，輕雪飄飛；
分鏡1（全景3秒）：男女主並肩立廊下，男主束髮、女主挽髻，素色古裝，淺笑望燈籠。
分鏡2（中景4秒）：女主輕抬手拂去男主肩頭落雪，輕聲說："馬年新歲，願公子歲歲安暖。"
分鏡3（近景5秒）：男主轉頭凝視女主，溫柔回握其手腕說："有姑娘在側，便是歲歲皆安，願來年共賞每一場新春雪。"
分鏡4（中景3秒）：女主淺笑頷首，輕聲應說："一言為定。"兩人對視，燈籠晃動，雪輕飄。
```

### 現代都市範例

```
【場景】都市愛情，咖啡廳，落地窗外細雨，暖黃燈光；
分鏡1（全景3秒）：女主獨坐窗邊，手握咖啡杯，望向窗外，神情落寞。
分鏡2（中景4秒）：門鈴響，男主推門而入，帶著雨水，四處張望。
分鏡3（近景3秒）：女主抬頭看見他，眼眶微紅，輕聲說："你來了。"
分鏡4（特寫2秒）：男主的手輕輕覆上她的手，說："對不起，讓你等了。"
```

### KLING格式要點

1. **全中文**：不需要英文，KLING原生支持中文
2. **對白融入**：用「說：」直接寫對白
3. **動作+情緒**：描寫動作時帶出情緒（淺笑、凝視、輕聲）
4. **環境互動**：雪飄、燈籠晃動等細節增加氛圍
5. **時長明確**：每個分鏡標注秒數

---

## 八、質量檢查

### ❌ 常見錯誤

- 全集只有10-20個鏡頭（太少！）
- 鏡頭類型單一（全是中景）
- 沒有HERO SHOT
- 節奏平坦（沒有密度變化）

### ✅ 質量標準

- 每分鐘至少10個鏡頭
- 景別覆蓋至少5種
- 每集至少2個HERO SHOT
- 高潮段落密度是日常的1.5-2倍

---

## 九、輸出JSON格式（新格式：14列專業分鏡）

每個鏡頭必須包含以下14個核心字段（新格式）：

```json
{
  "scene_no": 1,
  "shot_no": 1,
  "scene": "咖啡廳內",
  "time": "傍晚",
  "lighting": "暖黃燈光，窗外夕陽",
  "mood": "溫馨略帶憂傷",
  "character": "小雷、阿欣",
  "action": "小雷低頭攪動咖啡，阿欣靠近輕拍她肩膀",
  "dialogue": "阿欣：別想太多，我們會找到真相的。",
  "movement": "緩推",
  "shot_type": "中景",
  "description": "畫面描述：中景，眼平視角，咖啡廳內兩位女孩，暖色夕陽與室內燈光交織",
  "Image_Prompt": "Cinematic medium shot of two young Hong Kong women in a warm coffee shop, golden hour light streaming through windows. One girl stirs coffee with downcast eyes, wearing casual streetwear. Her friend reaches to pat her shoulder comfortingly. Warm amber tones, shallow depth of field, 35mm anamorphic, film grain. 8K --ar 16:9",
  "Video_Prompt": "Medium shot, camera slowly pushes in. A young woman stirs her coffee pensively. Her friend gently pats her shoulder. Warm coffee shop interior, golden hour lighting through large windows. Subtle ambient movement. 4 seconds."
}
```

### 字段說明

| 字段         | 必填 | 說明                                        | 範例                      |
| ------------ | ---- | ------------------------------------------- | ------------------------- |
| scene_no     | ✅   | Scene No.（場景號）                         | 1                         |
| shot_no      | ✅   | Shot No.（鏡頭號）                          | 1                         |
| scene        | ✅   | 場景位置                                    | 咖啡廳內/街頭/公寓        |
| time         | ✅   | 時間段                                      | 清晨/正午/傍晚/深夜       |
| lighting     | ✅   | 光線描述                                    | 逆光/暖黃/霓虹/冷白       |
| mood         | ✅   | 氛圍情緒                                    | 緊張/溫馨/壓抑/興奮       |
| character    | ✅   | 出場角色                                    | 小雷/小雷、阿欣           |
| action       | ✅   | 動作描述                                    | 轉身離開/握拳/淚流滿面    |
| dialogue     | ⭕   | 台詞對白                                    | 角色：台詞內容（無則"-"） |
| movement     | ✅   | 運鏡方式                                    | 固定/推/拉/搖/移/跟       |
| shot_type    | ✅   | 景別（中文）                                | 特寫/近景/中景/全景/遠景  |
| description  | ✅   | 畫面描述（取代camera/機位，避免與景別混淆） | 中景眼平、主體與背景構圖  |
| Image_Prompt | ✅   | 圖片生成詞                                  | 英文50-150詞              |
| Video_Prompt | ✅   | 視頻生成詞                                  | 英文30-80詞               |

### 注意事項

- `dialogue` 可以為空字符串，但字段必須存在
- `Image_Prompt` 必須是英文，包含畫面細節
- `Video_Prompt` 必須是英文，包含動作和時長
