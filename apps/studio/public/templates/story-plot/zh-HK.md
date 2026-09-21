# FizzDragon 情節樹 — 給 AI 的指令

將本檔案連同劇本和創作要求傳給你使用的 AI，讓它返回 `plot.json`，再在 FizzDragon 情節樹中點擊「匯入 JSON」。每個檔案匯入目前章節；預設新增一組獨立節點，可自行連接；勾選「覆蓋目前章節情節樹」則替換目前章節的節點和連線。覆蓋模式或空章節以 `entryNodeId` 為起點。章節裡既有的資產會保留，本檔案中的資產會追加寫入。

## 任務

將我的劇本轉換為以下 JSON 格式，保留原語言、劇情、對白、場景順序、分支選項和結局。除非我明確要求，不要概括、改寫或擅自新增分支。線性劇本可以只有場景節點。場景動作和對白放在 `description`，每次玩家選擇使用獨立的 decision 節點。資產和每條分鏡 clip 都要寫生產提示詞。只輸出有效的 UTF-8 JSON 檔案，不要 Markdown 程式碼圍欄、註解、末尾多餘的逗號或額外欄位。

## 格式約定

- 根物件：`entryNodeId`、`assets`、可選的 `stateVariables`、`nodes`。不要寫 version，也不要新增其他欄位。
- 狀態變數：`key`（穩定的點分隔識別碼）、`name`、`valueType`（`number` 或 `boolean`）、同類型的 `initialValue`，以及可選 `note`。最多 64 個。同一概念始終重用一個 key，不要建立 `courage_1` 一類編號副本。匯入會按 key 合併：類型和初始值一致時重用既有定義；發生衝突時會指出對應 JSON 路徑並拒絕匯入。
- 狀態效果：`{ "kind": "set", "key": "met", "value": true }` 或 `{ "kind": "add", "key": "courage", "amount": 1 }`。可放在任意節點的 `onEnterEffects`，或選項的 `effects`。
- 狀態條件：`{ "kind": "compare", "variableKey": "courage", "operator": "at-least", "value": 3 }`。可放在選項的 `visibleWhen`，或場景的可選 `routes` 中。場景路由格式為 `{ "when": 條件, "next": 節點ID或null }`，按順序判斷，最後走場景必填的 `next` 後備路由。
- 資產：`id`、`kind`（`character`、`location` 或 `prop`）、`name`（必填，最多 240 字元）、`description`（可選，最多 4,000 字元）、`imagePrompt`（必填，最多 12,000 字元）、`videoPrompt`（可選，最多 12,000 字元）、`negativePrompt`（可選，最多 4,000 字元）。最多 500 個資產。提示詞中不得出現 `@`。
- 場景：`id`、`type: "scene"`、`title`（必填，最多 120 字元）、`description`（可選，最多 4,000 字元）、`next`（目標節點 ID，結局為 `null`）、可選 `routes`、可選 `onEnterEffects`、可選 `storyboard`。`storyboard` 只有 `clips`。
- 分鏡：`id`、`kind`（`image` 或 `video`）、`title`（必填，最多 160 字元）、`durationMs`（整數，250–3,600,000）、`prompt`（必填，最多 12,000 字元）、`negativePrompt`（可選，最多 4,000 字元）。每個場景最多 100 條 clip。clip 按陣列順序播放，由 FizzDragon 累計 startMs。一個場景的 clip 總時長不能超過 3,600,000 毫秒。clip 提示詞中不得出現 `@`。不要寫資產引用或綁定。
- 選擇：`id`、`type: "decision"`、`prompt`、可選 `onEnterEffects`、`choices`（2–6 個）。每個選項包含 `label`、`next`，以及可選 `effects` / `visibleWhen`。結局用 `next: null` 的場景表達，選項目標不能為 null。
- ID 在各自範圍內必須唯一：1–64 個 ASCII 字元，英文字母開頭，後接字母、數字或 `_`，分組之間可用 `.`、`:`、`-`。節點 ID 在檔案內唯一，資產 ID 在檔案內唯一，clip ID 在所屬場景內唯一。所有引用的節點必須在本檔案中存在，所有節點都必須能從 `entryNodeId` 到達。分支可匯合到同一節點，無需複製節點。
- 保留有意義的節點順序和選項順序。文字中的換行用 `\n`，引號用 `\"` 轉義。不要截斷原文；超過欄位上限時拆成順序連接的多個場景。
- 每個檔案最多 500 個節點、2 MB。更長的故事拆為多個獨立完整的章節檔案，`next` 不得跨檔案引用。
- 不新增媒體連結、座標、`@` 提及、assetRefs 或其他欄位。FizzDragon 會匯入情節樹、狀態定義、資產規格和分鏡提示詞，不生成媒體。節點 ID 會在匯入時加上獨立命名空間，狀態 key 則保持穩定並重用。

## 範例

請用我的劇本替換示例；示例使用英文不代表輸出必須使用英文。

```json
{
  "entryNodeId": "arrival",
  "stateVariables": [
    {
      "key": "courage",
      "name": "勇氣",
      "valueType": "number",
      "initialValue": 0,
      "note": "面對困難選擇時累積的勇氣。"
    }
  ],
  "assets": [
    {
      "id": "mira",
      "kind": "character",
      "name": "Mira",
      "description": "A courier who finds a letter at dawn.",
      "imagePrompt": "Cinematic portrait of Mira, early thirties, dark coat, dawn light on her face.",
      "videoPrompt": "Mira stands still, coat shifting in a cold breeze.",
      "negativePrompt": "cartoon, extra fingers"
    },
    {
      "id": "hallway",
      "kind": "location",
      "name": "Boarding-house hallway",
      "imagePrompt": "Narrow wooden hallway at dawn, a sealed letter under the door."
    }
  ],
  "nodes": [
    {
      "id": "arrival",
      "type": "scene",
      "title": "The unopened letter",
      "description": "At dawn, Mira discovers a letter beneath the door.\nMira: “Who brought this?”",
      "next": "open_or_leave",
      "storyboard": {
        "clips": [
          {
            "id": "letter_still",
            "kind": "image",
            "title": "Letter under the door",
            "durationMs": 2000,
            "prompt": "A sealed letter on worn floorboards in dawn light."
          },
          {
            "id": "mira_turns",
            "kind": "video",
            "title": "Mira looks down",
            "durationMs": 4000,
            "prompt": "Mira looks down at the letter, then toward the empty hallway."
          }
        ]
      }
    },
    {
      "id": "open_or_leave",
      "type": "decision",
      "prompt": "What will Mira do?",
      "choices": [
        {
          "label": "Open the letter",
          "next": "truth",
          "effects": [{ "kind": "add", "key": "courage", "amount": 1 }]
        },
        {
          "label": "Leave it unopened",
          "next": "departure"
        }
      ]
    },
    {
      "id": "truth",
      "type": "scene",
      "title": "The truth",
      "description": "The letter reveals who has been waiting for her.",
      "next": null
    },
    {
      "id": "departure",
      "type": "scene",
      "title": "A fresh start",
      "description": "Mira leaves town without looking back.",
      "next": null
    }
  ]
}
```
