# 素材清单与生产准入

状态：DRAFT · v0.5
最后更新：2026-07-11
说明：本文维护素材族与生产准入；逐镜任务见 [13-SEASON-01-SHOT-LIST.md](./13-SEASON-01-SHOT-LIST.md)，不沿用旧素材编号。

## 1. 稳定编号

格式：S{季}-SC{场}-B{节拍}-{类型}-{变体}

示例：S01-SC08-B03-VIDEO-REACT-SHIELD

序章使用 `S{季}-P00-B{节拍}-{类型}-{变体}`，不伪造 `SC00`。稳定 ID 不携带 `V01/V02` 版本后缀；提示、模型或文件修订写入 `promptVersion` 与生成记录，避免运行时引用随版本漂移。

类型：

- IMG：Seedream 5 图片；
- VIDEO：Seedance 2.0 视频；
- AUDIO：SeedAudio 或后期声音；
- MODEL：GLTF / 3D 模型；
- PANO：360°全景；
- TEXTURE：UI、材质和合成纹理；
- DATA：相机、灯光、锚点轨道及不得经过有损编码的 depth/occlusion PNG sequence manifest；
- SUBTITLE：字幕与时间码；
- POSTER：视频海报与首尾帧。

## 2. 状态

- DRAFT：需求未评审，禁止生成。
- REVIEWED：用途与构图通过，可做有限参考测试。
- LOCKED：提示词、参考包、规格和依赖确定，可正式生成。
- GENERATING：任务执行中。
- REVIEW：结果待连续性与质量验收。
- APPROVED：可以进入正式构建。
- REJECTED：保留原因，不作为回退素材使用。

## 3. 准入规则

正式生成任务必须同时满足：

- 场景卡至少 REVIEWED；
- 人物、服装、场景和道具参考包已 LOCKED；
- 起始构图、结束构图和选择等待点明确；
- 台词、字幕和声音职责明确；
- 输出尺寸、时长、画幅、安全区和命名明确；
- 预计生成次数和验收人明确；
- 生成配置从本地环境读取，不把密钥或签名 URL 写入仓库。

## 4. 第一季素材族

| 素材族 ID        | 场景         | 内容                                                                 | 主要工具                                  | 当前状态 |
| ---------------- | ------------ | -------------------------------------------------------------------- | ----------------------------------------- | -------- |
| S01-CHAR-DAIYU   | 全季         | 黛玉身份、妆发、服装、表演                                           | Seedream + Seedance                       | DRAFT    |
| S01-CHAR-BAOYU   | 全季         | 宝玉身份、妆发、服装、表演                                           | Seedream + Seedance                       | DRAFT    |
| S01-CHAR-XIFENG  | 全季         | 熙凤身份、妆发、服装、表演                                           | Seedream + Seedance                       | DRAFT    |
| S01-CHAR-JIAMU   | 全季         | 贾母身份、妆发、服装、表演                                           | Seedream + Seedance                       | DRAFT    |
| S01-CHAR-WANG    | 全季         | 王夫人身份、妆发、服装、表演                                         | Seedream + Seedance                       | DRAFT    |
| S01-CHAR-XIREN   | SC07–SC09    | 袭人身份、服装、声音、动作                                           | Seedream + Seedance                       | DRAFT    |
| S01-PLAYER-POV   | 全季         | 手/袖口 GLTF、动作、干净底片、depth/occlusion、相机/灯光/锚点 bundle | Seedream + Seedance + DCC/GLTF + Three.js | DRAFT    |
| S01-P00-ENV      | 无字命册     | 太虚双画幅 matte、雾、水面、远影                                     | Seedream + Seedance                       | REVIEW   |
| S01-P00-LEDGER   | 无字命册     | 侧边穿孔缝线命册的 OPENING、CONFIRM 与 TRANSITION 横竖视频           | Seedance；DCC/GLTF 仅作 PREVIS            | REVIEW   |
| S01-P00-DATA     | 无字命册     | 动态姓名、印记、表单、声音 cue 与发布路由                            | HTML / Canvas + Release DATA              | REVIEW   |
| S01-P00-AUDIO    | 无字命册     | 翻书、模糊点名、未知女声、拟音、动态音乐与 SC01 音桥                 | SeedAudio + Tone.js + 后期                | DRAFT    |
| S01-P00-FILM     | 无字命册     | 无姓名印迹特写转秦淮与车厢的 16:9 / 9:16 独立转场                    | Seedance + 后期                           | DRAFT    |
| S01-SC01-ENV     | 秦淮醒来     | 车内、秦淮、荣府方向                                                 | Seedream                                  | DRAFT    |
| S01-SC01-FILM    | 秦淮醒来     | 主片与三种注意力反应                                                 | Seedance                                  | DRAFT    |
| S01-SC01-LETTER  | 秦淮醒来     | 动态姓名荐书与淡红印                                                 | Seedream + Web 合成                       | DRAFT    |
| S01-SC02-ENV     | 荣府门前     | 大门、石阶、林家轿与站位                                             | Seedream                                  | REVIEW   |
| S01-SC02-FILM    | 荣府门前     | 主片、等待片、A/B/C 门上反应                                         | Seedance                                  | REVIEW   |
| S01-SC03-ENV     | 游廊风灯     | 游廊空间与动作方向                                                   | Seedream                                  | DRAFT    |
| S01-SC03-FILM    | 游廊风灯     | 主动作链、A/B/C/无动作后果                                           | Seedance                                  | DRAFT    |
| S01-SC03-LANTERN | 游廊风灯     | 灯罩、挂钩、火光状态                                                 | Seedream                                  | DRAFT    |
| S01-SC04-ENV     | 贾母相见     | 正厅、座次和人物同框                                                 | Seedream                                  | DRAFT    |
| S01-SC04-FILM    | 贾母相见     | 原著情感主片、三种观察特写                                           | Seedance                                  | DRAFT    |
| S01-SC05-ENV     | 熙凤验客     | 侧厅和递信动线                                                       | Seedream                                  | DRAFT    |
| S01-SC05-FILM    | 熙凤验客     | 主片、等待片、四条真人反应                                           | Seedance                                  | DRAFT    |
| S01-SC06-ENV     | 王夫人的边界 | 王夫人房与三处安置预示                                               | Seedream                                  | DRAFT    |
| S01-SC06-FILM    | 王夫人的边界 | 告诫主片与三种安置反馈                                               | Seedance                                  | DRAFT    |
| S01-SC07-ENV     | 似曾相识     | 宝黛初见正厅连续空间                                                 | Seedream                                  | DRAFT    |
| S01-SC07-FILM    | 似曾相识     | 原著主片、玩家问答、四条反应                                         | Seedance                                  | DRAFT    |
| S01-SC08-JADE    | 玉声骤起     | 通灵宝玉图片、3D、丝绦与声音                                         | Seedream + GLTF + SeedAudio               | DRAFT    |
| S01-SC08-FILM    | 玉声骤起     | 摔玉主片与四条独立后果                                               | Seedance                                  | DRAFT    |
| S01-SC08-AUDIO   | 玉声骤起     | 玉、衣料、混乱、音乐分轨                                             | SeedAudio + 后期                          | DRAFT    |
| S01-SC09A-FILM   | 黛玉近房     | 主动探望与夜谈变体                                                   | Seedance                                  | DRAFT    |
| S01-SC09B-FILM   | 外院记录     | 查验记录与廊下夜谈                                                   | Seedance                                  | DRAFT    |
| S01-SC09C-FILM   | 熙凤厢房     | 物品被动过与门外提醒                                                 | Seedance                                  | DRAFT    |
| S01-SC09-REACT   | 同为客       | 四条坦白/保密反应                                                    | Seedance                                  | DRAFT    |
| S01-SC10-PANO    | 谁来写命     | 三种房间入口的 360°空间                                              | Seedream + Pano/Three.js                  | DRAFT    |
| S01-SC10-LETTER  | 谁来写命     | 可旋转荐书与线索材质                                                 | Seedream + GLTF                           | DRAFT    |
| S01-SC10-AUDIO   | 谁来写命     | 夜间空间与线索响应音乐                                               | SeedAudio + Tone.js                       | DRAFT    |
| S01-E01-FILM     | 同是天涯客   | 黛玉递灯独立结局                                                     | Seedance                                  | DRAFT    |
| S01-E02-FILM     | 府中有位     | 熙凤递名帖独立结局                                                   | Seedance                                  | DRAFT    |
| S01-E03-FILM     | 空白命册     | 荣府与太虚叠化隐藏结局                                               | Seedance + Three.js                       | DRAFT    |
| S01-E04-FILM     | 一夜还乡     | 侧门、秦淮与条件送别                                                 | Seedance                                  | DRAFT    |
| S01-E05-FILM     | 玉声断梦     | 被带离厅堂与命册晕字                                                 | Seedance + Three.js                       | DRAFT    |
| S01-UI-TEXTURE   | 全季         | 命册、印、云锦和章节纹理                                             | Seedream                                  | DRAFT    |
| S01-UI-ICON      | 全季         | 通用操作图标                                                         | 项目图标库                                | DRAFT    |
| S01-SUBTITLES    | 全季         | zh-CN / zh-HK / en-US 字幕                                           | 文本与时码                                | DRAFT    |

### 4.1 PLAYER-POV 正式资产包

下列项目是正式运行时输入，不得用第 6 节的视觉参考图或当前旧视频代替。它们在连续性、标定和 GPU 合成验收完成前保持 DRAFT：

| 资产 ID                      | 类型  | 内容                                                                | 当前状态 |
| ---------------------------- | ----- | ------------------------------------------------------------------- | -------- |
| PLAYER-POV-HAND-RIG-V01      | MODEL | 手、前臂、三手型、三袖口、五肤色材质、骨骼、七项标准动画与 Rig 锚点 | DRAFT    |
| S01-PLAYER-POV-CLEAN-PLATES  | VIDEO | 各动作镜头无玩家身体、显示参照、可 CORS 读取的干净视频底片          | DRAFT    |
| S01-PLAYER-POV-DATA-PLANES   | DATA  | 与底片逐帧同步的 depth/occlusion PNG sequence v1 与 manifest        | DRAFT    |
| S01-PLAYER-POV-TRACK-BUNDLES | DATA  | camera、lighting、transform/collision/safety/mask anchor 轨道       | DRAFT    |

### 4.2 P00 正式任务与资产包

P00 使用 `P00-PROD-CARD-V02` 视频主轨。以下 ID 和规格是当前目标结构；运行时 Release 只引用发布媒体 assetId，不直接读取本表中的供应商、提示词或 REVIEW 状态。V01 实时 GLB 方案已经废止。

| canonical task ID               | 形态                                         | 目标时长 | 当前状态 |
| ------------------------------- | -------------------------------------------- | -------- | -------- |
| S01-P00-B01-AUDIO-OPENING       | 黑场 + 独立 SeedAudio 分轨                   | 10–14s   | DRAFT    |
| S01-P00-B02-VIDEO-OPENING       | Seedance 横竖 MAIN + 显式 `hold-last-frame`  | 12s      | REVIEW   |
| S01-P00-B02-VIDEO-CREATION-WAIT | 可选 Seedance 横竖 WAIT；当前 Preview 不引用 | 6s loop  | DRAFT    |
| S01-P00-B02-INTERACTIVE-PROFILE | HTML / Canvas 动态叠加                       | 70–100s  | REVIEW   |
| S01-P00-B03-VIDEO-CONFIRM       | Seedance 横竖 CONFIRM                        | 6s       | REVIEW   |
| S01-P00-B03-VIDEO-TRANSITION    | Seedance 横竖独立转场 + 音桥                 | 7s       | DRAFT    |

| 资产 ID                                          | 类型     | 母版规格                                           | 提示与结构约束                                                                                  | 依赖与验收                                                                   | 状态   |
| ------------------------------------------------ | -------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| S01-P00-B02-IMG-MATTE-TAIXU-16X9                 | IMG      | 3840×2160 PNG，16:9                                | 真实秦淮黑水、湿雾、冷月与稀疏暖灯；无前景散纸、命册、按钮、人物近景、伪字或现代南京            | 引用 `VISUAL-DIRECTION-01` 与 `LOCATION-TAIXU-REF-V01`；命册与表单安全区通过 | REVIEW |
| S01-P00-B02-IMG-MATTE-TAIXU-9X16                 | IMG      | 2160×3840 PNG，9:16 独立构图                       | 与横版保持同一远岸和光源，但不得直接裁切横版                                                    | 月、水面与远建筑保留至少两层纵深；移动表单不遮挡空间信息                     | REVIEW |
| S01-P00-B02-VIDEO-OPENING                        | VIDEO    | 1920×1080，16:9，12s，24fps，288 帧，无内嵌音轨    | 空水面 → 侧线装空白命册出现并打开 → 最后两秒稳定；无文字、手、魔法粒子                          | Seedance REVIEW；完整解码、结构、环境与标题安全区验收                        | REVIEW |
| S01-P00-B02-VIDEO-OPENING-PORTRAIT               | VIDEO    | 1080×1920，9:16，12s，24fps，288 帧，无内嵌音轨    | 独立竖版重构，不裁横版；保留上部空间纵深与底部移动控制区                                        | 与横版共享动作节拍但独立构图；移动实机验收                                   | REVIEW |
| S01-P00-B03-IMG-CONFIRM-FIRST-16X9               | IMG      | 1920×1080 PNG；OPENING 第 287 帧                   | 直接从已校验 OPENING 横版终帧提取，不重新生成                                                   | CONFIRM 首帧连续性与减少动态 poster；SHA-256 锁定                            | LOCKED |
| S01-P00-B03-IMG-CONFIRM-FIRST-9X16               | IMG      | 1080×1920 PNG；OPENING 第 287 帧                   | 直接从已校验 OPENING 竖版终帧提取，不裁横版                                                     | CONFIRM 首帧连续性与减少动态 poster；SHA-256 锁定                            | LOCKED |
| S01-P00-B03-VIDEO-CONFIRM                        | VIDEO    | 1920×1080，16:9，6s，24fps，144 帧，无内嵌音轨     | 纸纤维与淡红扩散响应；无固定姓名、印面、手、笔、实体章、伪字或魔法粒子                          | Seedance task `cgt-20260711230241-l925r`；完整解码与动态叠加安全区复核       | REVIEW |
| S01-P00-B03-VIDEO-CONFIRM-PORTRAIT               | VIDEO    | 1080×1920，9:16，6s，24fps，144 帧，无内嵌音轨     | 独立竖版生成；同一纸纤维响应与约束，不裁横版                                                    | Seedance task `cgt-20260711230241-jshf5`；完整解码与移动构图复核             | REVIEW |
| S01-P00-B02-MODEL-LEDGER                         | MODEL    | GLB 2.0 参数化预演                                 | 只保留结构、尺寸与失败案例审计；不进入 Runtime Release、Seedance 直接输入或发布依赖             | D-020 已废止运行时用途                                                       | PREVIS |
| S01-P00-B03-TEXTURE-SEAL-MASK                    | TEXTURE  | 受控 SVG + 2048×2048 linear alpha                  | 不完全闭合方印、两处自然缺损、三段抽象水纹/折痕；非真实姓氏、宗教符号或品牌 Logo                | 人工矢量审看；不由生成模型决定最终印面；P00 不制作实体印章模型               | DRAFT  |
| S01-P00-B03-VIDEO-TRANSITION                     | VIDEO    | 1920×1080，16:9，7s，24fps，168 帧，无正式内嵌音轨 | 印迹与纸纤维成为秦淮水纹并进入车窗/轿帘反射；无粒子、传送门、正脸、固定姓名、乱码或现代天际线   | 第 0 帧匹配 CONFIRM 末帧的无姓名印迹特写；第 167 帧匹配 SC01；与音桥逐帧同步 | DRAFT  |
| S01-P00-B03-VIDEO-TRANSITION-PORTRAIT            | VIDEO    | 1080×1920，9:16，7s，24fps，168 帧，无正式内嵌音轨 | 独立竖版重构，不裁横版；使用相同印迹、光向、转化节拍与车厢终点                                  | 横竖两版连续性和事件帧一致；移动安全区通过                                   | DRAFT  |
| S01-P00-B03-POSTER-TRANSITION                    | POSTER   | 横竖版 start/end 共四个无损帧                      | 直接从正式视频第 0 帧和末帧导出，不另行生成                                                     | 文件 hash 与视频真实帧对应                                                   | DRAFT  |
| S01-P00-B{01,02,03}-AUDIO-\*                     | AUDIO    | 48kHz / 24-bit WAV；具体时长与变体见 P00 生产卡    | 未知女声不明确对应警幻仙姑；无恐怖/ASMR；无实体印章撞击；环境、对白、拟音、音乐和 SC01 音桥分轨 | 声音卡、无缝循环、逐帧音桥、手机与耳机验收通过；不交付不可拆混音             | DRAFT  |
| S01-P00-B{01,02,03}-SUBTITLE-{ZH-CN,ZH-HK,EN-US} | SUBTITLE | 事件触发 JSON，不使用一条固定 90–120s VTT          | 对白与关键非语言声音各有稳定 cueId；自由姓名不进入预录对白                                      | 三语言完整；静音可理解；交互停留时间变化不造成字幕漂移                       | DRAFT  |

表中的花括号和 `*` 只用于文档压缩展示；写入机器 manifest 时必须按 [14-SCENE-PRODUCTION-CARDS.md](./14-SCENE-PRODUCTION-CARDS.md) 的轨道表展开为独立 `assetId` 记录，禁止把通配符作为实际 ID。

当前内部 Preview Release 已引用通过机器规格检查与人工画面复核的 OPENING、CONFIRM 横竖 REVIEW 母版、环境/连续性 poster、受控 SVG 印记和 Profile action；使用显式 `hold-last-frame`，并记录全部 source assetId 与 SHA-256。CONFIRM 播放中的自由姓名与印记仍由媒体帧时钟驱动的 HTML overlay 合成，不烧进生成视频。它不等于 APPROVED Production Release；正式发布仍硬性阻断于 OPENING / CONFIRM 晋级、TRANSITION 横竖首尾帧连续性、未知女声声音卡和独立音轨。`PROP-LEDGER-REF-V01` 与 GLB V01 不得作为发布运行时依赖。

## 5. 已选视觉参考

| 参考 ID             | 文件                                                                                              | 用途                                                     | 状态               |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------ |
| VISUAL-DIRECTION-01 | [VISUAL-DIRECTION-01-WATER-REALISM.png](./visual/reference/VISUAL-DIRECTION-01-WATER-REALISM.png) | 全季写实、水面、纸张、灯火、淡红纹印和第一视角的视觉基准 | APPROVED-DIRECTION |

## 6. 待评审视觉参考

这些资产仅用于收敛造型和制作语言，不是最终 UI、视频首帧或可直接投产的 Seedance 参考包。

| 资产 ID                                     | 对应素材族                        | 文件                                                                                                               | 状态     | 阻断项                                                                              |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| CAST-ENSEMBLE-REF-V01                       | S01-CHAR-\*                       | [CAST-ENSEMBLE-REF-V01.png](./visual/review/CAST-ENSEMBLE-REF-V01.png)                                             | REJECTED | 宝玉违背原著双造型；不允许作为群像回退                                              |
| CHAR-DAIYU-CAST-A-REF-V01                   | S01-CHAR-DAIYU                    | [CHAR-DAIYU-CAST-A-REF-V01.png](./visual/review/CHAR-DAIYU-CAST-A-REF-V01.png)                                     | REJECTED | 妆发过度；仅保留生成谱系，不允许回退                                                |
| CHAR-DAIYU-CAST-A-REF-V02                   | S01-CHAR-DAIYU                    | [CHAR-DAIYU-CAST-A-REF-V02.png](./visual/review/CHAR-DAIYU-CAST-A-REF-V02.png)                                     | REVIEW   | 关键同框、严格角度与真实服化形制复核                                                |
| CHAR-DAIYU-LIGHT-TEST-V01                   | S01-CHAR-DAIYU                    | [CHAR-DAIYU-LIGHT-TEST-V01.png](./visual/review/CHAR-DAIYU-LIGHT-TEST-V01.png)                                     | REVIEW   | 与贾母同框、第一视角近距离表演测试                                                  |
| CHAR-JIAMU-CAST-A-REF-V01                   | S01-CHAR-JIAMU                    | [CHAR-JIAMU-CAST-A-REF-V01.png](./visual/review/CHAR-JIAMU-CAST-A-REF-V01.png)                                     | REJECTED | 装饰过多且全身格略年轻；不允许回退                                                  |
| CHAR-JIAMU-CAST-A-REF-V02                   | S01-CHAR-JIAMU                    | [CHAR-JIAMU-CAST-A-REF-V02.png](./visual/review/CHAR-JIAMU-CAST-A-REF-V02.png)                                     | REVIEW   | 服化形制、正式首尾帧与声音表演测试                                                  |
| CHAR-JIAMU-LIGHT-TEST-V01                   | S01-CHAR-JIAMU                    | [CHAR-JIAMU-LIGHT-TEST-V01.png](./visual/review/CHAR-JIAMU-LIGHT-TEST-V01.png)                                     | REVIEW   | 正式视频光线与动作连续性测试                                                        |
| SC04-B01-EMOTION-BLOCKING-REF-V01           | S01-SC04-FILM                     | [SC04-B01-EMOTION-BLOCKING-REF-V01.png](./visual/review/SC04-B01-EMOTION-BLOCKING-REF-V01.png)                     | REVIEW   | 仅作情绪与手部调度参考，禁止作为 POV 首帧                                           |
| SC04-B01-POV-COFRAME-REF-V01                | S01-SC04-FILM                     | [SC04-B01-POV-COFRAME-REF-V01.png](./visual/review/SC04-B01-POV-COFRAME-REF-V01.png)                               | REJECTED | 黛玉身份不可辨；V02 已取代                                                          |
| SC04-B01-POV-COFRAME-REF-V02                | S01-SC04-FILM                     | [SC04-B01-POV-COFRAME-REF-V02.png](./visual/review/SC04-B01-POV-COFRAME-REF-V02.png)                               | REVIEW   | 黛玉回握、动态首尾帧和 9:16 实机重框                                                |
| CHAR-XIFENG-CAST-A-REF-V01                  | S01-CHAR-XIFENG                   | [CHAR-XIFENG-CAST-A-REF-V01.png](./visual/review/CHAR-XIFENG-CAST-A-REF-V01.png)                                   | REJECTED | 装饰、发髻和指人动作过度；不允许回退                                                |
| CHAR-XIFENG-CAST-A-REF-V02                  | S01-CHAR-XIFENG                   | [CHAR-XIFENG-CAST-A-REF-V02.png](./visual/review/CHAR-XIFENG-CAST-A-REF-V02.png)                                   | REVIEW   | 服化考据、动态表演和正式首尾帧测试                                                  |
| CHAR-XIFENG-LIGHT-TEST-V01                  | S01-CHAR-XIFENG                   | [CHAR-XIFENG-LIGHT-TEST-V01.png](./visual/review/CHAR-XIFENG-LIGHT-TEST-V01.png)                                   | REVIEW   | 动态转头、笑意层次和眼线连续性测试                                                  |
| SC05-B02-POV-WAIT-REF-V01                   | S01-SC05-FILM                     | [SC05-B02-POV-WAIT-REF-V01.png](./visual/review/SC05-B02-POV-WAIT-REF-V01.png)                                     | REVIEW   | 拉信首尾帧、WAIT 循环与 9:16 实机重框                                               |
| CHAR-BAOYU-CAST-A-REF-V01                   | S01-CHAR-BAOYU                    | [CHAR-BAOYU-CAST-A-REF-V01.png](./visual/review/CHAR-BAOYU-CAST-A-REF-V01.png)                                     | REJECTED | 违背原著正式装与家常装；不允许回退                                                  |
| CHAR-BAOYU-CAST-A-REF-V02                   | S01-CHAR-BAOYU                    | [CHAR-BAOYU-CAST-A-REF-V02.png](./visual/review/CHAR-BAOYU-CAST-A-REF-V02.png)                                     | REJECTED | 延续错误简化造型；不允许回退                                                        |
| CHAR-BAOYU-FORMAL-REF-V01                   | S01-CHAR-BAOYU                    | [CHAR-BAOYU-FORMAL-REF-V01.png](./visual/review/CHAR-BAOYU-FORMAL-REF-V01.png)                                     | REJECTED | 脸型偏硬、团纹过量、箭袖过宽；V02 已取代                                            |
| CHAR-BAOYU-FORMAL-REF-V02                   | S01-CHAR-BAOYU                    | [CHAR-BAOYU-FORMAL-REF-V02.png](./visual/review/CHAR-BAOYU-FORMAL-REF-V02.png)                                     | REVIEW   | 八团精确分配、裁片和双造型同脸复核                                                  |
| CHAR-BAOYU-HOME-REF-V01                     | S01-CHAR-BAOYU                    | [CHAR-BAOYU-HOME-REF-V01.png](./visual/review/CHAR-BAOYU-HOME-REF-V01.png)                                         | REJECTED | 长辫珠数跨视图不一致；V02 已取代                                                    |
| CHAR-BAOYU-HOME-REF-V02                     | S01-CHAR-BAOYU                    | [CHAR-BAOYU-HOME-REF-V02.png](./visual/review/CHAR-BAOYU-HOME-REF-V02.png)                                         | REVIEW   | 小辫结构、佩饰动作路径和同脸光线复核                                                |
| CHAR-BAOYU-DUAL-LOOK-LIGHT-TEST-V01         | S01-CHAR-BAOYU                    | [CHAR-BAOYU-DUAL-LOOK-LIGHT-TEST-V01.png](./visual/review/CHAR-BAOYU-DUAL-LOOK-LIGHT-TEST-V01.png)                 | REVIEW   | 双造型同脸成立；待动态转头、步态与声线测试                                          |
| SC07-B01-B02-COSTUME-TRANSITION-REF-V01     | S01-SC07-FILM                     | [SC07-B01-B02-COSTUME-TRANSITION-REF-V01.png](./visual/review/SC07-B01-B02-COSTUME-TRANSITION-REF-V01.png)         | REJECTED | 家常长辫错误置于胸前且珠数过量                                                      |
| SC07-B01-B02-COSTUME-TRANSITION-REF-V02     | S01-SC07-FILM                     | [SC07-B01-B02-COSTUME-TRANSITION-REF-V02.png](./visual/review/SC07-B01-B02-COSTUME-TRANSITION-REF-V02.png)         | REJECTED | 长辫已修正但寄名锁不清；V03 已取代                                                  |
| SC07-B01-B02-COSTUME-TRANSITION-REF-V03     | S01-SC07-FILM                     | [SC07-B01-B02-COSTUME-TRANSITION-REF-V03.png](./visual/review/SC07-B01-B02-COSTUME-TRANSITION-REF-V03.png)         | REVIEW   | 同门、同轴、同脸换装成立；待动态首尾帧                                              |
| SC08-B01-JADE-ACTION-BLOCKING-REF-V01       | S01-SC08-FILM                     | [SC08-B01-JADE-ACTION-BLOCKING-REF-V01.png](./visual/review/SC08-B01-JADE-ACTION-BLOCKING-REF-V01.png)             | REJECTED | 初始玉缺失且留存佩饰跨格不稳；V02 已取代                                            |
| SC08-B01-JADE-ACTION-BLOCKING-REF-V02       | S01-SC08-FILM                     | [SC08-B01-JADE-ACTION-BLOCKING-REF-V02.png](./visual/review/SC08-B01-JADE-ACTION-BLOCKING-REF-V02.png)             | REVIEW   | 摘玉与释放成立；四条 QTE 结果尚未测试                                               |
| PLAYER-POV-HAND-GEOMETRY-REF-V01            | S01-PLAYER-POV                    | [PLAYER-POV-HAND-GEOMETRY-REF-V01.png](./visual/review/PLAYER-POV-HAND-GEOMETRY-REF-V01.png)                       | REVIEW   | SLENDER/BROAD 网格与动态骨骼仍需验证                                                |
| PLAYER-POV-SLEEVE-WEAVE-REF-V01             | S01-PLAYER-POV                    | [PLAYER-POV-SLEEVE-WEAVE-REF-V01.png](./visual/review/PLAYER-POV-SLEEVE-WEAVE-REF-V01.png)                         | REVIEW   | 云水窄边织法与正常镜头层级复核                                                      |
| PLAYER-POV-SLEEVE-KIN-REF-V01               | S01-PLAYER-POV                    | [PLAYER-POV-SLEEVE-KIN-REF-V01.png](./visual/review/PLAYER-POV-SLEEVE-KIN-REF-V01.png)                             | REVIEW   | 斜纹绸、滚边与三动作碰撞测试                                                        |
| PLAYER-POV-SLEEVE-MEDIC-REF-V01             | S01-PLAYER-POV                    | [PLAYER-POV-SLEEVE-MEDIC-REF-V01.png](./visual/review/PLAYER-POV-SLEEVE-MEDIC-REF-V01.png)                         | REVIEW   | 内侧补缀需缩小并完成清洗/碰撞测试                                                   |
| PLAYER-POV-SKIN-MATERIAL-V01                | S01-PLAYER-POV                    | [PLAYER-POV-SKIN-MATERIAL-V01.png](./visual/review/PLAYER-POV-SKIN-MATERIAL-V01.png)                               | REVIEW   | 转换为受控 PBR 参数并做视频曝光匹配                                                 |
| PROP-LANTERN-REF-V01                        | S01-SC03-LANTERN                  | [PROP-LANTERN-REF-V01.png](./visual/review/PROP-LANTERN-REF-V01.png)                                               | REVIEW   | 提梁承重点、角片工艺与 GLTF 节点复核                                                |
| PLAYER-POV-ACTION-CATCH-JADE-REF-V01        | S01-PLAYER-POV / S01-SC08-FILM    | [PLAYER-POV-ACTION-CATCH-JADE-REF-V01.png](./visual/review/PLAYER-POV-ACTION-CATCH-JADE-REF-V01.png)               | REJECTED | 后两格攥拳遮玉；V02 已取代                                                          |
| PLAYER-POV-ACTION-CATCH-JADE-REF-V02        | S01-PLAYER-POV / S01-SC08-FILM    | [PLAYER-POV-ACTION-CATCH-JADE-REF-V02.png](./visual/review/PLAYER-POV-ACTION-CATCH-JADE-REF-V02.png)               | REVIEW   | 动态碰撞、丝绦模拟和受伤反馈仍需验证                                                |
| PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01 | S01-PLAYER-POV / S01-SC03-FILM    | [PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01.png](./visual/review/PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01.png) | REVIEW   | 画外承重点需改成仆妇手持提梁节点                                                    |
| PLAYER-POV-ACTION-OFFER-LETTER-REF-V01      | S01-PLAYER-POV / S01-SC05-FILM    | [PLAYER-POV-ACTION-OFFER-LETTER-REF-V01.png](./visual/review/PLAYER-POV-ACTION-OFFER-LETTER-REF-V01.png)           | REVIEW   | 动态姓名区清晰；交接锚点和收手仍需实机验证                                          |
| PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V01      | S01-PLAYER-POV / S01-SC08-FILM    | [PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V01.png](./visual/review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V01.png)           | REJECTED | 首格疑似缺指，落地丝绦变成短闭环                                                    |
| PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V02      | S01-PLAYER-POV / S01-SC08-FILM    | [PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V02.png](./visual/review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V02.png)           | REJECTED | 五指已修正，玉绳仍省略长流苏结构                                                    |
| PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V03      | S01-PLAYER-POV / S01-SC08-FILM    | [PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V03.png](./visual/review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V03.png)           | REJECTED | 玉绳已修正，末格却由左手镜像成右手                                                  |
| PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04      | S01-PLAYER-POV / S01-SC08-FILM    | [PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04.png](./visual/review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04.png)           | REVIEW   | 同一左手与玉绳连续；需验证人物遮挡层                                                |
| PROP-JADE-REF-V01                           | S01-SC08-JADE                     | [PROP-JADE-REF-V01.png](./visual/review/PROP-JADE-REF-V01.png)                                                     | REVIEW   | 文字、尺寸、丝绦及两套佩戴组合仍需复核                                              |
| PROP-LEDGER-REF-V01                         | S01-P00-LEDGER                    | [PROP-LEDGER-REF-V01.png](./visual/review/PROP-LEDGER-REF-V01.png)                                                 | REJECTED | 中央书脊与对开方式接近西式 codex，不符合侧边穿孔缝线/折叶方向；禁止回退，需重做 V02 |
| PROP-LETTER-REF-V01                         | S01-SC01-LETTER / S01-SC10-LETTER | [PROP-LETTER-REF-V01.png](./visual/review/PROP-LETTER-REF-V01.png)                                                 | REVIEW   | 可控印面设计、动态姓名区、折叠结构复核                                              |
| PROP-TOKEN-WEAVE-REF-V01                    | S01-UI-TEXTURE / 三出身系统       | [PROP-TOKEN-WEAVE-REF-V01.png](./visual/review/PROP-TOKEN-WEAVE-REF-V01.png)                                       | REVIEW   | 丝织比例和江宁织造史复核                                                            |
| PROP-TOKEN-KIN-REF-V01                      | S01-UI-TEXTURE / 三出身系统       | [PROP-TOKEN-KIN-REF-V01.png](./visual/review/PROP-TOKEN-KIN-REF-V01.png)                                           | REVIEW   | 私印、名帖形制和时代复核                                                            |
| PROP-TOKEN-MEDIC-REF-V01                    | S01-UI-TEXTURE / 三出身系统       | [PROP-TOKEN-MEDIC-REF-V01.png](./visual/review/PROP-TOKEN-MEDIC-REF-V01.png)                                       | REVIEW   | 药材、药囊和医馆使用方式复核                                                        |
| LOCATION-TAIXU-REF-V01                      | S01-P00-ENV / S01-E03-FILM        | [LOCATION-TAIXU-REF-V01.png](./visual/review/LOCATION-TAIXU-REF-V01.png)                                           | REVIEW   | P00 镜头拆层、建筑连续性和交互安全区复核                                            |

完整生成提示和初审记录见 [visual/REVIEW-GENERATION-LOG.md](./visual/REVIEW-GENERATION-LOG.md)、[visual/CHARACTER-GENERATION-LOG.md](./visual/CHARACTER-GENERATION-LOG.md) 与 [visual/PLAYER-POV-GENERATION-LOG.md](./visual/PLAYER-POV-GENERATION-LOG.md)。

## 7. 生成记录

后续机器可读 manifest 需要记录：

- assetId；
- sceneId / beatId / choiceId；
- generator；
- model 与 endpoint 标识；
- promptVersion；
- referenceAssetIds；
- taskId；
- 输出文件与派生文件；
- duration、resolution、codec、audio tracks；
- width、height、timebase、frameCount、timeOffsetSec；
- dataColorSpace、alphaMode、transport 与逐帧 MIME；
- depth encoding、invalidCodeValue、biasMeters、featherMeters；
- occlusion channel、semanticId、role、threshold、feather、inverted；
- camera、lighting、effect mode 与 anchor track 引用；
- GLTF material/texture 名称、PBR 槽位与对应 assetId；
- continuityReview；
- rejectionReasons；
- approvedAt。

不提交包含密钥、临时签名 URL、完整供应商响应或个人敏感信息的生成记录。

## 8. 旧素材政策

2026-07-11 已删除旧 `public/jinling-rumeng` 目录中的 46 个实验文件（约 157 MiB），包括重复视频、错误场景映射、旧人物图、音频中间产物、完整供应商响应和临时任务记录。没有任何旧文件迁入正式资产体系，也不存在运行时回退路径。

后续只有在新视觉、连续性和分镜标准下获得稳定资产编号，并通过 manifest 校验与人工验收的文件，才能重新建立 `public/jinling-rumeng` 发布目录。文档中的视觉参考仍只用于制作评审，不是可直接发布素材。
