# FizzDragon 情節樹 — 給 AI 的指令

將本檔案連同劇本和創作要求傳給你使用的 AI，讓它返回 `plot.json`，再在 FizzDragon 情節樹中點擊「匯入 JSON」。每個檔案匯入目前章節；預設新增一組獨立節點，可自行連接；勾選「覆蓋目前章節情節樹」則替換目前章節的節點和連線。覆蓋模式或空章節以 `entryNodeId` 為起點。

## 任務

將我的劇本轉換為以下 JSON 格式，保留原語言、劇情、對白、場景順序、分支選項和結局。除非我明確要求，不要概括、改寫或擅自新增分支。線性劇本可以只有場景節點。場景動作和對白放在 `description`，每次玩家選擇使用獨立的 decision 節點。只輸出有效的 UTF-8 JSON 檔案，不要 Markdown 程式碼圍欄、註解、末尾多餘的逗號或額外欄位。

## 格式約定（版本 1）

- 根物件：`version`（固定為 `1`）、`entryNodeId`、`nodes`。
- 場景：`id`、`type: "scene"`、`title`（必填，最多 120 字元）、`description`（可選，最多 4,000 字元）、`next`（目標節點 ID，結局為 `null`）。
- 選擇：`id`、`type: "decision"`、`prompt`（必填，最多 4,000 字元）、`choices`（按顯示順序排列的 2–6 個選項）。每個選項包含 `label`（必填，最多 4,000 字元）和 `next`（已存在的節點 ID）。結局用 `next: null` 的場景表達，選項目標不能為 null。
- 節點 ID 必須唯一：1–64 個 ASCII 字元，英文字母開頭，後接字母、數字、`.`、`_`、`:` 或 `-`。所有引用的節點必須在本檔案中存在，所有節點都必須能從 `entryNodeId` 到達。分支可匯合到同一節點，無需複製節點。
- 保留有意義的節點順序和選項順序。文字中的換行用 `\n`，引號用 `\"` 轉義。不要截斷原文；超過欄位上限時拆成順序連接的多個場景。
- 每個檔案最多 1,000 個節點、2 MB。更長的故事拆為多個獨立完整的章節檔案，`next` 不得跨檔案引用。
- 不新增媒體連結、生成提示詞、座標、資產 ID 或其他欄位。FizzDragon 只建立可編輯骨架並自動排版。內部 ID 會在匯入時加上獨立命名空間，避免與已有節點及素材綁定衝突，原文、選項和拓撲關係保持一致。

## 範例

請用我的劇本替換範例；範例使用英文不代表輸出必須使用英文。

```json
{
  "version": 1,
  "entryNodeId": "arrival",
  "nodes": [
    {
      "id": "arrival",
      "type": "scene",
      "title": "The unopened letter",
      "description": "At dawn, Mira discovers a letter beneath the door.\nMira: “Who brought this?”",
      "next": "open_or_leave"
    },
    {
      "id": "open_or_leave",
      "type": "decision",
      "prompt": "What will Mira do?",
      "choices": [
        {
          "label": "Open the letter",
          "next": "truth"
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
