# 分集攝影聖經 (Episode Camera Bible)

> 目標：在「確定的場景 + 確定的人物 blocking + 確定的表演意圖」之上，讓 cameraman 的鏡頭語法**穩定且一致**。

---

## 必須包含（每集必填）

1. 本集鏡頭語法（Grammar）

- 壓迫：什麼景別/角度/距離最常用
- 線索：如何拍插入鏡頭/微距
- 鈎子：如何用推近/停頓/切黑完成

2. 機位錨點（Camera Anchors）

- 以場景錨點描述機位：門口視角/床邊/牆角/高位監控視角等。

3. 運鏡節奏（Movement Tempo）

- 本集整體偏穩定（或偏手持），並給出禁止項。

---

## 輸出格式（JSON only）

```json
{
  "episode": 1,
  "visual_style": {
    "stability": "stable",
    "dominant_sizes": ["MCU", "CU", "Insert"],
    "dominant_angles": ["EyeLevel", "HighAngle"],
    "movement_rules": ["static為主", "dolly_in用於鈎子", "跟拍只在走廊出現"]
  },
  "camera_anchors": [
    { "name": "DoorPOV", "description": "門外走廊向內看" },
    { "name": "LeftWallClose", "description": "左牆鎖扣微距" }
  ],
  "shot_grammar": {
    "pressure": {
      "sizes": ["MCU", "CU"],
      "angles": ["HighAngle"],
      "moves": ["static"]
    },
    "clue": {
      "sizes": ["Insert", "ECU"],
      "angles": ["EyeLevel"],
      "moves": ["slow_push_in"]
    },
    "hook": {
      "sizes": ["ECU"],
      "angles": ["EyeLevel"],
      "moves": ["very_slow_push_in", "cut_to_black"]
    }
  },
  "forbidden": ["同場景內機位左右180度亂跳", "無理由大幅運鏡"]
}
```

---

## 注意

- 不要輸出 Markdown 解釋。
- 只輸出 JSON。
