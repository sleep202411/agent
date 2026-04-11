# 分镜导入与格式归一化（Storyboard Import & Normalize）

> 目标：把用户上传的分镜表（Excel/CSV/JSON）解析为系统统一的分镜 Shot schema，确保可 merge、可补全 Prompt、可导出。

---

## A. 支持输入

1. **Excel/CSV 表格**

- 可能是你们的“标准模板”（含 Scene No./Shot No. 或 场景号/镜头号）
- 也可能是任意列名、顺序不同、缺列

2. **JSON**

- 可能是数组 shots
- 或 `{ episode, storyboard:[...] }`

---

## B. 系统统一输出 Shot Schema（必须）

每条镜头必须输出为：

```json
{
  "scene_no": 1,
  "shot_no": 1,
  "scene": "",
  "time": "",
  "lighting": "",
  "mood": "",
  "character": "",
  "action": "",
  "dialogue": "-",
  "movement": "",
  "shot_type": "",
  "description": "",
  "Image_Prompt": "",
  "Video_Prompt": ""
}
```

规则：

- `scene_no`/`shot_no` 为整数，缺失必须补。
- 无对白 `dialogue` = "-"。
- Prompt 可为空（后续补足），但字段必须存在。

---

## C. 列名映射（导入时）

把用户列名映射到统一字段：

- 场景号 / Scene No. / scene / scene_no → `scene_no`
- 镜头号 / Shot No. / shot / shot_no → `shot_no`
- 场景地点 / Location / Scene / 场景 → `scene`
- 时间 / Time → `time`
- 光线 / Lighting → `lighting`
- 氛围 / 情绪 / Mood → `mood`
- 角色 / Character(s) → `character`
- 动作 / Action / Beat → `action`
- 对白/旁白 / Dialogue / VO → `dialogue`
- 运镜 / Movement / Camera Movement → `movement`
- 景别 / Shot Size / Shot Type → `shot_type`
- 画面描述 / Description / Visual → `description`
- Image Prompt / Image_Prompt → `Image_Prompt`
- Video Prompt / Video_Prompt → `Video_Prompt`

若同一个目标字段出现多个候选列：

- 优先选择更“具体”的（例如 description > visual）。

---

## D. scene_no/shot_no 缺失时的补号规则

1. 若只有“镜头序号”一列：

- 设为 `shot_no`
- `scene_no` 统一为 1

2. 若没有任何序号：

- 按行号生成：`scene_no=1, shot_no=行号`

3. 若有“场景号”但缺“镜头号”：

- 以同一 `scene_no` 内按出现顺序补 `shot_no` 从 1 开始

---

## E. 质量检查（导入后必须跑）

- [ ] 每条 shot 都有 `scene_no`/`shot_no`
- [ ] `scene_no+shot_no` 唯一（冲突则重排或合并）
- [ ] `description` 不为空（若为空，用 `scene+action+dialogue` 生成一句描述）
- [ ] Prompt 字段存在（即便为空）

---

## F. 输出格式（纯 JSON）

导入/归一化后的输出必须是：

```json
{
  "episode": 1,
  "episode_title": "",
  "storyboard": [ { ...shot schema... } ],
  "stats": {
    "total_shots": 0,
    "missing_prompts": 0,
    "missing_description": 0
  }
}
```

只输出 JSON，不要任何解释。
