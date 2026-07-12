# 视频主轨与创作者内容合同

状态：REVIEWED · v1.1
最后更新：2026-07-11
适用范围：《金陵入梦》运行时、后续互动影游创作者端、发布编译器

## 1. 决策

互动影游默认使用视频承载表演、运镜、人物对白和环境变化；HTML / Canvas 承载选择、字幕、自由姓名、关系提示、道具状态与无障碍交互。3D、全景和实时合成是显式扩展 renderer，只在玩家必须连续改变视角或操纵空间对象时使用。

固定机位下的命册出现、打开、翻页、毛笔和落印属于电影镜头，不再由网页实时 GLB 动画承担。GLB 可以作为镜头预演、结构校验或 Seedream / Seedance 参考图的制作源，但不进入 P00 发布版运行时依赖。

## 2. 运行时语法

标准体验链路：

    MAIN / OPENING 视频
      → WAIT 循环或 MAIN 末帧保持
      → HTML / Canvas 交互叠加层
      → REACTION / CONFIRM 视频
      → TRANSITION 视频
      → 下一节点

- `MAIN`：不可交互的主要表演片。
- `WAIT`：专为选择或输入拍摄的自然等待循环；没有 WAIT 时必须显式选择 `hold-last-frame`。
- `REACTION`：选择后立即播放的独立反应片。
- `CONFIRM`：提交事务成功后的确认镜头。
- `TRANSITION`：连接两个场景的连续镜头。
- `ENDING`：独立结局影片。
- `EXTENSION`：经审核的 3D、360°、PLAYER-POV 合成或其他高级 renderer。

视频结束、等待循环、交互提交和下一节点进入必须由媒体事件与确定性状态机驱动，禁止用与素材时长脱钩的固定 `setTimeout` 推进剧情。

## 3. Release 与制作清单分层

### 运行时 Release

运行时只接收不可变发布数据：

- `gameId / releaseId / contentVersion`；
- `channel = preview | production`；Preview 可引用 REVIEW 媒体供内部审片，Production 编译只接受 APPROVED；
- 唯一 `entryNodeId`；
- 永久 runtime `assetId`、每个横竖变体的 canonical `sourceAssetId` 与 SHA-256；
- 节点 presentation、overlay、choice、condition、effect 和 next target；
- 海报、字幕、循环/末帧行为与无障碍替代。

运行时 Release 禁止包含：

- API Key、供应商 endpoint 或提示词；
- `File`、`blob:` URL、临时签名 URL；
- ReactFlow 坐标、组件回调或任意 JavaScript；
- REVIEW / DRAFT 等生产过程状态。

`hold-last-frame` 不引用第二条媒体；只有真实 WAIT 循环才声明 `assetId`。外部交互 action 必须逐项声明 effects 与 `nextNodeId` 或 `endingId`，发布编译器拒绝悬空 action、不可达节点和没有可达结局的图。

### Production Asset Manifest

生产清单负责模型、endpoint、提示词、参考图、尺寸、时长、依赖、哈希、生成任务、验收和晋级。它编译出 Release 的媒体目录，但不在播放器中直接解析。

### Creator Draft

创作者草稿可以包含本地文件、上传进度、画布坐标和未完成节点。发布编译器必须把它转换为不可变 Release 并完成图、媒体和本地化校验。ReactFlow 节点与边只是领域图的可视化投影，不能成为剧情准源。

## 4. 创作者看到的对象

创作者默认操作以下概念，而不是 Three.js、GLB 或播放器代码：

- 场景节点；
- 主片、等待片、反应片、转场片和结局片；
- 对白、字幕与独立音轨；
- 选择、显示条件、状态效果和目标节点；
- 动态叠加层；
- 海报与项目锁定的正式画幅；
- 连续性首帧、末帧与循环缝；
- 发布前错误与验收结果。

高级节点必须由创作者主动选择 `EXTENSION`，并提供叙事目的、配置资产与等价 2D 替代。普通视频节点不会暴露 WebGL 参数。

## 5. 画幅策略

每个视觉资产必须显式声明：

- `paired-required`：独立横版与竖版母版均必需；或
- `single-master`：只允许复用唯一母版，发布者明确接受其构图策略。

《金陵入梦》全部正式表演使用 `single-master` 的 16:9 横屏母版。手机竖持时由产品提示横置，不生成 9:16 表演片，也不以 `object-cover` 静默裁切横屏构图。`paired-required` 继续保留给未来确实生产两套独立画幅的创作者项目。

## 6. 动态叠加

自由玩家姓名、字幕、选择和状态不烧进视频。Overlay 只能声明受控绑定和归一化安全区，例如：

    binding: player.displayName
    landscapeSafeArea: { x, y, width, height }
    portraitSafeArea:  { x, y, width, height }

绑定值只能以文本或受控图形方式渲染，不允许注入 HTML、CSS 或脚本。1–8 字姓名、简繁中文和拉丁字符必须分别做安全区极值测试。

## 7. P00 发布槽位

| 槽位                              | 形态                      |           时长 | 运行时职责                         |
| --------------------------------- | ------------------------- | -------------: | ---------------------------------- |
| `S01-P00-B02-VIDEO-OPENING`       | MAIN，16:9 横屏           |            12s | 空水面、命册出现并打开；末两秒稳定 |
| `S01-P00-B02-VIDEO-CREATION-WAIT` | WAIT 或 `hold-last-frame` | 6s loop / 不限 | 承载 HTML 角色创建                 |
| `S01-P00-B03-VIDEO-CONFIRM`       | CONFIRM，16:9 横屏        |             6s | 存档成功后的显墨、落印与纸纤维响应 |
| `S01-P00-B03-VIDEO-TRANSITION`    | TRANSITION，16:9 横屏     |             7s | 命册到秦淮车厢的连续交接           |

当前 `season-01-preview` 包含 OPENING / CONFIRM 横屏 REVIEW 母版、环境与连续性 poster、受控 SVG 印记、`hold-last-frame` 和 Profile 交互 action。节点通过 `presentation.sequence` 组合多个镜头，并逐镜声明 `advance`、有限/无限末帧保持、静音尾段循环或独立 WAIT。动态姓名与印记使用准源安全区，经与 `object-fit: contain` 相同的变换投影到屏幕，并由 CONFIRM 视频帧时钟驱动；Sequence 完成才进入已建档状态。尚未生成的 WAIT、TRANSITION 不得出现在该 Release。Production Release 必须等相应源资产全部 APPROVED，并从各视频指定帧导出正式 reduced-motion poster。

## 8. 发布校验

发布编译必须拒绝：

- 无入口、不可达节点、无出口节点与悬空选择；
- 缺失媒体、错误 kind、临时 URL 和重复稳定 ID；
- `paired-required` 缺少任一画幅；
- 选择缺反应片且未显式声明 `immediate`；
- 动态文本没有安全区；
- 3D / 全景没有叙事目的或等价替代；
- 视频尺寸、帧率、时长、编解码、音轨与合同不一致；
- WAIT 循环闪帧、MAIN→WAIT 或 CONFIRM→TRANSITION 连续性失败；
- 固定玩家姓名、伪文字、黑帧、水印或不可拆混音进入正式母版。

## 9. 当前代码落点

- `interactive-film/domain/release-manifest.ts`：运行时 Release schema 与交叉引用校验；
- `interactive-film/media/stable-video.tsx`：稳定 video 元素；
- `interactive-film/media/film-stage.tsx`：横竖选择、海报、减少动态、自动播放恢复与媒体错误；
- `interactive-film/media/film-sequence-stage.tsx`：多镜头连续播放、预加载与逐镜等待行为；
- `jinling-rumeng/content/p00-release.ts`：只包含真实媒体与 source hash 的 P00 内部 Preview 实例；
- `jinling-rumeng/production/manifests/s01-p00-v01.json`：供应商和制作过程准源。

只有出现第二个真实消费者后，Release DTO 才考虑提升到 `packages/shared`。当前先保持 Web 内部领域稳定，避免过早共享错误抽象。
