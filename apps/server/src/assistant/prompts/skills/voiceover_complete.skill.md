# 影視配音設計技能 (Voiceover Complete)

> 📚 **融合專業配音技巧**
>
> - 聲優演技理論
> - AI語音合成最佳實踐
> - ElevenLabs/Azure TTS 參數優化

---

## 一、配音類型

| 類型     | 英文              | 用途       | 特點           |
| -------- | ----------------- | ---------- | -------------- |
| 同期聲   | Sync Sound        | 現場錄音   | 真實、有環境音 |
| 後期配音 | ADR/Dubbing       | 錄音棚重錄 | 乾淨、可控     |
| 畫外音   | Voice Over (V.O.) | 旁白敘述   | 引導觀眾       |
| 內心獨白 | Inner Voice       | 角色心理   | 親密、私密     |
| 解說旁白 | Narration         | 紀錄片式   | 客觀、權威     |

---

## 二、聲音情緒參數

### 基礎維度

| 參數 | 範圍                | 作用         |
| ---- | ------------------- | ------------ |
| 語速 | 慢(0.7x) - 快(1.5x) | 緊張度、情緒 |
| 音調 | 低沉 - 高亢         | 性格、情緒   |
| 音量 | 耳語 - 吶喊         | 強度、距離   |
| 顫抖 | 0-100%              | 恐懼、激動   |
| 氣息 | 平穩 - 急促         | 體力、情緒   |

### 情緒映射表

| 情緒 | 語速   | 音調 | 音量  | 其他           |
| ---- | ------ | ---- | ----- | -------------- |
| 平靜 | 正常   | 中等 | 中等  | 平穩           |
| 憤怒 | 快     | 高   | 大    | 咬字重         |
| 悲傷 | 慢     | 低   | 小    | 顫抖、停頓     |
| 恐懼 | 快而碎 | 高   | 小→大 | 顫抖、氣息不穩 |
| 興奮 | 快     | 高   | 大    | 語調起伏大     |
| 疲憊 | 極慢   | 低   | 小    | 氣息弱         |
| 諷刺 | 慢     | 平   | 中    | 拖長音         |

---

## 三、角色聲線設計

### 聲線類型

| 類型       | 特點         | 適合角色       |
| ---------- | ------------ | -------------- |
| 清亮少年音 | 明亮、乾淨   | 主角、正派少年 |
| 低沉磁性   | 沙啞、有磁性 | 成熟男性、反派 |
| 甜美少女   | 清脆、活潑   | 女主、可愛型   |
| 御姐冷豔   | 低沉、冷淡   | 強勢女性       |
| 蒼老沙啞   | 虛弱、有閱歷 | 老者、智者     |
| 奸詐陰險   | 尖細、詭異   | 反派、小人     |

### AI語音選擇 (ElevenLabs)

| 角色類型 | 推薦聲音      | 設定                          |
| -------- | ------------- | ----------------------------- |
| 男主角   | Adam, Antoni  | stability: 0.5, clarity: 0.75 |
| 女主角   | Rachel, Bella | stability: 0.6, clarity: 0.8  |
| 反派     | Clyde, Arnold | stability: 0.3, clarity: 0.6  |
| 旁白     | Daniel, Josh  | stability: 0.8, clarity: 0.9  |
| 老者     | James, Bill   | stability: 0.7, clarity: 0.5  |

---

## 四、配音節奏標記

### 標記符號

| 符號 | 含義           | 範例                      |
| ---- | -------------- | ------------------------- |
| /    | 短停頓(0.3秒)  | 「我知道/你在想什麼」     |
| //   | 中停頓(0.8秒)  | 「其實//我一直想告訴你」  |
| ...  | 長停頓(1.5秒+) | 「那一天...我永遠忘不了」 |
| ↑    | 語調上揚       | 「真的嗎↑」               |
| ↓    | 語調下沉       | 「算了吧↓」               |
| ～   | 拖長音         | 「好～吧」                |
| 「」 | 強調重音       | 「我「從來」沒說過」      |

### 節奏範例

```
原文: 說的是一輩子，差一年一個月一天一個時辰都不算一輩子。

標記: 說的是一輩子//差一年/一個月/一天/一個「時辰」...都不算↓一輩子。
```

---

## 五、AI配音Prompt

### ElevenLabs 情緒指令

```
[Emotion: sad, trembling voice]
[Pace: slow, with pauses]
[Volume: soft, intimate]

"那一天，我永遠忘不了..."
```

### Azure TTS SSML

```xml
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis">
  <voice name="zh-CN-XiaoxiaoNeural">
    <prosody rate="-20%" pitch="-5%">
      <break time="500ms"/>
      那一天
      <break time="800ms"/>
      我永遠忘不了
      <prosody volume="-20%">...</prosody>
    </prosody>
  </voice>
</speak>
```

---

## 六、分鏡配音標註

### JSON格式

```json
{
  "shot_id": "E001_S015",
  "voiceover": {
    "type": "dialogue",
    "speaker": "程蝶衣",
    "line": "說的是一輩子...",
    "emotion": "悲傷、控訴",
    "pace": "slow",
    "pitch": "low-medium",
    "volume": "soft-building",
    "tremor": 30,
    "pauses": "heavy",
    "voice_prompt": "[Emotion: heartbroken] [Pace: slow with pauses] [Voice: trembling]",
    "ssml": "<prosody rate='-20%' pitch='-5%'>...</prosody>"
  }
}
```

---

## 七、口型同步 (Lip Sync)

### 音素對應

| 音素  | 口型     | 代表音     |
| ----- | -------- | ---------- |
| A     | 大開口   | 啊、阿     |
| E     | 扁口     | 唉、欸     |
| I     | 咧嘴     | 一、衣     |
| O     | 圓口     | 哦、喔     |
| U     | 嘟嘴     | 嗚、烏     |
| M/B/P | 閉口     | 嗎、吧、怕 |
| F/V   | 咬唇     | 風、佛     |
| 靜音  | 自然閉合 | 停頓       |

### AI視頻口型提示

```
Video_Prompt 追加: "...lip sync accurate, mouth movements match dialogue..."
```
