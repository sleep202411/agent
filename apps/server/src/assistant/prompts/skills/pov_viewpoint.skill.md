# POV/視角 Skill（分鏡提示詞必備）

> 用途：讓分鏡的 Image_Prompt / Video_Prompt **一定包含明確視角（POV）與角度（angle）**，並且能根據鏡頭內容「自己判斷選哪一種」而不是漏寫。

---

## 1) 核心規則（必須遵守）

- **每一鏡都必須寫 POV/angle**（至少一個）：
  - POV：first-person POV / over-the-shoulder (OTS) / objective camera / surveillance POV / handheld POV
  - angle：eye-level / low angle / high angle / top-down / worm’s-eye / Dutch angle

- POV/angle 需要與敘事目的匹配：
  - **壓迫/弱者**：high angle / top-down + tighter framing
  - **強勢/反擊爽點**：low angle + punchy composition
  - **情緒脆弱/秘密**：OTS + shallow depth of field
  - **恐怖/未知**：POV + obstructed view / partial framing
  - **信息揭示/轉折**：rack focus / reveal framing

- **不能亂用**：同一場景連續多鏡若沒有敘事動機，不要每鏡都換 POV；要保持語法一致。

---

## 2) 自動選擇（你要自己去找）

根據鏡頭骨架字段自動判斷：

- 如果 `shot_type` 是「特寫/近景」：優先 eye-level 或 OTS（除非要壓迫/爽點）
- 如果 `movement` 有 handheld/抖动：可以用 handheld POV 或 objective handheld
- 如果 `mood` 包含：壓抑/恐懼/危險 → high angle / Dutch angle
- 如果 `mood` 包含：爽/反擊/勝利/宣言 → low angle
- 如果 `description` 提到「看向某物/盯著/窥视/偷看」→ POV or OTS

---

## 3) 写法模板（直接可复制）

### Image_Prompt 必含片段

- "medium close-up, over-the-shoulder, eye-level" 或
- "wide shot, objective camera, high angle" 或
- "close-up, first-person POV, low angle"

### Video_Prompt 必含片段

- "handheld over-the-shoulder" / "steadicam eye-level" / "dolly-in low angle" 等

---

## 4) 质量自检

- [ ] Image_Prompt 有 POV/angle（至少一个）
- [ ] Video_Prompt 有 POV/angle（至少一个）
- [ ] 选择有叙事动机（压迫/爽点/窥视/揭示）
- [ ] 同场景语法一致，不无故乱换
