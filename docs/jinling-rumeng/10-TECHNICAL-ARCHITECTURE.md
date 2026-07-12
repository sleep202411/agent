# 最终技术架构

状态：DRAFT · v0.2
最后更新：2026-07-11
目标：以本地 Mock 数据交付完整产品能力，并能无重写地接入未来存储与服务端会话。

## 1. 架构原则

- 互动影游引擎与《金陵入梦》内容解耦。
- 剧情、条件、效果、媒体和 UI 不写在同一个 React 组件中。
- 当前使用 Local Repository，不在组件里散落 Mock 常量。
- 所有运行变化由确定性状态机产生，可回放、可测试、可迁移。
- 媒体缺失、无出口节点和非法条件在构建阶段失败。
- 3D、全景和音频能力按场景懒加载，不拖累纯电影首屏。
- 视频是默认表演主轨；HTML / Canvas 是交互与动态身份层。固定机位表演不得为了“可交互感”改造成实时 3D。
- 生产 Asset Manifest、不可变 Runtime Release 与 Creator Draft 是三个不同合同，禁止播放器直接消费供应商提示词或编辑器画布状态。

## 2. 建议目录

    apps/web/src/features/interactive-film/
      domain/
        release-manifest.ts
        graph.ts
        session.ts
        events.ts
      engine/
        reducer.ts
        conditions.ts
        effects.ts
        resolver.ts
        validator.ts
      media/
        media-orchestrator.ts
        preloader.ts
        video-adapter.ts
        stable-video.tsx
        film-stage.tsx
        audio-mixer.ts
      renderers/
        film-renderer.tsx
        dialogue-renderer.tsx
        action-renderer.tsx
        player-pov-compositor.tsx
        prop-3d-renderer.tsx
        panorama-renderer.tsx
        ending-renderer.tsx
      persistence/
        repository.ts
        local-repository.ts
      player/
        interactive-film-player.tsx
        pause-ledger.tsx
        settings.tsx
      testing/
        path-enumerator.ts
        manifest-fixtures.ts

    apps/web/src/features/jinling-rumeng/
      content/
        manifest.ts
        season-01.ts
        characters.ts
        props.ts
        endings.ts
      production/
        asset-manifest.ts
      ui/
        jinling-theme.ts

## 3. 内容模型

### GameManifest

- 游戏元数据；
- 支持语言；
- 角色创建 schema；
- 赛季；
- 媒体目录；
- 角色、道具和关系定义；
- 默认设置与能力要求。

### SceneNode

- 稳定 nodeId；
- renderer 类型；
- 进入条件；
- 主媒体；
- 时间点或结束触发器；
- 可选交互；
- 退出效果；
- next resolver。

`presentation.kind = video` 是默认路径；`extension` 仅用于经过审核的 3D、全景和 PLAYER-POV 合成。视频节点可声明 MAIN、WAIT/hold-last-frame、REACTION 与 TRANSITION 语义，但运行时始终只引用稳定 assetId。

### Choice

- choiceId；
- 玩家可见动作或台词；
- 显示条件；
- 可访问性文本；
- reactionAssetId；
- effects；
- nextNodeId。

### SessionState

- releaseId / contentVersion；
- playerProfile；
- currentNodeId；
- variables；
- flags；
- relationships；
- history；
- watchedAssets；
- unlockedEndings；
- settings；
- stableCheckpoint。

## 4. 运行状态机

    boot
      → preparing
      → playing
      → awaiting_interaction
      → committing_choice
      → playing_reaction
      → transitioning
      → playing

    任意可暂停状态 → paused
    媒体失败 → recoverable_error | fatal_error
    结局节点 → ending → epilogue

开始视觉播放不得等待音频初始化。切换静音只改变媒体轨道状态，不重建 video 元素。

## 5. 渲染器

- FilmRenderer：视频、字幕、等待循环、已看跳过。
- DialogueRenderer：电影式应答和真人反应。
- ActionRenderer：空间动作和 QTE。
- Prop3DRenderer：Three.js / GLTF 道具检查。
- PanoramaRenderer：360°空间、热点与等价列表。
- EndingRenderer：独立结局影片与回响页。

每个渲染器只产生标准事件，例如 CHOICE_COMMITTED、PROP_CLUE_FOUND，不直接修改全局关系。

普通创作者节点只进入 FilmRenderer。Prop3DRenderer 与 PanoramaRenderer 必须声明叙事目的、配置资产和等价 2D fallback，不能作为固定镜头素材缺失时的替代品。

## 6. 媒体编排

MediaOrchestrator 负责：

- 当前媒体准备；
- 下一层候选分支预加载；
- poster 与首尾帧；
- 等待循环；
- HLS / MP4 能力选择；
- 缓冲与重试；
- 视频和 reaction 无缝切换；
- 字幕时码；
- 音轨连续性；
- 内存和缓存释放。

不在页面初始阶段下载整季所有视频。

## 7. Three.js 与全景

- 作为独立 renderer 懒加载。
- 3D 资产使用 GLTF，按需要采用 Draco / Meshopt 与 KTX2 等压缩方案。
- 玩家关键手部动作使用无手视频底片、相机元数据、深度/遮挡辅助层与受控手部/袖口 GLTF 合成；规范见 [15-PLAYER-POV-PRODUCTION-SPEC.md](./15-PLAYER-POV-PRODUCTION-SPEC.md)。
- PlayerPovCompositor 必须与视频共享焦段、镜头中心、畸变、光照和时间线，不允许用固定屏幕坐标贴一双“浮手”。
- 场景销毁时释放 geometry、material、texture、renderer 和事件监听。
- 支持 WebGL 能力检测、降低质量和等价 2D 检查模式。
- 减少动态设置下禁用不必要粒子、惯性和镜头漂移。

## 8. 音频

- 对白和关键 Foley 绑定电影时间线。
- 动态音乐通过 AudioMixer / Tone.js 使用已批准分轨，不依赖随机不可复现结果。
- 角色原声、音乐、环境和 UI 反馈可独立控制。
- 支持静音、对白增强、字幕描述和浏览器音频解锁恢复。
- 切场保持 room tone 或使用明确设计的音桥。

## 9. Mock 持久化

Repository 接口：

- loadManifest(gameId, version)
- createSession(profile)
- loadSession(sessionId)
- saveCheckpoint(session)
- listSessions()
- unlockEnding(endingId)
- getProgressProfile()

LocalRepository 使用 IndexedDB 或经过版本化的 localStorage。建议媒体缓存与结构化存档分开：存档小数据使用 localStorage/IndexedDB，媒体交给浏览器 HTTP 缓存或 Service Worker 策略。

未来接后端时替换 Repository 实现，不重写状态机和渲染器。

## 10. 内容编译与校验

开发和构建阶段执行：

- schema 校验；
- 引用完整性；
- 可达性与循环；
- 所有主要选择有反应片；
- 所有结局有独立媒体；
- 条件和效果类型正确；
- 所有语言文案存在；
- 媒体文件存在、编码可读、时长合法；
- 字幕不越界；
- 路径枚举与结局分布。

resolveMedia 不允许静默回退到任意默认片。

## 11. 生产脚本

Seedream、Seedance、SeedAudio 任务从机器可读 Asset Manifest 读取，不在脚本内硬编码三四个场景对象。

脚本职责：

- 校验所需环境变量；
- 读取已 LOCKED 任务；
- 打印脱敏摘要；
- 创建、轮询、下载；
- 写入不含密钥和临时 URL 的任务记录；
- 运行 ffprobe、派生 poster、字幕检查和编码；
- 将结果置为 REVIEW，不能自动标记 APPROVED。

生成密钥只存在本地未跟踪环境或安全密钥系统；当前被 Git 跟踪的 .env.local 必须在实施阶段处理，绝不提交真实凭证。

## 12. 测试

- reducer 单元测试；
- 条件与效果测试；
- 全路径枚举；
- 存档迁移测试；
- 媒体失败和重试测试；
- 音频解锁失败测试；
- 键盘、触屏与辅助模式测试；
- Three.js 资源释放测试；
- 移动端安全区和响应式视觉测试；
- 每个结局端到端测试。

## 13. 迁移姿态

现有 jinling-rumeng feature、播放器、脚本和素材不作为兼容目标。新引擎和新内容可以在独立目录完成，达到切换门槛后删除旧实现；不保留双运行时或静默兼容层。

## 14. 运行时基座实施状态

2026-07-11 已落地第一批可独立验收的目标架构代码：

- `interactive-film/domain`：版本化 Session、设置、稳定检查点和待结算事务；不可变 video-first Release schema 区分 Preview / Production，校验入口、可达节点、可达结局、媒体 kind、source assetId / SHA-256、横竖策略、动态叠加安全区、本地化、选择时码、动作路由与反应片引用；
- `interactive-film/engine`：玩家动作状态机、非法转移拒绝、失败重试和效果 exactly-once 结算；
- `interactive-film/persistence`：带 schema 校验、显式迁移入口和内容版本阻断的 Local Repository；
- `interactive-film/media/stable-video.tsx`：静音、音量和等待循环不重建视频，`requestVideoFrameCallback` 可作为外部时钟；自动播放受阻显式上报；
- `interactive-film/media/film-stage.tsx`：按显式 `paired-required` / `single-master` 策略选择横竖媒体，使用正式 poster 处理加载与减少动态，把视频帧时钟和失败交回产品状态机；`responsive-media.ts` 使用与 `object-fit` 相同的 cover / contain 变换，将准源安全区投影到实际屏幕裁切后的位置；
- `interactive-film/renderers/player-pov`：完整制作契约与当前运行时兼容契约分离；稳定视频主时钟；CORS、源地址、尺寸、时长与 timebase 严格校验；depth/occlusion lossless PNG sequence v1 精确帧准备、有界滑动缓存、全局网络/解码并发上限与“单个执行中 + 最新请求”seek 队列；缓存未命中先冻结底片，合成完成后再按播放意图恢复；WebGL2 手层颜色/深度离屏渲染；linear-r8/linear-rg16 深度、语义遮挡、Brown-Conrady 镜头匹配、动态 FOV/DPR、线性预乘 alpha 合成、context 恢复和完整资源释放；
- `jinling-rumeng/content`：原创玩家姓名、出身、专长、手型、肤色和惯用手的正式 Mock schema；版本化创建草稿；P00 落印后的正式 Session 构造与 Repository 工厂；草稿和完整 Session 均可在刷新后恢复。
- `jinling-rumeng/content/p00-release.ts`：当前内部 Preview 编译真实存在的 OPENING / CONFIRM 横竖母版、环境与连续性 poster、受控 SVG 印记、显式末帧保持和 Profile action；所有文件均绑定 source assetId 与 SHA-256。尚未生成的 WAIT、TRANSITION 不进入 Release。Production Release 仍需全部源资产 APPROVED 后由发布编译器产出。
- `jinling-rumeng/ui`：`/play/jinling` 保留完整 Profile、草稿、Session 和 HTML 创建交互；Profile 成功保存后由 CONFIRM 视频帧时钟依次显示动态姓名与印记，视频 `ended` 才进入已建档状态；减少动态使用连续性 poster。旧 Three.js 命册舞台组件已经移除，GLB 只保留为非发布制作预演资产。

当前 `PlayerPovCompositor` 已删除无挡裸 Rig 路径，只允许显式的 `depth-occlusion-lens-validation` 阶段。depth、occlusion、lens、精确帧同步或纹理契约任一缺失时必须暂停并报错，不得降级成固定预录手或无挡手层。

该阶段只表示 depth/occlusion/lens GPU 合成内核已经可以独立验收，不表示 PLAYER-POV 已达到产品接入门槛。完整制作契约仍要求物理景深、时间超采样运动模糊、PMREM 环境探针、匹配 PCSS 阴影、transform/collision/safety 约束和道具加载；当前运行时遇到这些能力会在初始化前明确拒绝，而不是接受后静默无效。仓库也仍缺正式 GLTF、干净底片、depth/occlusion PNG 序列和标定轨道 bundle，因此不得接入《金陵入梦》动作节点。

旧 9 段播放器、三项旧积分、三结局脚本、随机 Tone 垫乐和硬编码生成脚本已经删除；约 157 MiB 未验收旧图片、视频、音频和供应商响应也已清理。新入口没有兼容壳，不会因正式素材缺失而回退旧画面。

当前切换范围为最终架构中的 P00 无字命册序章。SC01 起仍必须等正式场景卡、人物/道具参考与媒体 bundle 达到准入条件后接入；P00 与后续真人场景均不得用程序化几何冒充正式电影画面。

运行 `npm run test:interactive-film --workspace apps/web` 验证领域层、存档、PLAYER-POV 制作/运行时契约、辅助数据序列、精确帧同步与并发上限、合成数学与 shader 契约、相机、Rig、动作采样、播放重调度和失败暂停策略。
