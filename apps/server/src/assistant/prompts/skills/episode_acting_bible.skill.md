# 分集演技聖經 (Episode Acting Bible)

> 目標：把本集的情緒弧線與角色策略，固化成「可拍、可生成」的表演規則。
> 不是形容詞堆砌，而是 **動作有源頭 + 有目的 + 有幅度限制**。

---

## 演技總規則（本集全鏡頭共用）

- 表情是結果：必須由 Trigger / Objective / Subtext 推導。
- 動作有源頭：每個動作都要交代「因為什麼」「為了什麼」「怎麼做（限制）」。
- 禁止過激：例如“拍腦袋”只能一次輕拍（表達苦悶），不得生成為狂打自殘。

---

## 每鏡頭「演技五件套」

對本集可能出現的人物鏡頭，提供統一模板：

1. Trigger（觸發源頭）
2. Objective（當下目的）
3. Subtext / Inner Thought（心理活動一句話）
4. Physicalization（微動作 + 節奏 + 幅度限制）
5. Expression Result（微表情/眼神作為結果）

---

## 輸出格式（JSON only）

```json
{
  "episode": 1,
  "emotion_arc": [
    { "beat": 1, "name": "壓迫", "purpose": "讓觀眾窒息" },
    { "beat": 2, "name": "克制", "purpose": "女主不崩潰、反常冷靜" },
    { "beat": 3, "name": "覺醒鈎子", "purpose": "給出反殺線索" }
  ],
  "acting_rules": {
    "default_energy": "low",
    "tempo": "controlled",
    "forbidden": ["誇張哭喊與亂動", "動作無目的", "情緒悲傷但大笑"]
  },
  "action_dictionary": [
    {
      "action": "touch_lock_scratch",
      "trigger": "看到鎖扣磨痕",
      "objective": "確認是否能鬆動",
      "subtext": "我在找出口",
      "limits": "指腹輕觸一次，慢，停頓傾聽，不抓撓"
    }
  ],
  "micro_behavior_library": {
    "controlled_fear": ["下顎微繃", "吞咽一次", "呼吸短而不亂"],
    "cold_smile": ["嘴角一側上揚2mm，眼睛不笑"]
  }
}
```

---

## 注意

- 不要輸出 Markdown 解釋。
- 只輸出 JSON。
