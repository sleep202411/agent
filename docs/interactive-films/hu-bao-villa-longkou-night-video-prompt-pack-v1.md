# 《虎豹别墅：龙口入夜》双模型导演级提示词包 v1.6

> 状态：PROMPT LOCK 候选稿；本地参考图候选已存在，完成人工审核和版本登记前禁止提交视频生成  
> 上游准源：[故事策划圣经 v1.2](./hu-bao-villa-longkou-night-story-bible-v1.md)  
> 目标：为 21 段正式视频预先锁定逐秒动作、参考图职责、连续性、口型表演和拒收条件  
> 本文只定义生产提示词，不生成图片、视频、声音或供应商任务
> v1.1 修订：严格区分 Omni 与 Frame 模式；引入 JF-01–05；全部任务统一为 15 秒  
> v1.2 修订：把逐秒分镜升级为导演级表演脚本；增加微表演、生理反应、物理因果、焦点变化、情绪曲线与结束状态合同
> v1.3 修订：S06A–D 末帧增加统一的非叙事结局确认停点；不改变视频任务数、时长或提示词输入模式
> v1.4 修订：绑定参考图生产指南；REF-08 拆分展览/地铁文件版本；统一 S02A/B 在 JF-02 的耳塞状态
> v1.5 修订：生产模型改为 HappyHorse 1.1 + Wan 2.7；8 段使用 HappyHorse，13 段首尾帧任务使用 Wan 2.7
> v1.6 修订：按官方字符上限固化实际提交规则；增加 S00 可直接提交提示词；压缩通用负向提示词并禁止供应商静默截断

角色、场景、道具与锁定帧见：[《参考图生产指南 v1.0》](./hu-bao-villa-longkou-night-reference-image-guide-v1.md)。手工执行顺序、文件命名、逐条验收与外部归档见：[《21 段双模型视频手工生产执行手册 v1.2》](./hu-bao-villa-longkou-night-video-production-runbook-v1.md)。

## 1. 使用方式

每条任务由九部分组成：

1. **生成模式**：每条任务只能选择 `HappyHorse 1.1 R2V`、`HappyHorse 1.1 I2V` 或 `Wan 2.7 First + Last Frame` 之一。
2. **模型输入**：只列本次真正提交给对应模型的图片；首尾帧任务不得再附加人物、场景或道具参考图。
3. **生产依赖**：列出制作首帧、尾帧或 Join Frame 时必须使用的角色、场景和道具母版；这些依赖不重复提交给视频模型。
4. **Positive prompt**：定义整镜头构图、人物、空间、光线、物理逻辑与最终画面目标。
5. **Emotional arc**：明确情绪从何种状态进入、在哪一拍转折、以何种状态离开，避免模型只执行动作而没有表演逻辑。
6. **Shot timeline**：用绝对秒数锁定景别、运镜、焦点、动作、微表演、生理反应、口型窗口和环境反馈。
7. **End-state contract**：锁定末帧人物站位、视线、手中道具、湿度、伤痕、焦点和 UI 安全区。
8. **Hard negatives**：除全局禁区外，逐镜头排除最容易发生的错误表演、错误物理和错误连续性。
9. **验收重点**：按叙事信息、表演可信度和下游可衔接性验收，而不是只按画面观感验收。

正式 manifest 的编译顺序必须保持：`positive → Shot timeline → Hard negative constraints`。HappyHorse R2V 使用 `[Image N]`；HappyHorse I2V 使用 `[Start Frame]`；Wan 2.7 首尾帧任务使用 `[Start Frame]` / `[End Frame]`。三种输入模式互斥。

`Emotional arc`、`End-state contract`、验收重点和补充轨是导演与验收合同，不直接提交给视频模型。默认提交内容为“全局正向前缀 + 本镜头 Positive prompt + Shot timeline”；如果镜头另有 `Submission prompt`，则只提交该代码块，不再拼接全局前缀。最终正向提示词控制在 4800 字符以内，独立负向提示词控制在 500 字符以内，禁止依赖供应商自动截断。

## 2. 全局生成合同

| 参数     | 锁定值                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------- |
| 模型分工 | HappyHorse 1.1 R2V：S00、E01–E03；HappyHorse 1.1 I2V：S06A–D；Wan 2.7 首尾帧：S01A–S05C、E04            |
| 模型 ID  | `happyhorse-1.1-r2v`；`happyhorse-1.1-i2v`；`wan2.7-i2v-2026-04-25`                                     |
| 生成输出 | 1920×1080、16:9、H.264/MP4、no watermark；HappyHorse 原生 24 fps，Wan 2.7 原生 30 fps                   |
| 交付输出 | 统一转制为 1920×1080、16:9、24 fps CFR、H.264、无音轨；转制不得裁切、改变时长或破坏锁定首尾帧           |
| 时长     | S00–S06、E01–E04 全部为 15s；任意完整路径恰好 120s                                                      |
| 摄影风格 | 克制的写实电影感；潮湿热带夜景；低饱和灰绿现实层、褪色橙绿回声层                                        |
| 音频策略 | HappyHorse/Wan 的原生音轨不进入母版；锁定对白、锣、环境和音乐在画面通过后独立制作与混音                 |
| 口型策略 | 画面内角色按标注窗口形成自然说话动作；画外音不驱动任何人口型；生成音轨无论质量如何均丢弃                |
| 交互停点 | S00–S05 最后 2 秒保留稳定中景／特写供 HTML 选择层覆盖；S06A–D 最后 2 秒同样稳定，供“继续进入结局”层覆盖 |
| 字幕     | 永不烘焙；中央下方保留安全区，不生成文字、菜单、片名或伪 UI                                             |

### 2.1 全局正向前缀

以下前缀默认拼接到每条 positive prompt 之前：

```text
Create one continuous restrained live-action cinematic shot for a supernatural interactive film set after closing time in a humid Singapore sculpture garden inspired by Haw Par Villa. Photorealistic human performances, physically plausible lighting, moisture and camera motion. Present-day reality uses desaturated grey-green sodium-vapour night lighting; the 1994 Dragon World echo uses faded orange and aged green practical bulbs, never cyberpunk neon. Supernatural events appear through reflections, old lights, sound-motivated reactions and translucent visitor traces, never through fantasy particles or fleshy body horror. Preserve exact character identity, costume, prop state, screen direction and wetness from the declared input frame or ordered R2V reference pack. Landscape 16:9, composed for lower-centre subtitle safety. Create a clean picture plate with natural speaking mouth movements only where the timeline specifies; any model-generated audio will be discarded.
```

### 2.2 全局硬负面约束

```text
baked text, logos, watermark, pseudo-UI, neon, particles, gore, living dragon, identity/age/costume/wetness/injury drift, malformed or fused hands, extra limbs or fingers, duplicate people, clear ghost faces, crowds, dry surfaces, wrong architecture, cuts, montage, morphs, teleporting props, whip pans, zooms, shake, talking during voice-over, cropped faces, hands or props
```

### 2.3 导演级时间段合同

每个时间段不是一句动作摘要，而是一条可执行的表演指令。正式提示词编译器必须按下列顺序组织每一拍；某一轨道没有动作时也要明确写出“保持不动”或“闭口聆听”，不能留给模型自行补戏。

| 轨道       | 必须回答的问题                                                                       |
| ---------- | ------------------------------------------------------------------------------------ |
| 画面与空间 | 当前景别、人物相对位置、前中后景分别出现什么，哪些对象必须持续留在画面内？           |
| 镜头与焦点 | 镜头是否移动、以多慢的速度移动、从何处到何处、何时拉焦、焦点最后停在哪里？           |
| 身体动作   | 哪只手接触哪个道具、接触前后的停顿、重量与阻力如何反馈，人物脚步和屏幕方向是否连续？ |
| 微表演     | 眼神先看哪里再看哪里，眼睑、眉心、嘴角、下颌、鼻翼如何变化，动作幅度应有多小？       |
| 生理反应   | 呼吸深浅、吸气或屏息、吞咽、胸口起伏、手部握力、泪水或水滴的路径是否可见？           |
| 情绪与意图 | 角色此刻想隐藏、确认、挽留或拒绝什么；这一拍相对上一拍发生了什么不可逆变化？         |
| 对白与声音 | 谁在何时形成口型、说话速度和气息如何；画外音出现时画面内谁必须闭口？                 |
| 环境因果   | 灯、水、倒影、残影或道具为何在此刻变化，人物何时看见并作出反应？                     |
| 结束状态   | 时间段最后一帧的视线、姿态、道具、焦点、光线和连续性状态是什么？                     |

导演级描述遵循四条硬规则：

1. **先写原因，再写反应。** 例如先有远处灯灭，再让人物眼球移动和抬头；不能让环境与表演同时随机发生。
2. **先眼神，后头部，最后身体。** 克制表演优先通过眼球、眼睑、呼吸和握力推进，避免每一次异常都用转身或后退表达。
3. **物体必须有重量。** 按键要有下沉与回弹，湿道具会打滑，线缆有长度和拉力，手掌接触不能穿模或瞬移。
4. **每一拍都要落在可验证的结束状态。** 下一拍必须从上一拍的真实姿势继续；选择停点最后两秒禁止新增口型、手势或视线目标。

### 2.4 参考图职责写法

正式任务不能只写“参考图像这样”。每个引用必须声明用途和禁止迁移的内容：

- 人物参考只锁定身份、年龄、发型、服装与随身物，不复制参考图的姿势、表情或背景。
- 场景参考只锁定建筑、材质、空间轴线与灯位，不把参考图中的临时人物或文字带入成片。
- 道具参考锁定尺寸、按钮位置、磨损、线缆与手持比例；任何可读文字只能来自已审核平面。
- 首帧／尾帧锁定构图、镜头高度、焦距感、人物站位、视线、湿度和伤痕；模型只能在两帧之间生成连续运动。
- 同一视觉事实若由不同参考图冲突描述，任务必须阻塞，不能依靠提示词声明“优先某一张”掩盖资产错误。

## 3. 待制作参考包

这些是生产依赖定义，不代表图片已经存在。每张标准图通过人物、美术与权利审核后才可绑定真实资产 ID。

| ID     | 建议画幅       | 内容与职责                                                                                                                                                         |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REF-01 | 16:9           | **现实入口母版**：闭园后的入口台阶、钠灯、潮湿地面、无巨龙；确定空间轴线与现实色彩                                                                                 |
| REF-02 | 16:9           | **龙口回声母版**：从同一机位看到已消失的巨龙入口叠回当下；确定褪色橙绿、尺度与材质                                                                                 |
| REF-03 | 3:4 全身＋头像 | **陈澄角色包**：19 岁、深灰短袖衬衫、旧牛仔裤、红色有线耳机、银色卡带机                                                                                            |
| REF-04 | 3:4 全身＋头像 | **Maya 角色包**：20 岁、橄榄绿防雨外套、黑色相机背带、小型手持 DV                                                                                                  |
| REF-05 | 16:9           | **龙腹船道／控制室母版**：潮湿船道、玻璃控制室、旧喇叭、栏杆、检修门；确定屏幕方向                                                                                 |
| REF-06 | 4:3            | **林国声回声包**：1994 年音响技术员，只允许玻璃反影、CRT 或远处剪影，不提供清晰正脸                                                                                |
| REF-07 | 4:3            | **核心道具板**：银色卡带机、A/B 面母带、Salmah 工牌、事故日志、Maya DV、透明证物袋                                                                                 |
| REF-08 | 16:9           | **展览与清晨场景族**：`REF-08/EXHIBIT` 为无真实机构 logo 的清晨口述史音频展；`REF-08/METRO` 为无品牌清晨地铁站。两者同属一个逻辑槽位，不同任务只提交声明的对应版本 |

### 3.1 模型模式互斥与引用优先级

- `HappyHorse 1.1 R2V`：提交 1–9 张角色、空间、道具参考；不得同时声明精确首帧或尾帧。
- `HappyHorse 1.1 I2V`：只提交一张锁定首帧；不得附加人物、空间、道具参考或尾帧。
- `Wan 2.7 First + Last Frame`：只提交锁定首帧与尾帧；角色、空间和道具母版只用于先制作锁定帧，不随视频任务提交。
- 人物出现时，锁定帧或 R2V 参考包必须覆盖对应角色身份；参考不足时阻塞，不允许仅靠文字重建脸。
- E04 只使用 S00 审核首帧与锁定黑场前尾帧，不再混入角色或场景 R2V 参考。
- 所有锁定帧都必须先成为独立、可审核、带 checksum 的正式资产；不得用“对应上一段末帧”这类运行时模糊绑定。

### 3.2 分支合流 Join Frame

21 段资产成立的前提是每个合流层拥有一个所有上游片共同抵达的锁定尾帧。Join Frame 先由 REF-01–08 合成并通过人物、美术、道具与连续性审核，再同时作为上一层所有分支的 `[End Frame]` 与下一层所有分支的 `[Start Frame]`。

| ID    | 合流位置  | 锁定构图与标准化状态                                                                           |
| ----- | --------- | ---------------------------------------------------------------------------------------------- |
| JF-01 | S01 → S02 | 龙腹入口稳定三角构图：陈澄居中持卡带、Maya 左侧持 DV、控制室玻璃在右；承载 C2                  |
| JF-02 | S02 → S03 | 湿滑门槛困境构图：Maya 靠栏杆失去一步、陈澄手中卡带将滑落；承载 C3                             |
| JF-03 | S03 → S04 | 两人共同面对事故日志；卡带统一带水珠、Maya 右掌统一为轻微擦伤，确保两条 C3 后果可合流；承载 C4 |
| JF-04 | S04 → S05 | Salmah 工牌、双轨控制与两人的手处于同一稳定近景；承载 C5                                       |
| JF-05 | S05 → S06 | 陈澄在控制台中央，Maya 在左、林国声倒影在右，卡带与“公开／拔带”两项物理动作均清楚；承载 C6     |

JF-03 的水珠和轻伤是合流后的标准化可见状态：不同选择的道德与关系后果保留在表演和台词中，不再让一个共享下游资产承担两套互斥外观连续性。

### 3.3 首尾锁定帧

下列三张图片与 JF-01–05 一样，必须作为独立 Reference Slot / Version 审核，不能在运行时用“当前 Master 的某一帧”动态替代：

| ID               | 类型        | 来源与用途                                                                       |
| ---------------- | ----------- | -------------------------------------------------------------------------------- |
| S00-FIRST        | First Frame | 从已批准 S00 Take 的第 0 帧提取并独立审核；只绑定 E04 的 `[Start Frame]`         |
| S00-LAST         | Last Frame  | 从已批准 S00 Take 的稳定末帧提取并独立审核；绑定 S01A / S01B 的 `[Start Frame]`  |
| E04-PREBLACK-END | Last Frame  | 由 REF-01–04 预制并审核的黑场前构图；只绑定 E04 的 `[End Frame]`，不是最终纯黑帧 |

因此本项目共有 16 个正式逻辑参考输入槽：8 个源参考族、5 个 Join Frame、3 个首尾锁定帧。REF-08 场景族实际包含展览与地铁两个文件版本；全部参考相关文件、角色与道具制作方法见[参考图生产指南](./hu-bao-villa-longkou-night-reference-image-guide-v1.md)。S00 更换 Master 后必须重新提取、审核 S00-FIRST / S00-LAST；旧版本继续保留供既有 Take 审计。

## 4. 21 段双模型任务提示词

### 01｜`hbln-s00-dragon-returns`｜15s｜HappyHorse 1.1 R2V

**模型输入**：`[Image 1]=REF-01 现实入口`；`[Image 2]=REF-02 龙口回声`；`[Image 3]=REF-03 陈澄`；`[Image 4]=REF-04 Maya`；`[Image 5]=REF-07 道具板`。  
**生产依赖**：无上游视频；生成后登记审核首帧、审核末帧与 checksum。

**Submission prompt（HappyHorse 实际提交；不要再拼接全局前缀）**

```text
One continuous 15-second photorealistic live-action cinematic shot, no cut, landscape 16:9. A humid Singapore sculpture garden after closing, restrained supernatural realism. Present-day reality is desaturated grey-green under sodium lamps; the 1994 echo uses faded orange and aged green practical bulbs, never neon or fantasy particles. Preserve the exact entrance axis and wet stairs from [Image 1], the giant painted-concrete dragon entrance from [Image 2], Cheng's identity and dark-grey shirt, old jeans, red wired earphones from [Image 3], Maya's identity, olive rain jacket, black strap and MiniDV from [Image 4], and the silver cassette player's shape from [Image 5]. The dragon is architecture, never a living creature. Reserve empty lower-centre space for interaction UI.

0.0–2.0s: restrained handheld wide two-shot matching [Image 1]. Maya stands half a step behind frame-left filming with both hands; Cheng stands centre-right, holding the cassette player at lower-chest height. Both mouths closed. A tiny red recording-light reflection appears on the metal. Cheng notices it only with her eyes; head and shoulders remain still.

2.0–4.5s: almost imperceptible slow push toward Cheng. Her right thumb hovers, then presses the physical PLAY control with visible travel and rebound. The cable sways under gravity. She takes one shallow breath and looks toward the distant entrance before her chin follows. Maya notices but keeps filming. No dialogue.

4.5–7.5s: one distant modern lamp fails first. After a brief safe exposure dip, aged orange-green bulbs illuminate sequentially and reveal the giant painted-concrete dragon entrance on exactly the same axis. No stone morphing. Cheng's pupils widen and fingers tighten without a jump or scream. Maya's eyes turn first, then her head, then the DV follows with a delayed controlled movement. From 5.5–7.0s Maya forms one short quiet line for later dubbing while Cheng listens closed-mouth.

7.5–10.0s: hold the same spatial relationship with only a few centimetres of camera drift. One wet vintage admission ticket drops from the architectural mouth, flutters under gravity, strikes a stair edge and stops in the real foreground. It has no readable writing and does not glow. Cheng tracks it from high background to low foreground, parts then closes her lower lip, and swallows. Maya films the ticket and dragon without speaking.

10.0–12.0s: Cheng reacts to an off-screen old broadcast that will be added in post. Her breath pauses for half a second; her brow softens with recognition while her grip stays tight. She looks from ticket to dragon to cassette player. From 10.8–11.8s she forms a minimal quiet reply; Maya remains closed-mouth and looks toward the speaker direction.

12.0–13.0s: a controlled shallow move reveals the cassette A/B controls while both women remain in the upper frame. Cheng rotates the player with believable wrist and cable weight; her thumb stops between the controls without choosing. Maya lowers the DV only a few centimetres to see Cheng directly.

13.0–15.0s: completely stable close two-shot. Cheng remains centre-right holding the player, thumb suspended between A/B controls; Maya remains left-rear watching Cheng. Both mouths closed. The wet ticket is fixed on the stair, dragon bulbs steady, no new gesture or light event. Keep faces, hands and player outside the empty lower-centre UI safe area and end on a continuity-safe frame.
```

**Positive prompt**

```text
Create one continuous 15-second live-action shot with no cut. Begin from the exact empty present-day entrance architecture, camera axis, wet stair geometry and sodium-vapour lighting in [Image 1]. [Image 2] supplies only the lost giant dragon entrance's scale, painted concrete material and aged orange-green practical bulbs; never copy its people or turn the structure into a living creature. Keep Cheng's identity, age, hair, dark-grey shirt, old jeans and red wired earphones exactly consistent with [Image 3], and Maya's identity, olive rain jacket, black camera strap and handheld DV exactly consistent with [Image 4]; do not copy either reference pose. [Image 5] locks the silver cassette player's dimensions, button positions, earphone cable and weathering. Maya films from half a step behind Cheng. Cheng holds the cassette player at lower-chest height with both hands, shoulders contained rather than raised. Reveal the missing dragon entrance only after a distant practical lamp fails and the old bulbs illuminate the same architectural axis. A single wet vintage admission ticket then falls under gravity from the architectural mouth and lands on the real stair with believable paper weight. Cheng remains controlled and frightened: eye movement precedes head movement, her breathing becomes shallow, her thumb pressure increases and her jaw tightens, but she never screams or makes a large retreat. End on a stable close two-shot with both identities intact, the cassette A/B controls readable as shapes but not generated text, the dragon still architectural, and empty lower-centre space reserved for the C1 choice overlay.
```

**Emotional arc**：日常警觉 → 对录音机异常的怀疑 → 看见已消失建筑后的否认 → 被门票证明现实后的恐惧 → 听见外公声音后的私人动摇 → 压住情绪等待选择。

**Shot timeline**

```text
0.0–2.0s — Begin in a restrained handheld-DV-like wide view matching [Image 1], with horizon and entrance axis level. Maya is half a step behind frame-left holding the DV with both hands; Cheng is one step ahead, centre-right, holding the silver player at lower-chest height. Both women keep their mouths closed. A tiny red recording-light reflection appears on the player's brushed metal, never as readable UI. Cheng's eyes drop to the reflection first; only her pupils move, while her head and shoulders remain still. End with the player, both women and the empty entrance simultaneously visible.
2.0–4.5s — Make an almost imperceptible slow push from wide two-shot toward Cheng. Her right thumb hovers over the physical PLAY control for half a second; she takes one shallow breath, then presses it with visible button travel and rebound. The earphone cable responds with a small gravity-driven sway. She does not speak. Her gaze stays on the mechanism for one beat after the press, then shifts toward the distant entrance before her chin follows by only a few degrees. Maya notices Cheng's change in breathing but keeps filming. End with both faces still readable and the entrance soft but present in depth.
4.5–7.5s — A single distant present-day lamp fails first, creating the cause. After a brief safe dip in exposure, aged orange-green bulbs illuminate sequentially in deep space and reveal the giant painted-concrete dragon entrance on exactly the same architectural axis. Do not morph stone or move the dragon. Cheng's pupils widen and her fingers tighten around the player; her shoulders do not jump. Maya's eyes find the light, then her head turns, then the DV follows with a delayed, controlled adjustment. During 5.5–7.0s Maya naturally forms her short line on one breath, voice to be added in post; Cheng stays closed-mouth and listens. End with the dragon fully legible as architecture and neither woman having changed position.
7.5–10.0s — Hold the spatial relationship and let the camera drift only a few centimetres closer. One wet vintage admission ticket releases from the architectural mouth, flutters unevenly under gravity, strikes one stair edge and lands in the real foreground; it must not float, glow or show generated writing. Cheng tracks the ticket with her eyes from high background to low foreground before lowering her chin. Her lower lip parts slightly, then closes; a small swallow is visible in her throat. Maya keeps the DV aimed at the ticket and dragon, with no dialogue. End with the ticket stationary, wet side catching one practical highlight.
10.0–12.0s — An off-screen old broadcast begins in post. Cheng hears it before she moves: her breathing stops for roughly half a second, her brow tension softens with recognition while her grip remains tight. Her gaze moves from the ticket to the dragon, then down to the player as if verifying the source. During 10.8–11.8s she forms her short reply quietly with minimal jaw movement; the first syllable is guarded and the last carries involuntary familiarity. Maya looks from Cheng to the speaker direction but remains closed-mouth. End with Cheng's eyes on the player and unresolved recognition on her face.
12.0–13.0s — Continue the same shot with a controlled, shallow move toward the cassette A/B controls while keeping both women layered in the upper frame. Cheng rotates the player only enough to expose both physical options; wrists and cable move with believable weight. Her thumb stops between the controls and does not choose. Maya lowers the DV by only a few centimetres to see Cheng directly. No one speaks.
13.0–15.0s — Lock into a completely stable close two-shot suitable for the C1 overlay. Cheng holds the player without pressing anything, gaze suspended between the two controls; Maya watches Cheng, not the camera. Breathing remains subtle, mouths remain closed, the ticket stays fixed on the stair and the dragon bulbs hold steady. Introduce no new gesture, eye target, light event or prop movement. Preserve clear lower-centre UI space and finish on a continuity-safe frame.
```

**End-state contract**：陈澄居中偏右、Maya 居左后方；两人闭口；陈澄双手持卡带机且拇指停在 A/B 控制之间；湿门票静止在前景台阶；龙口保持混凝土建筑；橙绿旧灯稳定；人物服装和皮肤无新增湿度；下中部无关键脸、手或道具，连续稳定至少 2 秒。

**专属负面**：龙眨眼、龙口变成肉、门票出现可读文字、角色尖叫、镜头切换。  
**验收重点**：前 8 秒内必须看懂“不存在的旧龙口重新出现”；末帧必须能自然承载 C1。

### 02｜`hbln-s01a-opening-march`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=S00 审核末帧`；`[End Frame]=JF-01`。  
**生产依赖**：REF-02、REF-03、REF-04、REF-05、REF-06、REF-07；只用于制作并审核 JF-01，不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng selects the marked opening-march side of the cassette. Aged orange-green practical bulbs switch on in a physical sequence and translucent 1994 visitor traces stream around the two women, gently forcing them toward the dragon mouth. In the control-room glass, show only an indistinct young male technician reflection extending one hand toward Cheng, never a clear face. The celebration feels seductive but wrong. Preserve both women and props exactly, then arrive precisely at [End Frame] without a cut.
```

**Shot timeline**

```text
0.0–1.5s exact continuation; Cheng's thumb presses the marked cassette control.
1.5–4.0s warm aged bulbs illuminate sequentially from the dragon eyes toward the mouth; both women react to unheard opening music.
4.0–7.5s translucent visitors pass around them without clear faces, creating forward pressure as the camera retreats smoothly into the dragon passage.
7.5–10.0s camera slides beside control-room glass; Lin's indistinct reflection raises one hand, never resolving into a clear face.
10.0–12.3s Cheng reacts to off-screen Lin; Maya naturally forms her English question during 10.4–11.8s.
12.3–13.0s Cheng looks between Maya and the speaker.
13.0–15.0s stable two-shot hold, no new lip movement, for C2.
```

**专属负面**：清晰的林国声正脸、欢乐现代游客、舞蹈、彩色霓虹、人物被残影穿透。  
**验收重点**：C1A 的反馈必须在 1.5 秒内可见；诱惑感大于攻击感。

### 03｜`hbln-s01b-side-b`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=S00 审核末帧`；`[End Frame]=JF-01`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-06、REF-07；只用于制作并审核 JF-01，不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng flips the physical cassette to its unlabelled B side. The entrance falls dark for a brief safe beat, then a damp old boat passage emerges through rows of failing practical lights. An off-screen electrical spark motivates both women's reactions but causes no injury. Lin's indistinct reflection suddenly strikes the inside of the control-room glass once, never resolving into a clear face. Maya studies Cheng with a betrayed, questioning expression. Arrive precisely at [End Frame] without a cut.
```

**Shot timeline**

```text
0.0–1.7s exact continuation; Cheng removes, flips and reseats the cassette with believable hand anatomy.
1.7–3.0s practical lights cut to near-black; both women freeze at an off-screen spark, no visible electric attack.
3.0–6.0s old passage lamps wake one by one into deep perspective as the camera slowly advances.
6.0–8.5s Lin's reflection strikes the glass once and silently forms his command during 7.0–8.0s; his face remains unreadable.
8.5–11.8s Maya turns from the glass to Cheng and naturally forms her question during 9.5–11.0s.
11.8–13.0s Cheng grips the cassette, caught between them.
13.0–15.0s stable hold with no new motion for C2.
```

**专属负面**：电击人物、爆炸、清晰鬼脸、磁带自行悬浮、频繁闪光。  
**验收重点**：B 面的危险证据应通过人物反应成立，不能依赖生成音频。

### 04｜`hbln-s02a-answer-grandfather`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-01`；`[End Frame]=JF-02`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-06、REF-07；只用于制作并审核两张 Join Frame，不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng deliberately answers the off-screen grandfather while Maya remains wary. Faceless translucent visitor traces stop and rotate their heads toward Cheng in one restrained synchronized movement, then remain still. Lin's indistinct reflection points deeper into the passage. Real shallow water begins crossing the floor and reaches their shoes. Cheng is emotionally drawn toward the voice; Maya recognizes the physical danger first. Arrive precisely at the shared wet-threshold dilemma in [End Frame] without completing either outcome.
```

**Shot timeline**

```text
0.0–2.2s continue from [Start Frame]; Cheng faces the old speaker and naturally forms “外公，是你吗” during 0.7–2.0s.
2.2–4.5s surrounding translucent visitors turn their heads once toward her; no faces resolve.
4.5–7.0s Lin's reflection points down the passage while Cheng listens to his off-screen reply without moving her lips.
7.0–10.0s shallow real water crosses the floor and reaches both pairs of shoes; Maya notices and pulls Cheng back.
10.0–12.8s Maya's boot slips near the railing as Cheng's wet cassette grip loosens; both risks are equally visible.
12.8–15.0s stable dilemma frame, no new action, for C3.
```

**专属负面**：群体鬼脸、脖子旋转恐怖特效、深水突现、完成救人或抢带动作。  
**验收重点**：末帧同时清楚呈现 Maya 与母带两项风险。

### 05｜`hbln-s02b-tell-maya`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-01`；`[End Frame]=JF-02`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-07；只用于制作并审核两张 Join Frame，不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng chooses Maya over the broadcast, placing one red wired earbud into Maya's ear. Keep the action intimate, tense and physically precise. Maya hears the hidden recording, then raises the same small handheld DV camera. Only inside its screen, an old maintenance door appears in the solid passage wall; outside the screen the wall remains closed. Water begins forcing through the screen-aligned doorway into reality. Arrive precisely at the shared wet-threshold dilemma in [End Frame] without a cut.
```

**Shot timeline**

```text
0.0–2.5s Cheng gently places one red earbud into Maya's ear and naturally forms her confession during 0.8–2.3s.
2.5–5.0s close two-shot as Maya listens, then naturally forms her admission during 3.4–4.9s.
5.0–7.0s Cheng recoils and naturally forms her brief question during 5.8–6.7s.
7.0–10.0s Maya raises the DV; camera racks focus to its screen, where a maintenance door exists although the real wall behind it is solid.
10.0–12.0s water pushes from the screen-aligned seam into the real floor; Maya slips as Cheng's cassette grip becomes unstable.
12.0–12.8s Maya removes the single earbud and lets the red cable fall back naturally toward Cheng's cassette player, standardizing both branches before the shared frame.
12.8–15.0s stable dilemma frame for C3, no new lip movement; Maya is no longer wearing the earbud.
```

**专属负面**：耳机穿模、DV 屏幕生成文字、真实墙体先行开门、Maya 过度哭泣。  
**验收重点**：必须一眼看懂“检修门只在 DV 里存在”。

### 06｜`hbln-s03a-save-maya`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-02`；`[End Frame]=JF-03`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-07；只用于制作并审核两张 Join Frame，不随本任务提交。

**Positive prompt**

```text
Continue the exact dilemma from [Start Frame]. A narrow walkway section gives way. Cheng decisively releases the cassette to catch Maya with both hands. The cassette player lands in shallow water, never fully submerges, and is gently returned within reach by several translucent visitor hands without visible bodies. On the control-room glass, a physical 1994 incident log becomes visible through condensation. Preserve water droplets on the cassette. During the recovery Maya gains only the same subtle right-palm abrasion shown in [End Frame]. Arrive precisely at [End Frame] without a cut.
```

**Shot timeline**

```text
0.0–2.0s walkway shifts and Maya drops one level, still safely holding the railing.
2.0–4.8s Cheng releases the cassette and catches Maya's forearm with anatomically correct two-hand contact.
4.8–6.8s Maya forms her urgent line during the rescue; Cheng pulls her to stable footing.
6.8–9.0s cassette player lands in shallow water, spins once, and translucent hands return it to the walkway without lifting it magically.
9.0–11.2s Cheng takes the wet player and naturally forms “活人先出去” during 9.8–11.0s.
11.2–13.0s condensation clears from control-room glass to reveal the physical incident log behind it, with no generated readable details beyond the locked prop reference.
13.0–15.0s stable two-person reading composition for C4.
```

**专属负面**：Maya 坠入深渊、手臂变形、卡带漂浮、生成新日志文字。  
**验收重点**：选择反馈在前 3 秒完成；湿卡带连续性建立清楚。

### 07｜`hbln-s03b-save-tape`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-02`；`[End Frame]=JF-03`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-06、REF-07；只用于制作并审核两张 Join Frame，不随本任务提交。

**Positive prompt**

```text
Continue the exact dilemma from [Start Frame]. Cheng lunges for the cassette instead of Maya. Maya catches the railing herself and remains alive but scrapes her right palm. Her DV falls onto the wet floor without breaking, creating a low-angle view of the locked physical incident log. A shallow splash leaves the cassette with the same water droplets shown in [End Frame]. Lin's reflection appears above the log and admits his motive with restrained shame. Cheng looks from the cassette to Maya and understands the cost of her choice. Arrive precisely at [End Frame] without a cut.
```

**Shot timeline**

```text
0.0–2.8s Cheng dives toward and secures the cassette while Maya slips away from her reach.
2.8–5.2s Maya catches the railing herself; her right palm gains one small realistic abrasion, no blood emphasis.
5.2–7.0s DV camera falls to the floor and settles intact in a low angle facing the incident log.
7.0–9.5s rack focus from the cassette to the locked log prop; never invent additional writing.
9.5–11.8s Lin's indistinct reflection forms his confession during 9.8–11.4s.
11.8–13.0s Cheng looks at Maya's injured hand, then at the log.
13.0–15.0s stable layered hold for C4.
```

**专属负面**：严重流血、DV 碎裂、日志文字漂移、林国声清晰露脸。  
**验收重点**：不能把抢带拍成英雄动作；必须看见 Maya 自救与轻伤代价。

### 08｜`hbln-s04a-side-by-side`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-03`；`[End Frame]=JF-04`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-06、REF-07；只用于制作并审核两张 Join Frame，不随本任务提交。

**Positive prompt**

```text
Continue from [Start Frame]. This is the high-bond branch. Cheng and Maya deliberately stand shoulder to shoulder. Maya connects her DV to the wet cassette player using a believable short cable. Two abstract analogue waveforms made only of practical reflected light travel along opposite sides of the boat passage, one associated with Lin's reflection and one with Salmah's unseen recording; do not render text or holographic UI. Both women listen rather than judge. Bring Salmah's physical badge beside the two controls and arrive precisely at [End Frame].
```

**Shot timeline**

```text
0.0–2.5s Maya moves beside Cheng and naturally forms her line during 0.7–2.2s.
2.5–5.0s close-up of believable DV-to-cassette cable connection; preserve wet cassette state if inherited.
5.0–8.0s camera arcs behind both women as faint reflected waveform-like bands illuminate opposite passage walls, fully physical and non-holographic.
8.0–10.5s Lin's reflection forms his line while Cheng listens; no lip movement for Salmah's off-screen response.
10.5–12.8s both women exchange one confirming look and place separate hands near the two track controls.
12.8–15.0s stable shared-hands composition for C5.
```

**专属负面**：全息 UI、发光文字、Salmah 实体鬼魂、争抢式表演。  
**验收重点**：构图必须表现“共同决定”，不是 Maya 辅助陈澄操作。

### 09｜`hbln-s04b-admit-fault`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-03`；`[End Frame]=JF-04`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-06、REF-07；只用于制作并审核两张 Join Frame，不随本任务提交。

**Positive prompt**

```text
Continue from [Start Frame]. Cheng reads the already locked incident log and openly assigns responsibility to Lin. As she speaks, one natural stress crack travels through the control-room glass reflection only; the real architecture remains safe. Behind the cracked reflection, reveal Salmah's locked physical staff badge caught in the frame. Lin's indistinct reflection responds with hurt rather than rage. Cheng stays firm and places the badge beside the cassette's two track controls, arriving precisely at [End Frame].
```

**Shot timeline**

```text
0.0–3.2s medium close-up as Cheng naturally forms her responsibility statement while looking at the log.
3.2–5.5s a single stress crack travels across Lin's reflected region of the glass, restrained and physically plausible.
5.5–7.8s rack focus through the crack to reveal Salmah's exact staff badge; Cheng retrieves it.
7.8–10.0s Lin's reflection forms his wounded question, never becoming monstrous.
10.0–12.5s Cheng naturally forms her answer and places the badge beside the cassette.
12.5–15.0s stable badge-and-two-track composition for C5.
```

**专属负面**：玻璃爆炸、厉鬼化、工牌文字重写、陈澄愤怒吼叫。  
**验收重点**：承认责任要克制而明确；Salmah 的名字成为物理焦点。

### 10｜`hbln-s04c-defend-him`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-03`；`[End Frame]=JF-04`。  
**生产依赖**：同 09；不随本任务提交。

**Positive prompt**

```text
Continue from [Start Frame]. Cheng closes the physical incident log and verbally softens Lin's responsibility. Lin's reflection becomes steadier and more flattering in the glass while Salmah's exact staff badge loses only its reflected light and recedes into shadow; the badge itself is not damaged or erased. Maya steps between Cheng and the reflection and challenges the excuse. Lin guides Cheng's hand toward the opening-march track. Cheng then returns the badge beside both controls and arrives precisely at [End Frame].
```

**Shot timeline**

```text
0.0–2.8s Cheng slowly closes the log and naturally forms her defence during 0.6–2.5s.
2.8–5.0s Lin's reflection stabilizes while the physical badge falls into ordinary shadow, with no magical dissolve.
5.0–7.8s Maya steps into the foreground and naturally forms her challenge during 5.8–7.3s.
7.8–10.5s Lin's reflection silently forms his appeal and indicates the opening-march control.
10.5–12.8s Cheng's hand approaches that control, then hesitates between both.
12.8–15.0s stable hovering-hand composition for C5.
```

**专属负面**：工牌消失、林国声变年轻英俊特写、Maya 推搡陈澄、选项被提前按下。  
**验收重点**：辩护的诱惑应是温柔和秩序，而非明显邪恶。

### 11｜`hbln-s05a-raw-voice`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-04`；`[End Frame]=JF-05`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-06、REF-07；只用于制作并审核两张 Join Frame，不随本任务提交。

**Positive prompt**

```text
Continue from [Start Frame]. The truth-dominant branch. Cheng preserves Salmah's raw track. Reflected practical light pulses down the passage in evacuation order and translucent visitor traces calmly follow it toward the maintenance exit. The architectural dragon belly separates along an existing service seam, revealing a realistic present-day doorway rather than magical white light. Lin's reflection retreats but remains human and vulnerable. Maya stays beside Cheng. Return to the shared three-person control-desk composition and arrive precisely at [End Frame].
```

**Shot timeline**

```text
0.0–2.0s Cheng presses Salmah's physical track control; immediate practical indicator response.
2.0–5.0s evacuation lights pulse sequentially and visitor traces turn to follow, no panic or running crowd.
5.0–7.5s an existing service seam opens into a realistic present-day exit; Maya sees it first.
7.5–10.0s Lin's reflection forms his warning while receding one step.
10.0–12.5s Maya forms her short English line as Cheng studies upload cable versus eject control.
12.5–15.0s stable decision close-up for C6.
```

**专属负面**：天堂白光、胜利欢呼、Salmah 现身、林国声消散死亡。  
**验收重点**：真相路径提供出口，但不把选择做成无代价胜利。

### 12｜`hbln-s05b-opening-wins`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-04`；`[End Frame]=JF-05`。  
**生产依赖**：同 11；不随本任务提交。

**Positive prompt**

```text
Continue from [Start Frame]. The echo-dominant branch. Cheng preserves the opening march. Every aged practical celebration bulb switches on, making the decayed passage briefly beautiful. Faceless visitor traces applaud in synchronized but restrained movements. Lin's reflection stands confidently at the old control desk while the visual trace associated with Salmah diminishes into ordinary tape noise texture. Behind Cheng and Maya, the architectural dragon entrance begins closing slowly. Return to the shared three-person control-desk composition and arrive precisely at [End Frame].
```

**Shot timeline**

```text
0.0–2.0s Cheng presses the opening-march track; practical bulbs answer immediately.
2.0–5.0s camera makes one smooth half-arc through the revived faded celebration space while visitor traces applaud without faces.
5.0–7.5s Lin's reflection forms his line at the control desk.
7.5–10.0s Maya forms her English objection as the opposite reflected waveform weakens into non-readable analogue noise.
10.0–12.5s Cheng notices the architectural entrance closing and naturally forms her brief question.
12.5–15.0s stable upload-versus-eject composition for C6.
```

**专属负面**：现代派对、彩纸礼花、群演清晰脸、龙口突然咬合。  
**验收重点**：美丽必须真实诱人，同时明确 Salmah 的声音正在被覆盖。

### 13｜`hbln-s05c-mixed-track`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=JF-04`；`[End Frame]=JF-05`。  
**生产依赖**：同 11；不随本任务提交。

**Positive prompt**

```text
Continue from [Start Frame]. The balanced branch. Two competing analogue tracks cause alternating practical-light patterns along the passage. Nearby moral-diorama statues perform one small synchronized gesture of covering their sculpted ears while remaining visibly painted concrete, never becoming flesh. Reveal a real old mixing console with two physical faders labelled only through the locked prop artwork: LEGEND and RECORD. Frame Cheng, Maya and Lin's reflection as a tense triangle, then arrive precisely at the shared upload-versus-eject composition in [End Frame].
```

**Shot timeline**

```text
0.0–3.0s alternating aged light patterns travel along opposite walls while Cheng and Maya listen.
3.0–5.5s two nearby concrete statues make one restrained synchronized ear-covering movement, retaining rigid painted texture.
5.5–8.0s camera tilts to the exact two-fader console from the locked reference; no invented labels.
8.0–10.0s Maya forms her line while Cheng watches both faders.
10.0–12.5s Lin's reflection indicates one fader; Cheng hears Salmah off-screen from the other direction without any corresponding lips.
12.5–15.0s stable upload-versus-eject composition for C6.
```

**专属负面**：雕塑变真人、发光音波、界面弹窗、自动替玩家推动推子。  
**验收重点**：平衡状态表现为冲突未解，不是两条声轨和谐融合。

### 14｜`hbln-s06a-release-truth`｜15s｜HappyHorse 1.1 I2V

**模型输入**：`[Start Frame]=JF-05`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-06、REF-07；已固化在 JF-05，不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng chooses to release the complete tape. She connects Maya's DV cable to the old console and presses one physical transfer key. A full analogue waveform appears only as projected light across the curved interior wall, without readable UI. Cheng states that both Lin's fault and Salmah's name remain. Lin's reflection listens, then voluntarily lowers the physical music fader himself. The maintenance door unlocks. End with Lin's reflection diminished but peaceful and both women facing the exit.
```

**Shot timeline**

```text
0.0–2.5s Cheng plugs the DV cable into the console and presses the locked transfer key.
2.5–5.0s a complete analogue waveform is projected as light across the wall; no text or progress bar.
5.0–8.0s Cheng naturally forms her full statement with controlled emotion.
8.0–10.8s Lin's reflection absorbs the decision, then physically lowers the music fader himself.
10.8–12.8s Lin forms his quiet final line; the maintenance lock releases in the background.
12.8–15.0s camera settles behind the two women facing the realistic exit, no triumphant pose.
```

**专属负面**：上传网站 UI、百分比、庆祝特效、林国声灰飞烟灭。  
**验收重点**：林国声主动推下音乐是本段不可删的核心动作。

### 15｜`hbln-s06b-release-cleaned`｜15s｜HappyHorse 1.1 I2V

**模型输入**：`[Start Frame]=JF-05`。  
**生产依赖**：同 14；不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng chooses public release before enough raw truth has been preserved. She connects the DV and starts transfer. The projected analogue waveform appears complete, then an automatic physical noise-reduction unit suppresses the smaller secondary waveform until it is nearly flat; show this without readable interface text. Maya urgently points to the disappearing waveform. Visitor traces applaud as Lin's reflection becomes the dominant image. Cheng realizes the public version is another edit. End on her face reflected beside the now-flat secondary track.
```

**Shot timeline**

```text
0.0–2.3s Cheng connects DV and presses transfer.
2.3–5.0s two analogue waveforms project on the wall; a physical noise-reduction unit activates and suppresses the smaller track.
5.0–7.2s Maya points and naturally forms her urgent English line.
7.2–9.8s visitor traces applaud while Lin's reflection grows visually dominant through ordinary glass exposure, not supernatural enlargement.
9.8–12.3s Lin forms his familiar line; Cheng watches the flattened secondary waveform.
12.3–15.0s slow settle on Cheng's conflicted reflection, with no further action.
```

**专属负面**：可读“降噪完成”文字、系统故障火花、成功庆祝、把后果拍成随机 bug。  
**验收重点**：必须看出这是此前选择造成的不可逆删节。

### 16｜`hbln-s06c-leave-together`｜15s｜HappyHorse 1.1 I2V

**模型输入**：`[Start Frame]=JF-05`。  
**生产依赖**：REF-03、REF-04、REF-05、REF-07；已固化在 JF-05，不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng chooses not to publish. She ejects the physical cassette, immediately takes Maya's hand, and both run toward the realistic maintenance exit while carrying the cassette player and DV. At the final electrical cabinet, each woman uses one hand to pull down the heavy master switch together. The faded 1994 layer loses practical power and the giant dragon architecture recedes into the ordinary present-day stair without melting. Preserve all props leaving with them. End in the quiet real entrance after the echo is gone.
```

**Shot timeline**

```text
0.0–2.0s Cheng ejects and secures the cassette, then reaches for Maya rather than looking back.
2.0–4.0s Cheng naturally forms her line as they begin moving together.
4.0–7.0s one continuous tracking move follows both women through the maintenance exit; cassette and DV remain visible.
7.0–9.5s they reach the electrical cabinet and jointly grip the master switch with believable hand placement.
9.5–11.0s both pull the switch down; all 1994 practical bulbs lose power in depth order.
11.0–13.2s match-position transition reveals the ordinary present-day entrance architecture, with no dragon.
13.2–15.0s stable wide shot of both women safely outside holding both pieces of evidence.
```

**专属负面**：慢动作英雄跑、爆炸、龙融化、遗失卡带或 DV、单人拉闸。  
**验收重点**：两人共同拉闸与两件证据被带出必须同时成立。

### 17｜`hbln-s06d-leave-alone`｜15s｜HappyHorse 1.1 I2V

**模型输入**：`[Start Frame]=JF-05`。  
**生产依赖**：同 16，并含 REF-06；已固化在 JF-05，不随本任务提交。

**Positive prompt**

```text
Continue exactly from [Start Frame]. Cheng ejects and protects the cassette before turning toward Maya. A previously invisible control-room glass plane is now between them, spatially consistent with the passage. Maya presses one hand to her side; Cheng mirrors it from the opposite side but cannot reach her. Maya's DV remains with Maya inside the echo space. The cassette player's reels begin physically rewinding by themselves in Cheng's hands. Lin's reflection appears behind Maya and calmly declares closing time. End with Cheng striking the glass once and Maya receding into a 1994 visitor trace.
```

**Shot timeline**

```text
0.0–2.0s Cheng ejects the cassette and secures it close to her body before looking for Maya.
2.0–4.5s reveal Maya behind an existing glass plane through a controlled lateral camera move; maintain correct reflections and eyelines.
4.5–7.0s both women place matching palms against opposite sides; Maya forms her English line during 5.0–6.5s.
7.0–9.2s close-up of the cassette reels physically rewinding inside the player, no floating controls.
9.2–11.5s Lin's reflection appears behind Maya and forms his closing line.
11.5–13.2s Cheng naturally calls Maya and strikes the glass once.
13.2–15.0s Maya gradually takes on the translucency and period exposure of a visitor trace while remaining identifiable.
```

**专属负面**：玻璃凭空弹出、Maya 死亡或受伤、穿玻璃、DV 出现在陈澄手里。  
**验收重点**：空间关系必须清楚；悲剧来自陈澄先保护带子而非随机困人。

> **S06 Runtime 出口（四段共用）**：视频结束后必须停在已审核末帧，Runtime 显示单按钮“继续进入结局”。玩家确认前不得自动播放 E01–E04；该停点不改状态、不计为剧情选择，也不向视频模型提交额外画面或提示词。

### 18｜`hbln-e01-name-returned`｜15s｜HappyHorse 1.1 R2V

**模型输入**：`[Image 1]=REF-08/EXHIBIT 清晨展览`；`[Image 2]=REF-03`；`[Image 3]=REF-04`；`[Image 4]=REF-07`。  
**生产依赖**：S06A 的审核结论与服装／湿度连续性记录；玩家通过 S06 结局确认停点后，使用叙事硬切进入清晨，不声明精确首帧。

**Positive prompt**

```text
Create a quiet dawn epilogue in the unbranded oral-history exhibit from [Image 1]. Cheng and Maya stand shoulder to shoulder at a simple audio station. Use only locked, precomposed graphic plates for any name or waveform area; do not generate text. The exhibit visually gives Salmah equal or primary placement and presents Lin as a witness rather than a hero. Cheng listens with grief and relief, then glances toward Maya. End on both women reflected together in the dark audio screen as warm dawn reaches the room.
```

**Shot timeline**

```text
0.0–3.0s dawn establishing move from quiet entrance into the small unbranded exhibit.
3.0–6.0s reveal Cheng and Maya together at the audio station; any text region is a locked blank replacement plate.
6.0–9.0s close on Cheng listening to off-screen archived audio, no lip movement.
9.0–11.5s Cheng naturally forms her short voice-over line only if filmed on-camera; preferred version keeps it off-screen with closed lips.
11.5–15.0s settle on both women's shared reflection in the audio screen, warm dawn growing subtly.
```

**专属负面**：真实机构 logo、模型生成姓名、领奖式笑容、墓园意象。  
**验收重点**：不是“外公被取消”，而是 Salmah 被归还到共同记录。

### 19｜`hbln-e02-last-opening`｜15s｜HappyHorse 1.1 R2V

**模型输入**：`[Image 1]=REF-08/EXHIBIT 清晨展览`；`[Image 2]=REF-03`；`[Image 3]=REF-07`；`[Image 4]=REF-06`。  
**生产依赖**：S06B 的审核结论；玩家通过 S06 结局确认停点后，使用叙事硬切进入展览，不声明精确首帧。

**Positive prompt**

```text
Create the same unbranded oral-history exhibit but busier and visually seductive. Ordinary visitors smile and photograph a restored Dragon World presentation while Cheng stands alone behind them. On a locked precomposed waveform plate, one small secondary track is visibly crossed out by a graphic mask; do not generate any text. Lin's reflection briefly aligns with the bright exhibit glass while Cheng remains in the darker present-day layer. End on Cheng alone after the crowd moves past.
```

**Shot timeline**

```text
0.0–3.0s smooth move across smiling visitors photographing the bright faded-orange-green exhibit.
3.0–5.5s rack focus to Cheng standing motionless behind them, separated by reflections.
5.5–8.0s close on the locked waveform plate where the small secondary track is masked; no readable generated labels.
8.0–10.5s Lin's reflection aligns with the bright glass while off-screen opening audio is implied by visitor reactions.
10.5–12.0s Cheng naturally forms Salmah's name very quietly.
12.0–15.0s crowd clears frame, leaving Cheng alone beside the masked waveform.
```

**专属负面**：可读伪文字、邪恶笑脸、超自然袭击、陈澄嚎哭。  
**验收重点**：公众获得了好听版本，代价只由陈澄和观众看见。

### 20｜`hbln-e03-exit-together`｜15s｜HappyHorse 1.1 R2V

**模型输入**：`[Image 1]=REF-08/METRO 清晨地铁站`；`[Image 2]=REF-03`；`[Image 3]=REF-04`；`[Image 4]=REF-07`。  
**生产依赖**：S06C 的审核结论；玩家通过 S06 结局确认停点后，使用叙事硬切进入清晨地铁站，不声明精确首帧。

**Positive prompt**

```text
Create a quiet early-morning Singapore metro-platform epilogue. Cheng and Maya sit side by side, exhausted but safe, with the exact cassette sealed in the transparent evidence bag and Maya's DV switched off beside her. Cheng uses a real marker to write only on a locked precomposed label area; do not generate letterforms. Maya speaks gently, then Cheng answers. A passing train casts moving light across them without obscuring faces. End with both women holding the evidence bag together.
```

**Shot timeline**

```text
0.0–2.5s static wide establishing shot of the nearly empty platform; both women and all evidence visible.
2.5–5.0s close-up as Cheng places the cassette in the transparent bag and marks the locked blank label plate.
5.0–7.5s Maya turns and naturally forms her English line.
7.5–10.0s Cheng naturally forms her answer and slides the bag between them.
10.0–12.0s approaching train light sweeps across their faces; neither flinches.
12.0–15.0s both place one hand on the evidence bag in a stable shared frame.
```

**专属负面**：模型生成手写姓名、繁忙高峰人群、品牌地铁 logo、浪漫情侣语汇。  
**验收重点**：结局是“共同暂存证据”，不是销毁或隐瞒。

### 21｜`hbln-e04-seventh-gong`｜15s｜Wan 2.7 First + Last Frame

**模型输入**：`[Start Frame]=S00 审核首帧`；`[End Frame]=E04 锁定黑场前构图`。  
**生产依赖**：REF-01、REF-02、REF-03、REF-04 只用于制作并审核 `[End Frame]`，不随本任务提交。

**Positive prompt**

```text
Recreate the opening composition from the exact [Start Frame] with pixel-comparable lens height, entrance axis and sodium lighting, but Cheng is now alone in physical reality. Maya appears only inside the DV screen as a recognizable translucent 1994 visitor trace wearing her locked olive-green rain jacket. Cheng presses play and realizes the opening is repeating. The lost architectural dragon entrance begins to reappear behind her while she cannot see it. Move continuously toward the exact supplied [End Frame], then cut to pure black only at the final instant.
```

**Shot timeline**

```text
0.0–2.5s exact opening-frame recreation with Cheng alone; camera and architecture match [Start Frame].
2.5–5.0s Cheng presses play and watches the DV screen rather than the distant entrance.
5.0–7.5s rack focus into the DV screen, where Maya appears as a translucent visitor trace and naturally forms her repeated opening line.
7.5–10.0s focus returns to Cheng as she reacts to off-screen Lin; behind her, aged bulbs begin revealing the dragon architecture.
10.0–12.5s slow push to Cheng's realization while the dragon mouth reaches the same scale as the opening.
12.5–14.6s arrive exactly at [End Frame], hold without new movement.
14.6–15.0s hard cut to pure black for the seventh gong in post-production.
```

**专属负面**：Maya 实体出现在现实、不同入口机位、柔和淡出、生成可见声波。  
**验收重点**：观众必须在 5 秒内意识到“开场重演但 Maya 已变成回声”。

### 4.1 全镜头微表演与结束状态补充轨

下表与各镜头 `Shot timeline` 同时生效，正式编译时按时间码合并，不是备注。它专门补足人物近景中最容易被模型省略的眼神顺序、呼吸、握力、口型克制与下游连续性。若本表与锁定首尾帧冲突，以已审核锁定帧为准并阻塞提示词发布，不能静默忽略。

| 片段 | 微表演／生理反应轨                                                                                                                                                                                                                                                                                                                                                                                                 | 结束状态合同                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| S00  | 已完整写入主时间轴。核心顺序为：看见 REC 反光 → 浅吸气按键 → 眼球先于头部寻找灯源 → 跟随门票下落 → 吞咽 → 听见外公后屏息半秒。                                                                                                                                                                                                                                                                                     | 已完整写入主时间轴；C1 前稳定 2 秒。                                                              |
| S01A | 0.0–1.5s 陈澄拇指按键时下颌微收，像在确认自己真的选择了它；1.5–4.0s 灯光每亮一层，她的眼睛便跟随一次，但身体被吸引般只前移半步；4.0–7.5s 残影从两侧经过时 Maya 先压低肩膀保护 DV，再靠近陈澄；7.5–10.0s 林倒影抬手后陈澄呼吸放慢，怀念暂时压过戒备；10.0–12.3s Maya 提问时目光始终落在陈澄侧脸，陈澄听完才转眼，不抢口型。                                                                                         | 13.0–15.0s 两人抵达 JF-01：陈澄居中持带、Maya 左侧持 DV、林倒影在右；两人闭口，诱惑尚未转成服从。 |
| S01B | 0.0–1.7s 陈澄翻带前先用拇指擦过无标签 B 面，动作迟疑而非熟练；1.7–3.0s 电火花只引发一次瞬间眨眼和肩部收紧，不尖叫；3.0–6.0s 她向暗处看时鼻翼轻张、呼吸变浅；6.0–8.5s 林击玻璃后 Maya 先看玻璃再看陈澄，眉心由恐惧转为怀疑；8.5–11.8s 质问时音量克制，句尾嘴唇不立即闭合，等待解释；陈澄避开视线，握带指节变白。                                                                                                    | 13.0–15.0s 精确抵达 JF-01；Maya 的怀疑视线仍停在陈澄身上，陈澄不作答。                            |
| S02A | 0.0–2.2s 陈澄说“外公”前喉部先有一次吞咽，开口时眉心短暂松开；2.2–4.5s 残影转头后她眼神从希望转为不安，嘴唇闭合；4.5–7.0s 听画外回应时不做口型，只用缓慢吸气表现被拉近；7.0–10.0s Maya 发现水先低头再抬眼警告，抓陈澄手臂时力度真实；10.0–12.8s 两项风险出现后陈澄视线在 Maya、卡带之间快速来回一次，然后定住。                                                                                                     | 12.8–15.0s 精确抵达 JF-02；Maya 靠栏杆失去一步，卡带将从湿手滑落，任何一项都未被提前挽救。        |
| S02B | 0.0–2.5s 陈澄给 Maya 戴耳机时手指避开耳廓，动作轻但因紧张略抖；坦白后不敢立刻看 Maya；2.5–5.0s Maya 听录音时眼睛由陈澄移向空处，眉心慢慢收紧，承认台词说完后短促呼气；5.0–7.0s 陈澄问句很轻，身体不后退，只用眼神确认；7.0–10.0s Maya 举 DV 时重新进入工作状态，呼吸稳定；10.0–12.0s 水出现后两人同时反应，但 Maya 先失足、陈澄后滑带；12.0–12.8s Maya 取下单只耳塞，让红线自然垂回卡带机，以便两条 S02 分支合流。 | 12.8–15.0s 精确抵达 JF-02；Maya 已取下耳塞，DV 朝向门缝，风险不被解决。                           |
| S03A | 0.0–2.0s 栈道下沉时 Maya 先倒吸一口气、手掌抓紧栏杆；2.0–4.8s 陈澄看清 Maya 后立即松带，双手先后锁住前臂与手腕，发力时下颌咬紧；4.8–6.8s Maya 的急促台词夹在呼吸之间，不做哭喊；6.8–9.0s 卡带落水时陈澄只看一眼便继续把 Maya 拉稳；9.0–11.2s 取回湿带后她说“活人先出去”，语气低而确定，目光先看 Maya 再看带子；11.2–13.0s 看到日志时两人呼吸逐渐恢复。                                                             | 13.0–15.0s 抵达 JF-03；卡带有统一水珠，Maya 右掌只有轻微擦伤，两人并肩看日志并闭口。              |
| S03B | 0.0–2.8s 陈澄扑向卡带的动作快但不英雄化，目光始终锁在道具；Maya 从她伸手方向理解选择，表情先错愕后迅速自救；2.8–5.2s Maya 抓栏杆时咬紧牙关、掌心擦伤后短促吸气，不惨叫；5.2–7.0s DV 落地时她下意识伸手但够不到；7.0–9.5s 陈澄抬眼看日志前先确认卡带无损；9.5–11.8s 林忏悔时陈澄的胜利感消失，目光落到 Maya 受伤的手；11.8–13.0s 她想开口但最终闭嘴。                                                               | 13.0–15.0s 抵达同一 JF-03；外观状态标准化，Maya 与陈澄之间保留明显但克制的距离感。                |
| S04A | 0.0–2.5s Maya 主动走到陈澄身侧，说话时先看她的手再看她的脸；陈澄肩膀轻微放松；2.5–5.0s 插线时两人分别固定接口和设备，避免单手悬空操作；5.0–8.0s 两条反光出现时两人的视线分向两侧，随后同时回到彼此；8.0–10.5s 林口型出现时陈澄听而不回应，Maya 观察她是否动摇；10.5–12.8s 确认目光只持续半秒，然后共同伸手。                                                                                                       | 12.8–15.0s 抵达 JF-04；两只不同的手分别靠近两轨，工牌、卡带、DV 连接状态清楚，表现“共同决定”。    |
| S04B | 0.0–3.2s 陈澄读责任陈述时呼吸均匀、声音不提高；念到林的责任时眼睛从日志抬向倒影，眉心由犹疑变坚定；3.2–5.5s 裂纹出现后她不后退，只眨眼一次；5.5–7.8s 取工牌时拇指先擦过水珠和边缘，像确认名字真实存在；7.8–10.0s 林受伤的问句让她下颌短暂松动，但目光不躲；10.0–12.5s 回答后以克制动作把工牌放下。                                                                                                                 | 12.5–15.0s 抵达 JF-04；工牌成为画面物理焦点，陈澄手从工牌上收回，未替玩家选轨。                   |
| S04C | 0.0–2.8s 陈澄合日志时手掌在封面停顿半秒，辩护台词像说服自己，句尾呼吸泄出；2.8–5.0s 林倒影稳定后她眼神产生短暂安慰；5.0–7.8s Maya 进入前景时先压住怒气再质问，眉心紧但不推搡；7.8–10.5s 林示意开园曲时陈澄眼神跟随手势，呼吸放缓；10.5–12.8s 她的手接近按钮后食指悬停，拇指轻颤，最终没有下压。                                                                                                                    | 12.8–15.0s 抵达 JF-04；陈澄的手悬在两轨之间，Maya 保持注视，工牌仍存在且可见。                    |
| S05A | 0.0–2.0s 陈澄按下 Salmah 轨前先看一眼 Maya，得到极小点头后才下压；2.0–5.0s 残影转向出口时两人不是喜悦，而是屏息观察是否安全；5.0–7.5s Maya 先发现检修门，眼睛和下颌指向出口但脚不离位；7.5–10.0s 林警告时陈澄闭口直视倒影，握力从紧到松；10.0–12.5s Maya 提醒后，两人同时看向上传线与退带键，明白仍有代价。                                                                                                        | 12.5–15.0s 精确抵达 JF-05；陈澄中央、Maya 左、林倒影右，上传与退带两种物理动作都清楚，C6 前稳定。 |
| S05B | 0.0–2.0s 陈澄按开园曲时动作比此前更熟练，显示她接受了诱惑；2.0–5.0s 灯亮后她的眼神短暂柔和，Maya 则持续寻找出口；5.0–7.5s 林说话时陈澄几乎露出怀念的笑，但在句尾收住；7.5–10.0s Maya 反对时胸口起伏变快，仍保持低声；10.0–12.5s 陈澄听见入口闭合后笑意消失，眼睛先看后方再看退带键，问句带迟来的恐惧。                                                                                                             | 12.5–15.0s 抵达 JF-05；美丽灯光仍亮，但人物已意识到被困，不能拍成胜利停点。                       |
| S05C | 0.0–3.0s 双轨交替时陈澄眼睛在左右墙面之间跟随，Maya 闭眼半秒分辨声音；3.0–5.5s 雕塑遮耳引发 Maya 一次克制皱眉，陈澄不作夸张反应；5.5–8.0s 看见双推子后陈澄的两只手各靠近一侧但不接触；8.0–10.0s Maya 的台词语速平稳，强调冲突没有被解决；10.0–12.5s 林示意时陈澄看向他，听见另一侧画外音又转回，呼吸停顿在选择之间。                                                                                               | 12.5–15.0s 抵达 JF-05；两轨仍冲突、无人移动推子，三角构图稳定。                                   |
| S06A | 0.0–2.5s 陈澄插线前确认接口方向，Maya 用一手托住设备避免拉扯；按传输键后两人都不庆祝；2.5–5.0s 完整波形出现时陈澄缓慢吸气，像接受不可撤回；5.0–8.0s 声明分两次呼吸说完，提到责任时看林，提到 Salmah 时看工牌；8.0–10.8s 林听完先垂眼、吞咽，再主动放下推子；10.8–12.8s 告别口型轻且稳定；门锁释放后陈澄眼里有泪光但不落泪。                                                                                        | 12.8–15.0s 两人背向控制台面向真实出口，林倒影变淡但仍在，所有证据仍随身，无胜利姿势。             |
| S06B | 0.0–2.3s 陈澄按传输时仍以为自己在做正确选择；2.3–5.0s 次波形变平，她先眯眼确认而不是立刻惊慌；5.0–7.2s Maya 指向波形时声音急但手势只做一次；7.2–9.8s 掌声残影出现后陈澄不看它们，目光持续追踪被抹去的轨道；9.8–12.3s 林重复熟悉台词时她的眉心慢慢收紧，明白自己再次编辑了真相；12.3–15.0s 嘴唇微张却没有辩解。                                                                                                     | 末帧只保留陈澄与被压平轨道的双重倒影；Maya 在景深内，人物闭口，后果不可逆。                       |
| S06C | 0.0–2.0s 陈澄退带后立即贴近身体保护，再抬眼找 Maya；2.0–4.0s 说“走”时先伸手再开口，语气不是英雄命令而是共同求生；4.0–7.0s 奔跑中两人保持真实喘息和步幅，手不松开，道具随身体重量摆动；7.0–9.5s 到电箱后两人先对视确认，再分别找稳握点；9.5–11.0s 同时发力拉闸，手臂与肩背承担阻力；11.0–13.2s 回到现实后两人继续跑两步才停。                                                                                       | 13.2–15.0s 现实入口稳定远景；两人安全、仍牵手或肩并肩，卡带和 DV 全部可见，龙口完全消失。         |
| S06D | 0.0–2.0s 陈澄先收好卡带再找 Maya，这个动作顺序必须清楚；2.0–4.5s 发现玻璃后她先眨眼确认反射，再快速靠近；4.5–7.0s 两掌隔玻璃对齐，Maya 的台词温柔且接受现实，陈澄呼吸急促但闭口；7.0–9.2s 倒带开始时陈澄低头一瞬又立刻看回 Maya，显示她仍被带子牵引；9.2–11.5s 林说闭园时 Maya 肩膀轻降；11.5–13.2s 陈澄叫名并击玻璃一次，声音将在后期由克制转为破裂。                                                             | 13.2–15.0s Maya 逐渐成为可辨认残影但不死亡、不受伤；DV 留在她身边；陈澄隔玻璃持带，空间轴线清楚。 |
| E01  | 0.0–3.0s 清晨空间先给观众恢复呼吸；3.0–6.0s 两人并肩但不贴近，疲惫仍在；6.0–9.0s 陈澄听档案时闭口，眼神从音频站移向 Salmah 的锁定版面，泪光出现但不落泪；9.0–11.5s 旁白优先画外，若保留画内口型则只形成一句，气息稳定；11.5–15.0s 她看 Maya，Maya 以极小点头回应。                                                                                                                                                 | 两人共同倒映在黑屏中，晨光缓慢进入；不是领奖、宽恕或圆满笑容。                                    |
| E02  | 0.0–3.0s 游客的快乐保持日常，不表演邪恶；3.0–5.5s 拉焦到陈澄后，她的身体静止、眼睛却跟随游客离开；5.5–8.0s 看到次轨被遮，她先屏息再缓慢呼气；8.0–10.5s 林倒影出现时她没有转头，表示已经不再追随；10.5–12.0s 轻声说出 Salmah 名字，第二个音节微颤但不哭；12.0–15.0s 人群清空后她独自承受结果。                                                                                                                      | 陈澄独站在被遮轨道旁，亮展览与暗现实分层明确，闭口静止至结尾。                                    |
| E03  | 0.0–2.5s 两人疲惫而警觉，坐姿保留昨夜湿衣和轻伤；2.5–5.0s 陈澄装袋时双手慢而谨慎，封口后拇指确认一次；5.0–7.5s Maya 台词轻，先看证物再看陈澄；7.5–10.0s 陈澄回答时把袋子推到两人中间，不据为己有；10.0–12.0s 车灯扫过时她们同时眨眼但不惊跳；12.0–15.0s 两只手先后落到袋上。                                                                                                                                       | 稳定共享构图；证物袋位于两人之间，DV 关闭且在 Maya 侧，无情侣化身体语言。                         |
| E04  | 0.0–2.5s 陈澄独处时姿势复刻开场，但肩膀更低、握带更紧；2.5–5.0s 按播放后只看 DV，拒绝再看入口；5.0–7.5s Maya 在屏幕里说开场台词时眼神平静，陈澄的呼吸停住；7.5–10.0s 陈澄听林画外音后眼球先向后方偏移，却没有勇气转身；10.0–12.5s 她的下唇轻颤、眼眶变红，龙口在背后达到开场尺度；12.5–14.6s 她终于理解循环，所有微动作停止。                                                                                      | 14.6s 前精确抵达 E04-PREBLACK-END 并静止；14.6–15.0s 只允许硬切纯黑，不允许淡出或新增动作。       |

## 5. 后期对白与口型时间表

生成模型的原生音轨不进入母版；下表只用于表演口型审核和后期配音对齐。画外音、广播、录音均要求画面内人物闭口。

| 片段 | 画面内口型窗口                                | 画外音／后期声音                        |
| ---- | --------------------------------------------- | --------------------------------------- |
| S00  | Maya 5.5–7.0；陈澄 10.8–11.8                  | 第一声锣；林国声广播                    |
| S01A | Maya 10.4–11.8                                | 开园曲；林国声广播；第二声锣            |
| S01B | 林倒影 7.0–8.0；Maya 9.5–11.0                 | Salmah 录音；电火花；第二声锣           |
| S02A | 陈澄 0.7–2.0                                  | 林国声广播；Maya 警告可改画外；第三声锣 |
| S02B | 陈澄 0.8–2.3；Maya 3.4–4.9；陈澄 5.8–6.7      | 隐藏录音；第三声锣                      |
| S03A | Maya 4.8–6.8；陈澄 9.8–11.0                   | Salmah 录音；第四声锣                   |
| S03B | 林倒影 9.8–11.4                               | Maya 台词可画外；第四声锣               |
| S04A | Maya 0.7–2.2；林倒影 8.0–10.5                 | Salmah 录音；第五声锣                   |
| S04B | 陈澄 0.0–3.2、10.0–12.5；林倒影 7.8–10.0      | 第五声锣                                |
| S04C | 陈澄 0.6–2.5；Maya 5.8–7.3；林倒影 7.8–10.5   | 第五声锣                                |
| S05A | 林倒影 7.5–10.0；Maya 10.0–12.5               | Salmah 录音；第六声预响                 |
| S05B | 林倒影 5.0–7.5；Maya 7.5–10.0；陈澄 10.0–12.5 | 开园曲；第六声预响                      |
| S05C | Maya 8.0–10.0；林倒影 10.0–12.5               | Salmah 录音；双轨；第六声预响           |
| S06A | 陈澄 5.0–8.0；林倒影 10.8–12.8                | 第六声锣；Salmah 录音                   |
| S06B | Maya 5.0–7.2；林倒影 9.8–12.3                 | 掌声；第六声锣                          |
| S06C | 陈澄 2.0–4.0                                  | Maya 可画外；半声锣；断电               |
| S06D | Maya 5.0–6.5；林倒影 9.2–11.5；陈澄 11.5–13.2 | 第六声锣；倒带声                        |
| E01  | 建议全部闭口                                  | 陈澄旁白；林国声旧录音                  |
| E02  | 陈澄 10.5–12.0                                | 开园广播；第七声轻锣                    |
| E03  | Maya 5.0–7.5；陈澄 7.5–10.0                   | 地铁环境；未完成锣声                    |
| E04  | DV 内 Maya 5.0–7.5                            | 林国声广播；第七声锣                    |

## 6. 生成前阻塞项

在以下事项完成前，本文仍是提示词锁定稿，不得提交任何 HappyHorse 或 Wan 任务：

1. REF-01 至 REF-08 全部产出并通过人物、空间、道具与权利审核。
2. 陈澄、Maya 的角色参考完成一致性测试；林国声参考确认永不展示清晰正脸。
3. S00 先行生成并审核；S00-FIRST、S00-LAST、JF-01 至 JF-05、E04-PREBLACK-END 必须作为独立资产完成审核和 checksum 登记；Frame 任务只能绑定本文声明的锁定帧。
4. 事故日志、工牌、展览页面等所有可读文字先制作锁定平面，不让视频模型生成文字。
5. 六层选择停点与 S06A–D 四个结局确认停点全部用 UI 安全框预演，确认人物脸、手和核心道具不被交互层遮挡。
6. 每条片先按画面审核；生成模型携带的原生音轨全部丢弃，锁定对白与声音只在画面通过后进入配音和混音。
7. 任意分支输出若发生身份、服装、湿度、擦伤或道具状态漂移，必须重做，不能靠后期解释。

## 7. 首轮生产顺序

1. 只做 `S00`，锁定真实入口→龙口回声的视觉语法与选择停点。
2. 从已批准 S00 Take 提取并审核 S00-FIRST 与 S00-LAST；依据 REF-01–08 制作并审核 JF-01 至 JF-05 与 E04-PREBLACK-END，锁定每张输入帧的版本、资产 ID 与 SHA-256。
3. 用 S00-LAST 与 JF-01 分别做 `S01A / S01B`，验证同首帧分叉、同尾帧合流的一致性。
4. 先打通一条真结局路径：`S00 → S01B → S02B → S03B → S04B → S05A → S06A → 结局确认停点 → E01`。
5. 真结局链通过后再生产 echo、bond 与循环链；结局镜头最后统一生产。
6. 每个镜头晋级后冻结输入帧、输出首末帧与成片哈希，作为回归验收基准；共享下游只认 Join Frame，不按前驱动态替换首帧。
