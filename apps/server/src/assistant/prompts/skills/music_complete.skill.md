# 影視音樂設計技能 (Music Complete)

> 📚 **融合專業配樂知識**
>
> - Hans Zimmer 配樂理論
> - John Williams 主題音樂設計
> - 影視音樂情緒映射

---

## 一、音樂情緒映射

| 情緒     | 調性     | 節奏   | 樂器                 | 參考              |
| -------- | -------- | ------ | -------------------- | ----------------- |
| 緊張懸疑 | 小調     | 不規則 | 弦樂顫音、低音提琴   | Inception         |
| 史詩壯闘 | 大調     | 進行曲 | 銅管、打擊樂、合唱   | Gladiator         |
| 浪漫溫情 | 大調     | 舒緩   | 鋼琴、弦樂、木管     | Up (Married Life) |
| 悲傷哀愁 | 小調     | 緩慢   | 大提琴、鋼琴獨奏     | Schindler's List  |
| 恐怖驚悚 | 不協和   | 突變   | 不協和和弦、尖銳音效 | Psycho            |
| 歡快喜劇 | 大調     | 輕快   | 木管、撥弦、打擊     | Home Alone        |
| 神秘奇幻 | 教會調式 | 飄渺   | 人聲、豎琴、鐘聲     | Harry Potter      |
| 動作追逐 | 小調     | 快速   | 電子合成、打擊樂     | Mad Max           |

---

## 二、音樂段落類型

### 場景音樂

| 類型     | 用途     | 時長     | 特點         |
| -------- | -------- | -------- | ------------ |
| 開場主題 | 建立氛圍 | 30-90秒  | 完整主題旋律 |
| 過場音樂 | 場景轉換 | 5-15秒   | 簡短連接     |
| 背景音樂 | 氛圍墊底 | 持續     | 低調不搶戲   |
| 高潮配樂 | 情感爆發 | 30-120秒 | 層層遞進     |
| 結尾音樂 | 收束情緒 | 20-60秒  | 餘韻悠長     |

### 音樂節拍與剪輯

```
動作場景: 音樂節拍 = 剪輯節奏
對話場景: 音樂退後，讓位對白
情感高潮: 音樂主導，畫面配合
```

---

## 三、AI音樂生成Prompt

### Suno/Udio 風格 Prompt

```
[情緒] [類型] [樂器] [節奏] [參考]

範例:
"Emotional orchestral score, strings and piano, slow tempo,
building to crescendo, Hans Zimmer style, cinematic, 4/4 time"

"Tense thriller underscore, low synth drones, irregular rhythm,
Hitchcock suspense style, minimalist, unsettling"

"Epic battle music, full orchestra with choir, fast tempo,
brass fanfare, percussion heavy, Lord of the Rings style"
```

### 中文Prompt (可靈音樂)

```
「情感型管弦配樂，弦樂與鋼琴為主，節奏舒緩，
漸強至高潮，電影質感，4/4拍」
```

---

## 四、時間軸音樂設計（重要！）

### 輸出格式（必須包含時間和鏡頭關聯）

```json
{
  "music_cues": [
    {
      "cue_id": "M001",
      "start_time": "00:00",
      "end_time": "00:45",
      "shots": "E01_S001 - E01_S008",
      "mood": "神秘/懸疑",
      "description": "開場氛圍，深夜街道的不安感",
      "suno_prompt": "Mysterious ambient, low synth drones, sparse piano notes, unsettling atmosphere, slow tempo 60bpm, cinematic, dark",
      "suno_prompt_zh": "神秘氛圍音樂，低沉合成器，稀疏鋼琴，不安感，慢節奏60bpm，電影質感",
      "volume": "pp → p",
      "transition": "fade in"
    },
    {
      "cue_id": "M002",
      "start_time": "00:45",
      "end_time": "01:30",
      "shots": "E01_S009 - E01_S015",
      "mood": "緊張升級",
      "description": "發現異常，緊張感逐漸建立",
      "suno_prompt": "Tension building, strings tremolo, heartbeat bass, crescendo, thriller style, 80bpm accelerating to 100bpm",
      "suno_prompt_zh": "緊張遞進，弦樂顫音，心跳低音，漸強，驚悚風格，80bpm加速到100bpm",
      "volume": "p → mf",
      "transition": "crossfade"
    }
  ]
}
```

### 時間計算規則

- 每個鏡頭平均 3-6 秒
- 10個鏡頭 ≈ 30-60秒音樂段落
- 音樂轉場要與場景轉場同步

### Suno Prompt 必備元素

1. **情緒**: mysterious/tense/epic/romantic/sad
2. **樂器**: strings/piano/synth/brass/percussion
3. **節奏**: slow 60bpm / medium 90bpm / fast 120bpm
4. **風格**: cinematic/orchestral/electronic/ambient
5. **動態**: crescendo/diminuendo/steady

---

## 五、分鏡音樂標註（單鏡頭）

### JSON格式

```json
{
  "shot_id": "E001_S005",
  "music": {
    "cue_id": "M002",
    "type": "background",
    "mood": "tense",
    "instrument": "strings, low synth",
    "tempo": "slow building",
    "volume": "medium, crescendo",
    "music_prompt": "Tense orchestral underscore, building suspense..."
  }
}
```

### 音量變化

| 標記 | 含義            |
| ---- | --------------- |
| pp   | 極弱 - 背景氛圍 |
| p    | 弱 - 對話場景   |
| mp   | 中弱 - 一般敘事 |
| mf   | 中強 - 重要時刻 |
| f    | 強 - 高潮       |
| ff   | 極強 - 史詩時刻 |

---

## 五、主題音樂設計

### 角色主題

每個主要角色應有專屬音樂主題：

- **主角主題**: 貫穿全劇的核心旋律
- **反派主題**: 不祥、威脅感
- **愛情主題**: 溫柔、浪漫
- **命運主題**: 宿命感、循環

### 主題變奏

同一主題在不同情境下的變化：

- 大調 → 小調（希望 → 絕望）
- 獨奏 → 合奏（孤獨 → 團結）
- 慢速 → 快速（平靜 → 緊張）
