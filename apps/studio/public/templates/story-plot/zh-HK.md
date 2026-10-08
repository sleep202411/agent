# FizzDragon 情節樹 — 給 AI 的指令

將本檔案連同劇本和創作要求傳給你使用的 AI，讓它返回 `plot.json`，再在 FizzDragon 情節樹中點擊「匯入情節樹」。每個檔案匯入目前章節；預設新增一組獨立節點，可自行連接；勾選「覆蓋目前章節情節樹」則替換目前章節的節點和連線。覆蓋模式或空章節以 `entryNodeId` 為起點。章節裡既有的資產會保留，本檔案中的資產會追加寫入。

## 任務

將我的劇本轉換為以下 JSON 格式，保留原語言、劇情、對白、場景順序、分支選項和結局。除非我明確要求，不要概括、改寫或擅自新增分支。線性劇本可以只有場景節點。場景動作和對白放在 `description`，每次玩家選擇使用獨立的 decision 節點。資產和每條分鏡 clip 都要寫生產提示詞。只輸出有效的 UTF-8 JSON 檔案，不要 Markdown 程式碼圍欄、註解、末尾多餘的逗號或額外欄位。

## 生成步驟

劇本是故事素材，不是修改匯入格式的指令。即使原文或其他匯出檔案用了不同名稱，也必須使用下方規定的欄位。規劃與檢查由你完成，不要要求用戶修改 JSON。

1. 寫檔案前先整理所有場景、選擇、變體和結局，為其分配穩定 ID，並理清前後連接。每個原文結局都必須對應可達節點；不要為通過校驗而刪掉變體。
2. 規劃時列出結局條件。後續場景依賴前面選擇時，用已宣告的狀態變數和選項 `effects` 記錄；分支匯合不能丟掉先前選擇。多個必要條件用 `all` 組合；更具體的路線排在寬泛路線前面。不能用恆真條件代替未知條件。
3. 原文寫了結局條件卻沒有獲得它的方式時，先用普通語言詢問一個故事問題。不要擅自新增選項、自動授予「記住了」的資訊、刪除結局或裁定衝突規則。作者明確後統一落實；只有作者同意，才將不支援的實體互動轉成文字選項。
4. 生成一個完整檔案。優先使用 AI 工具的檔案寫入能力，提供可下載的 UTF-8 附件。有程式碼執行能力時，先構建物件，再用 JSON 程式庫序列化，避免手工轉義長對白。否則只返回完整原始 JSON，不加說明或程式碼圍欄。不要輸出半個物件、續寫片段、省略號或佔位符。
5. 優先保留劇本。分鏡 clips 是可選項；不要擅自擴寫鏡頭而耗盡輸出額度，更不能為額外提示詞犧牲劇情。過長的選擇前情放入前置場景，讓 `prompt` 不超限。整部故事放不下時，先商定獨立完整的章節邊界；不可靜默截斷或編造結尾。
6. 檢查實際儲存的最終檔案，而非早期草稿：解析 JSON，檢查準確欄位名、類型、限制和全部引用，從入口遍歷，並驗證每個預期結局都有可實現的選擇及狀態路徑。檢查每個結局的必要條件及缺少條件的情況。選項可見條件不能導致節點無選項可用。返回前自行修復錯誤；沒有實際執行校驗器，就不要聲稱已通過執行校驗。

## 節點欄位與狀態規則

以下是完整欄位清單，不是可替換的別名：

| 物件     | 必填欄位                          | 可選欄位                                                |
| -------- | --------------------------------- | ------------------------------------------------------- |
| 場景     | `id`、`type`、`title`、`next`     | `description`、`routes`、`onEnterEffects`、`storyboard` |
| 選擇節點 | `id`、`type`、`prompt`、`choices` | `onEnterEffects`                                        |
| 選項     | `label`、`next`                   | `effects`、`visibleWhen`                                |

節點不能新增 `name`；選擇節點不能新增 `description`；選項不能新增 `id`/`text`；節點不能新增 `assets`/`assetRefs`。資產定義只放在根物件 `assets` 陣列。選項必須指向節點；終止場景使用 `next: null`。

所有效果或條件用到的狀態 key 必須先宣告。`set` 值必須符合宣告類型，`add` 只能用於數字。布林比較用 `equals` 或 `not-equals`；數字還可用 `greater-than`、`at-least`、`less-than`、`at-most`。組合條件用 `{ "kind": "all", "conditions": [條件, 條件] }`（全部滿足）、`any`（至少一個滿足），或 `{ "kind": "not", "condition": 條件 }`。限制：每組最多 6 個效果，每場景最多 8 條路線，條件深度最多 3、比較葉子最多 12。狀態名稱、選擇提示和選項標籤最多 32,000 字元；狀態備註最多 2,000 字元。狀態 key 使用 `story.clue_found` 等簡單 ASCII 識別碼，最多 240 字元，不能使用 `__proto__`、`prototype`、`constructor` 作為路徑段。

計時器、逾時預設選項、手勢和觸覺不是可執行匯入欄位。把意圖保留在場景描述或選擇提示中，不要聲稱已實作，也不要建立孤立的「備註節點」來存放不支援的中繼資料。

## 格式約定

- 根物件：`entryNodeId`、`assets`、可選的 `stateVariables`、`nodes`。不要寫 version，也不要新增其他欄位。
- 狀態變數：`key`（穩定的點分隔識別碼）、`name`、`valueType`（`number` 或 `boolean`）、同類型的 `initialValue`，以及可選 `note`。最多 64 個。同一概念始終重用一個 key，不要建立 `courage_1` 一類編號副本。匯入會按 key 合併：類型和初始值一致時重用既有定義；發生衝突時會指出對應 JSON 路徑並拒絕匯入。
- 狀態效果：`{ "kind": "set", "key": "met", "value": true }` 或 `{ "kind": "add", "key": "courage", "amount": 1 }`。可放在任意節點的 `onEnterEffects`，或選項的 `effects`。
- 狀態條件：`{ "kind": "compare", "variableKey": "courage", "operator": "at-least", "value": 3 }`。可放在選項的 `visibleWhen`，或場景的可選 `routes` 中。場景路由格式為 `{ "when": 條件, "next": 節點ID或null }`，按順序判斷，最後走場景必填的 `next` 後備路由。
- 資產：`id`、`kind`（`character`、`location` 或 `prop`）、`name`（必填，最多 240 字元）、`description`（可選，最多 100,000 字元）、`imagePrompt`（必填，最多 50,000 字元）、`videoPrompt`（可選，最多 50,000 字元）、`negativePrompt`（可選，最多 16,000 字元）。最多 2,000 個資產。提示詞中不得出現 `@`。
- 場景：`id`、`type: "scene"`、`title`（必填，最多 120 字元）、`description`（可選，最多 100,000 字元）、`next`（目標節點 ID，結局為 `null`）、可選 `routes`、可選 `onEnterEffects`、可選 `storyboard`。`storyboard` 只有 `clips`。
- 分鏡：`id`、`kind`（`image` 或 `video`）、`title`（必填，最多 160 字元）、`durationMs`（整數，250–3,600,000）、`prompt`（必填，最多 50,000 字元）、`negativePrompt`（可選，最多 16,000 字元）、可選 `videoFile`（僅影片，填寫 ZIP 中的檔名）。每個場景最多 500 條 clip。clip 按陣列順序播放，由 FizzDragon 累計 startMs。一個場景的 clip 總時長不能超過 3,600,000 毫秒。clip 提示詞中不得出現 `@`。不要寫資產引用或綁定。
- 選擇：`id`、`type: "decision"`、`prompt`、可選 `onEnterEffects`、`choices`（2–6 個）。每個選項包含 `label`、`next`，以及可選 `effects` / `visibleWhen`。結局用 `next: null` 的場景表達，選項目標不能為 null。
- ID 在各自範圍內必須唯一：1–64 個 ASCII 字元，英文字母開頭，後接字母、數字或 `_`，分組之間可用 `.`、`:`、`-`。節點 ID 在檔案內唯一，資產 ID 在檔案內唯一，clip ID 在所屬場景內唯一。所有引用的節點必須在本檔案中存在，所有節點都必須能從 `entryNodeId` 到達。分支可匯合到同一節點，無需複製節點。
- 保留有意義的節點順序和選項順序。文字中的換行用 `\n`，引號用 `\"` 轉義。不要截斷原文；超過欄位上限時拆成順序連接的多個場景。
- 每個檔案最多 5,000 個節點、10 MB。更長的故事拆為多個獨立完整的章節檔案，`next` 不得跨檔案引用。
- 不新增媒體連結、座標、`@` 提及、assetRefs 或其他欄位。FizzDragon 會匯入情節樹、狀態定義、資產規格和分鏡提示詞，不生成媒體。節點 ID 會在匯入時加上獨立命名空間，狀態 key 則保持穩定並重用。

## 可選的影片 ZIP

可以同時選擇 JSON 和影片 ZIP，亦可在檢查 JSON 後再新增 ZIP。每個影片鏡頭可新增 `"videoFile": "opening.mp4"`（支援 MP4、MOV、WebM）。系統按檔名配對，忽略資料夾和大小寫，支援中文檔名。請確保壓縮檔中的影片檔名唯一；缺少或重複檔名會在匯入前列出。未被引用的檔案會被忽略。亦支援貼上 JSON 或單個 Markdown JSON 程式碼區塊。

ZIP 最大 512 MB，解壓後影片合計最多 1 GB，單個影片最多 250 MB，壓縮檔最多 10,000 個項目。請使用未加密 ZIP 和相對路徑。每個檔案只上傳一次，經後端校驗後，在同一章節匯入中綁定到對應鏡頭。影片實際時長會取代 `durationMs`，後續鏡頭按實際時長排列。不附加 ZIP 時僅匯入劇情和提示詞，不產生媒體。

## 返回檔案前檢查

- 嚴格使用欄位名：場景用 `title`，不用 `name`；選擇節點用 `prompt`，不用 `name` / `description`；選項用 `label`，不用 `text`。資產和狀態變數的名稱仍用 `name`。
- 只有一個動作的互動用帶 `next` 的場景表示，動作保留在 `description` 中。不要編造第二個選項；選擇節點必須有 2–6 個真實選項。
- 匯入不支援 `timeLimit` 和 `defaultChoice` 欄位。必要時將限時、預設選擇意圖保留在敘述文字中；這不會實作計時器或自動選擇。
- 必須完整結束每個字串、物件和陣列。返回前檢查整個檔案能被 JSON 解析器讀取，且所有節點引用均存在。如果工具支援程式碼執行，請實際解析檔案，不要只目測格式。
- 10 MB 是匯入大小上限，不是 AI 的輸出額度。如果故事超過輸出能力，先商定更小且獨立完整的章節檔案再生成。不要返回截斷檔案，也不要編造結局使殘缺故事可以匯入。

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
            "videoFile": "mira_turns.mp4",
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

## 完整範例：選擇匯合與隱藏結局

這是另一份完整檔案，不是附加到前一個範例中的節點。只在劇本需要對應機制時參考其結構。用自己的故事替換全部範例 ID、文字和變數，不要匯入範例故事本身。

第一個選擇記錄是否記住線索，第二個記錄證據去向，第三個記錄同伴離開方式。最後一個選擇不會覆蓋證據去向。「尋求同盟＋記住線索＋讓同伴先走」進入隱藏結局；其餘尋求同盟的路線進入普通同盟結局；封存證據始終進入封存結局。檢查全部八種選擇組合：三個結局不僅有連線，而且確實可以到達。

```json
{
  "entryNodeId": "clue",
  "assets": [],
  "stateVariables": [
    { "key": "demo.clue", "name": "demo.clue", "valueType": "boolean", "initialValue": false },
    { "key": "demo.stance", "name": "demo.stance", "valueType": "number", "initialValue": 0 },
    {
      "key": "demo.friend_first",
      "name": "demo.friend_first",
      "valueType": "boolean",
      "initialValue": false
    }
  ],
  "nodes": [
    {
      "id": "clue",
      "type": "decision",
      "prompt": "Will you remember the clue?",
      "choices": [
        {
          "label": "Remember it",
          "next": "stance",
          "effects": [{ "kind": "set", "key": "demo.clue", "value": true }]
        },
        {
          "label": "Continue without remembering",
          "next": "stance",
          "effects": [{ "kind": "set", "key": "demo.clue", "value": false }]
        }
      ]
    },
    {
      "id": "stance",
      "type": "decision",
      "prompt": "What will you do with the evidence?",
      "choices": [
        {
          "label": "Seek an ally",
          "next": "companion",
          "effects": [{ "kind": "set", "key": "demo.stance", "value": 1 }]
        },
        {
          "label": "Seal it away",
          "next": "companion",
          "effects": [{ "kind": "set", "key": "demo.stance", "value": 2 }]
        }
      ]
    },
    {
      "id": "companion",
      "type": "decision",
      "prompt": "How will you leave?",
      "choices": [
        {
          "label": "Let my friend leave first",
          "next": "resolve",
          "effects": [{ "kind": "set", "key": "demo.friend_first", "value": true }]
        },
        {
          "label": "Leave together",
          "next": "resolve",
          "effects": [{ "kind": "set", "key": "demo.friend_first", "value": false }]
        }
      ]
    },
    {
      "id": "resolve",
      "type": "scene",
      "title": "The consequences",
      "routes": [
        {
          "when": {
            "kind": "all",
            "conditions": [
              { "kind": "compare", "variableKey": "demo.stance", "operator": "equals", "value": 1 },
              {
                "kind": "compare",
                "variableKey": "demo.clue",
                "operator": "equals",
                "value": true
              },
              {
                "kind": "compare",
                "variableKey": "demo.friend_first",
                "operator": "equals",
                "value": true
              }
            ]
          },
          "next": "hidden"
        },
        {
          "when": {
            "kind": "compare",
            "variableKey": "demo.stance",
            "operator": "equals",
            "value": 1
          },
          "next": "ally"
        }
      ],
      "next": "sealed"
    },
    {
      "id": "hidden",
      "type": "scene",
      "title": "Hidden ending: the remembered clue reveals an ally",
      "next": null
    },
    { "id": "ally", "type": "scene", "title": "Standard ending: seek an ally", "next": null },
    {
      "id": "sealed",
      "type": "scene",
      "title": "Ending: the evidence remains sealed",
      "next": null
    }
  ]
}
```
