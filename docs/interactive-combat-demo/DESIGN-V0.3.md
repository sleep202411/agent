# 《3D 国风漫剧高交互战斗 Demo》设计文档 V0.3(精编权威版)

> **已由 V0.4 取代。** 权威版见 [`DESIGN-V0.4.md`](./DESIGN-V0.4.md)。本文仅作演进对照。

> **产品形态:** 约 30 秒 3D 国风漫剧互动战斗 Prototype
> **核心目的:** 验证「视频本身可以成为高交互战斗载体」
> **内容类型:** 纯打斗、纯炫技、极低叙事(无世界观/历史/地点/前史/对白)
> **核心理念:** **Video Timeline = Game State** —— 玩家操作直接控制视频时间轴与下一段影片
> **一句话:** 30 秒,4 次玩家介入,一场连续死斗;滑动、选择、蓄力和终结操作都会直接改变下一段影片。
> **宣传语:** 你的每次操作,都会改变下一秒。/ Every move changes the next shot.
> **优先级:** 交互体验 > 战斗爽感 > 视频节点连续性 > 视觉炫技 > 剧情

## 1. 视觉定位

**高品质 3D 国风武侠漫剧**。Style Anchor 基线(EN,生成前缀):

```text
High-end stylized 3D Chinese wuxia animation, mature Eastern character design,
premium semi-toon rendering, cinematic non-photorealistic lighting, strong silhouettes,
clean high-contrast image, expressive cloth and hair dynamics, fast readable
martial-arts choreography, dramatic camera movement, polished animated-series quality,
controlled visual effects.
```

- 3D、非真人、非照片写实、半卡通半写实;成年东方比例;强轮廓;强运镜;动作清晰;画面干净;特效克制但有冲击力。
- **禁止:** 真人演员感/Photoreal/古装剧/古偶美颜/UE 超写实 CG/普通游戏过场/低幼 3D/萌系/纯 2D 平面/仙侠法术/剑气波/万剑齐发/法阵/灵力爆炸/粒子海/特效盖住动作。

## 2. 舞台与角色

**极简国风战斗舞台:** 深黑/深青灰背景、微反光地面、少量雾气、少量巨型柱体、布幔、极简灯火、冷月或抽象圆形光源、极弱中国建筑剪影。人物+武器+交互视觉才是主体;背景只建立空间、光影、运镜参照、干净的交互提示区。

- **PLAYER|黑衣刀客:** 成年东方男性,黑/深墨,成熟冷峻,强肩腰轮廓,长刀/单刃刀。战斗语言:稳、狠、准、反应快。
- **ENEMY|白衣银甲武者:** 白/银灰,与 PLAYER 强烈反差,长剑或长枪,白发或面具强化轮廓,主动攻击,身法更快。战斗语言:快、凶、持续压迫。

## 3. 动作与炫技语言

攻防链:攻击→防御→位移→失衡→反击→重新压制。必须体现重心/惯性/武器轨迹/攻击防御方向/受力/身体旋转/滑动/失衡/反制/连续追击。

允许:Fast Push-in、Lateral/Low-angle Tracking、Weapon Follow、Whip Pan、Speed Ramp、Impact Frame、Motion Blur、短残影、90°–180° Orbit、Hidden Cut、强透视、极近武器压迫、短暂时间膨胀。
禁止:整段 360° 乱转、场景瞬移、无重量飞行、特效代替动作、看不清谁在打谁。

## 4. 三种交互模式(核心抽象)

| 模式           | 核心问题                         | 形态                                                                     |
| -------------- | -------------------------------- | ------------------------------------------------------------------------ |
| TYPE A TRIGGER | 玩家有没有在正确时间完成动作?    | Swipe(→/↓)、Tap,窗口+超时,成功 CONTINUE/失败 FAIL                        |
| TYPE B SELECT  | 玩家选哪一个结果?                | 点击不同视频区域,双分支都活着                                            |
| TYPE C CONTROL | 玩家是否直接控制 Video Timeline? | **HOLD/CHARGE:按住=视频播放,松手=停止推进+触发判定,蓄力值≈视频播放进度** |

### Hold/Charge 实现契约(charge.mp4 = 1.5s 示例)

```text
0.00 开始蓄力 → 0.30 手臂逐渐发力 → 0.60 兵器剧烈震动 → 0.90 敌人开始失去优势
→ 1.20 PLAYER 开始压过 → 1.50 满蓄力
```

- `pointerDown → charge.mp4.play()`;持续按住 = 持续前进;`pointerUp → 读取当前播放位置 → 决定结果`。**播放进度本身就是蓄力进度。**
- 第一版只做 FAIL/SUCCESS 二值(Hold ≥ 1.0s 成功);未来可扩展 WEAK/NORMAL/STRONG/PERFECT 四级接四段结果视频(非 MVP)。
- **Release/Branch Marker:** 松手不硬切。`0.00─0.50─1.00─1.50`(M1/M2/M3);0.73s 松手 → 记录结果 → 视频继续到最近安全 Marker(如 M2=1.00s)→ 再切结果视频。**玩家决定结果的时间 ≠ 真正切片时间。**

### 切换原则(所有输入通用)

```text
INPUT → 记录结果 → 继续当前视频 → 到 Safe Branch Frame → 切目标视频
```

例:03.47 右滑 → 03.47 锁存 SUCCESS → 03.47–04.00 Resolve → 04.00 固定切点进 combat_02。

## 5. 视觉职责切分

**全部 UI 烘焙进视频**(播放器不画 QTE UI/Choice UI/蓄力条):

- 视频负责:人物/动作/摄影机/灯光/特效/Slow-Mo/Speed Ramp/Motion Blur/QTE 箭头/交互文字/Choice UI/Hold 视觉/蓄力进度/提示出现消失/成败反馈/音效。**凡是玩家看得见、听得到的,都优先属于视频。**
- 播放器只负责:Timeline/Input/Swipe/Pointer Down-Up/Hit Region/Interaction Window/Timeout/当前视频时间/Charge Duration/State/Branch/Retry。
- 理由:这是高完成度产品 Showcase,不是需要多 Skin 多语言的正式系统;视觉表现 > UI 动态配置能力。可实现:箭头由刀光生成、「右滑」跟运动轨迹出现、「守/破」成为构图一部分、「蓄」字与发力同步、进度与人物动作完全同步、UI 消失与 Speed Ramp 同步。

### 交互视觉设计原则

- **Swipe:** 箭头由武器运动轨迹/国风笔触/高亮线/空气划痕形成。
- **Choice:** 选项占据动作空间——「守」厚、沉、向内;「破」尖、快、向外。
- **Hold:** 不要普通蓝色进度条。可用「蓄」字逐渐完整/武器光泽逐渐集中/笔触聚拢/地面纹理扩张/环形国风纹样闭合。必须一眼看出需要持续按住,可明确显示「按住 · 蓄力」。

### 提示时间与输入时间分离

```text
03.10 提示动画开始 → 03.20 箭头基本形成 → 03.25 Input Window Open
→ 03.90 Input Window Close → 04.00 Branch Frame
```

`visualPromptStart ≠ inputStart`,推荐提前 **80–150ms** 给玩家视觉预判。

## 6. 30 秒主路径

| 时间        | 内容                                                                                         | Interaction                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00:00–00:03 | 爆发开场(黑场 0.3–0.5s,「铛!!!」先声,画面即亮,已在中近身搏杀,不介绍不解释不摆 Pose)          | —                                                                                                                                                     |
| 00:03–00:07 | 致命横斩                                                                                     | **I01 Swipe →**(25–30% Hold,刀光轨迹形成「→右滑」提示,0.1–0.2s 内可理解;成功→combat_02,超时→fail_01)                                                  |
| 00:07–00:13 | 连续缠斗(回身格挡→追击→双兵器相压→肩撞→被逼退;横向跟随/Weapon Follow/短 Whip/一次很短半环绕) | —                                                                                                                                                     |
| 00:13–00:17 | 战术抉择                                                                                     | **I02 Choice 守/破**(Tactical Hold;守=正面格挡被震退,injured=true;破=侧身压兵器撞重心,injured=false;两支随后都进 Charge)                              |
| 00:17–00:23 | 兵器对抗                                                                                     | **I03 Hold/Charge**(时间放缓,画面中心/PLAYER 侧出现「蓄」「按住蓄力」+国风蓄力表现;声音压低剩震动/呼吸/低频/心跳;满蓄瞬间恢复常速爆发,压制→蓄力→爆发) |
| 00:23–00:26 | 高潮反制(推开兵器→肩撞→刀柄重击→转体→抢回中心线;ENEMY 连续被逼退露出破绽)                    | —                                                                                                                                                     |
| 00:26–00:30 | 最终终结                                                                                     | **I04 Choice 斩/制**(不是反应测试,是决定怎么赢)                                                                                                       |

- **Ending A|斩(强攻):** 压开武器→转身重斩→极短 Impact Frame→猛烈击退→镜头快拉。力量、暴力、爽。
- **Ending B|制(技巧):** 让过最后攻击→侧步绕身侧/后侧→刀锋停在喉前→声音抽空。冷静、技术、帅。
- 结尾二选一:Showcase 版黑场「你的每次操作,都会改变下一秒。INTERACTIVE COMBAT」;极简试玩版终结动作完成直接结束无文字。

### 状态影响蓄力(30 秒内证明前次选择改变后次玩法)

- 之前选「守」(injured):需 **Hold 1.2s** 成功;
- 之前选「破」(healthy):只需 **Hold 0.9s**。

## 7. 主分支结构与视频节点(~11 clips)

```text
COMBAT_01 → SWIPE ─┬─ FAIL → F01(fail_swipe)
                   └─ SUCCESS → COMBAT_02 → SELECT ─┬─ 守 → choice_block(injured)
                                                      └─ 破 → choice_counter(healthy)
                                                          ↓(短时间后可汇合)
                                                        CHARGE ─┬─ FAIL → F02(fail_charge)
                                                                └─ SUCCESS → COMBAT_03
                                                                    ↓ FINAL SELECT ─┬─ 斩 → END_A(ending_power)
                                                                                    └─ 制 → END_B(ending_technique)
```

CONTINUE:combat_01、combat_02、choice_block、choice_counter、charge、charge_success、combat_final、ending_power、ending_technique;FAIL:fail_swipe、fail_charge。
压缩成本方案:choice_block/choice_counter 很短后重新汇合到同一 charge 节点。

## 8. 交互元数据契约(编辑器/运行时的权威格式)

```json
// Hold
{ "video": "charge.mp4", "interaction": { "type": "hold", "visualPromptStart": 0.15,
  "inputStart": 0.25, "successThreshold": 1.0, "maxDuration": 1.2, "branchAt": 1.2,
  "success": "charge_success", "fail": "fail_charge" } }
// Swipe
{ "video": "combat_01.mp4", "interaction": { "type": "swipe", "direction": "right",
  "visualPromptStart": 3.1, "inputStart": 3.25, "inputEnd": 3.95, "branchAt": 4.0,
  "success": "combat_02", "timeout": "fail_swipe" } }
// Choice
{ "video": "combat_02.mp4", "interaction": { "type": "select", "inputStart": 5.4,
  "inputEnd": 6.5, "branchAt": 6.6, "regions": { "left": "choice_block", "right": "choice_counter" } } }
```

## 9. 连续性纪律

- **视频节点连续性:** 每段记录 PLAYER/ENEMY 屏幕位置、朝向、武器手/角度、重心、机位高度/运动方向、光照方向、当前速度、衣动态、特效状态;上段尾帧必须能接下段首帧。
- **隐藏切片:** 优先 Whip Pan/Motion Blur/武器掠镜/人物掠镜/黑衣遮满镜头/强 Impact Frame/快速推近/短暗场/极短高亮/烟雾遮挡。玩家应感觉战斗是连续的,而不是在播几个 MP4。
- **声音连续性:** 跨 Clip 环境底噪/碰撞声跨切点/Beat 持续;Hold 时 Low-pass,Charge 逐渐压高频,Full Charge 瞬间恢复;Impact Sound 覆盖切点。Charge 的声音必须让玩家感觉「我正在把力量按出来」。

## 10. 核心技术抽象与验证

```text
VIDEO NODE + TIMELINE INTERACTION EVENT + BRANCH EDGE + PLAYER STATE
```

试玩验证:

- 交互:Swipe 是否直觉/Choice 是否清晰/Hold 是否让用户理解「按住就是蓄力」/能否感觉直接控制视频/状态继承是否可察觉;
- 视频:节点切换是否无感/UI 是否真融进视频/Hold 是否平滑/提前松手失败转场是否自然/满蓄爆发是否够爽;
- 体验终问:「刚才你是在看一段动画,还是在控制一场战斗?」目标答案:「在控制战斗。」

最终产品定义:**一个约 30 秒的高品质 3D 国风漫剧互动战斗 Prototype,通过 Swipe、Choice 与 Press-to-Play Hold 等高密度交互,让玩家直接控制 Video Timeline,并通过视频节点分支改变下一秒发生的战斗。**

# Video Timeline Is Gameplay.
