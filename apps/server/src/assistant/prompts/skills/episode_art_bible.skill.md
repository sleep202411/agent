# 分集美術聖經 (Episode Art Bible)

> 角色與環境與道具的「物理一致性」規則集：把本集所有鏡頭的空間、道具連接、服化道連貫寫死。
> 這份輸出會被 shot builder 注入到每個鏡頭的 description / Image_Prompt / Video_Prompt。

---

## 必須回答（每集必填）

0. **角色×服裝 LookToken 命名（跨系统协议）【新增】**

- LookToken = `角色名 + 服装名`（字符串拼接），例如：`Jason綠色西裝`、`Lily囚服`。
- **PropToken（道具Token）**：用 `@道具名` 标记镜头中关键道具/束缚/器具，例如：`@鐵鏈`、`@鎖扣`、`@注射器`、`@針桶`、`@籠車`、`@小刀`。
  - ⚠️ 仅允许**服化道/道具智能体识别或资产库中定义**的道具使用 @PropToken。
  - 禁止：把“针孔/右前臂/眼神”等身体部位或抽象概念写成 @。
- 多人镜头：允许多个 LookToken 并列；同理允许多个 PropToken 并列。
- 下游系统解析：从文本开头抓取连续的 `@Token` 列表（既包括人物LookToken，也包括道具PropToken）。

**强制输出规则（每个镜头都要）**：

- `description` / `Image_Prompt` / `Video_Prompt` 必须以 `@Token` 列表开头（后跟空格），再写正文。
  - 人物：`@角色名服装名`（LookToken）
  - 道具：`@道具名`（PropToken）
- 多人/多道具镜头示例：`@Jason綠色西裝 @Lily囚服 @咖啡杯 男人正在和女人一起喝咖啡...`
- token 之间以空格分隔；token 后至少一个空格再进入正文。

1. **核心場景錨點（Scene Anchors）**

- 以俯視/文字地圖方式描述：門、窗、小窗、床、牆面A/B/C/D、監控、桶、走廊方向。

2. **角色位置與姿態（Blocking）**

- 角色在場景中的固定位置：例如「左牆鐵環處」「床邊地面」「門內側陰影」。
- 姿態：跪/坐/靠/趴/站（必須與束縛相容）。

3. **道具↔環境關係（Prop↔Set）**

- 道具固定點：鎖鏈固定在哪個牆面/鐵環/床架。
- 道具物理參數：長度範圍（可達半徑）、是否可拖曳、是否上鎖。

4. **人↔道具關係（Human↔Prop）**

- 接觸點：右手腕/左手腕/腳踝/頸圈等。
- 可達範圍：手臂能伸到哪裡（避免「左牆被鎖卻摸到右牆」）。

5. **服化道連貫（Costume/Makeup Continuity）**

- 污漬/血跡/針孔的位置與程度（本集內保持一致或按事件升級）。

6. **禁止項（Forbidden）**

- 明確列出本集不可出現的物理矛盾。

---

## 輸出格式（JSON only）

必须提供允许的道具 token 清单（供下游 QC/注入）：

- `allowed_prop_tokens`: ["@鐵鏈","@鎖扣",...]

```json
{
  "episode": 1,
  "scene_anchors": {
    "map_text": "俯視圖文字描述",
    "anchors": ["Door", "SmallWindow", "LeftWallRing", "Bed", "Camera"]
  },
  "blocking_rules": {
    "default_position": "角色固定位置",
    "allowed_positions": ["..."],
    "forbidden_positions": ["..."],
    "pose_constraints": ["被鎖時只能坐地/靠牆，不能自由走動"]
  },
  "prop_set_rules": {
    "chains": {
      "anchor": "LeftWallRing",
      "connect_to": "RightWrist",
      "length": "short",
      "reach": "chest_only"
    },
    "bin": { "location": "CorridorOutsideDoor" }
  },
  "human_prop_rules": {
    "reach_limits": ["右手最多到胸前", "無法跨越房間"],
    "contact_points": ["右手腕金屬束縛"]
  },
  "costume_continuity": {
    "base_costume": "囚服",
    "marks": ["右前臂針孔（泛紅）"]
  },
  "forbidden": ["同一鏡頭內同時左牆被鎖又去觸摸右牆", "鎖扣固定點前後不一致"]
}
```

---

## 注意

- 不要輸出 Markdown 解釋。
- 只輸出 JSON。
