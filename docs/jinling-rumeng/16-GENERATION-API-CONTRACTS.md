# 生成服务官方 API 合同

状态：REVIEWED · v0.1
最后核对：2026-07-11
用途：把 Seedream 5 Pro、Seedance 2.0 与真人资产库的官方接口约束固化为《金陵入梦》的制作准入条件。本文只记录公开合同，不保存密钥、签名 URL、完整供应商响应或账号信息。

## 1. 权威来源

- [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310)
- [Model pricing](https://docs.byteplus.com/en/docs/ModelArk/1544106)
- [Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)
- [Official SDK timeout and retry guidance](https://docs.byteplus.com/en/docs/ModelArk/1544136)
- [Seedance 2.0 series tutorial](https://docs.byteplus.com/en/docs/ModelArk/2291680)
- [Seedance 2.0 prompt guide](https://docs.byteplus.com/en/docs/ModelArk/2222480)
- [Create video task](https://docs.byteplus.com/en/docs/ModelArk/1520757)
- [Retrieve video task](https://docs.byteplus.com/en/docs/ModelArk/1521309)
- [List video tasks](https://docs.byteplus.com/en/docs/ModelArk/1521675)
- [Real-human portrait library guide](https://docs.byteplus.com/en/docs/ModelArk/2315856)

若仓库注释、旧环境变量或历史脚本与上述页面冲突，以同区域、同模型版本的最新官方文档为准，并通过 manifest 版本升级迁移，不能静默兼容两套合同。

## 2. Seedream 5 Pro

### 2.1 模型身份

- 模型目录 ID：`seedream-5-0-pro-260628`。
- 官方 Image Generation API 示例中的调用 ID：`dola-seedream-5-0-pro-260628`。
- 本项目 `source.model` 使用稳定产品名 `seedream-5-pro`，`source.providerModelId` 记录模型目录 ID，`source.endpointId` 记录实际调用 ID，禁止把三者混为一项。
- API：`POST https://ark.ap-southeast.bytepluses.com/api/v3/images/generations`。

### 2.2 输入与输出

- 支持文生图、单参考图生图和 2–10 张多参考图合成单图。
- 输入图最大 30 MB；长宽比范围 `[1/16, 16]`。
- Pro 只生成单图；发送 `stream`、`sequential_image_generation` 或其 options 会直接报错。
- Prompt 建议少于 600 个英文单词；生成模型不能承担玩家动态姓名、正式印面和 UI 文字。
- `output_format` 明确锁为 `png`；`response_format` 使用 `url`，拿到结果后立即下载。下载 URL 约 24 小时有效。
- `watermark` 必须显式为 `false`；AIGC 来源通过 production record 保留，不把可见文字烧进画面。

### 2.3 Pro 尺寸合同

精确像素法必须同时满足：

- 总像素 `[921,600, 4,624,220]`；
- 宽高均为 16 的倍数；
- 长宽比 `[1/16, 16]`；
- 分辨率档只允许 `1K` 或 `2K`。

官方推荐的 2K 尺寸中，P00 使用：

| 画幅 | Provider source |  正式画布 | 当前用途                     |
| ---- | --------------: | --------: | ---------------------------- |
| 16:9 |       2816×1584 | 3840×2160 | 构图、空间层次、灯光参考试制 |
| 9:16 |       1584×2816 | 2160×3840 | 独立竖版构图参考试制         |

Lanczos3 派生 4K 只用于在目标画布上评审，不是新增细节的正式母版，schema 禁止它进入 `FORMAL_READY`。构图通过后，最终 4K 必须另走正式超分/重绘并重新验收。

### 2.4 计费与幂等

官方单张输出价按像素分档：不超过 2.36M 像素为 USD 0.045，超过 2.36M 为 USD 0.09；首张输入图免费，第二张起每张 USD 0.003。当前 2K 横竖源均属于高像素档。

Image API 是同步调用且没有可恢复 task ID。官方对长响应的通用建议是客户端至少等待 1800 秒；制作 runner 使用 1800 秒总等待并把重试数锁为 0，不能照搬 SDK 默认的 2 次重试。连接在结果确认前中断时必须记录 `UNKNOWN`，禁止自动重提；只有显式的新参数版本或人工确认可能重复计费后，才可创建新 fingerprint。

## 3. Dreamina Seedance 2.0

### 3.1 模型与任务协议

- 正式模型 ID：`dreamina-seedance-2-0-260128`。
- 创建：`POST /api/v3/contents/generations/tasks`。
- 查询：`GET /api/v3/contents/generations/tasks/{id}`。
- 列表：`GET /api/v3/contents/generations/tasks`，可按 `status`、`task_ids` 与 `model` 过滤，分页范围 1–500。
- 任务状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`、`expired`。

创建成功后必须先原子保存 task ID，再进入轮询；不能依赖签名视频 URL作为任务身份。列表接口可以辅助找回已知时间窗内的任务，但没有本项目 fingerprint 字段，不能据此证明一次未知创建请求可安全重发。

### 3.2 内容模式

`content[]` 使用明确的类型与角色：

- 文本：`type=text`；
- 首帧/末帧：`image_url` + `first_frame` / `last_frame`；
- 多模态参考：`reference_image`、`reference_video`、`reference_audio`；
- 真人/数字角色资产使用平台返回的 `asset://<ASSET_ID>`，不能把本地人物名当作资产 ID。

首末帧模式与多模态参考模式是不同生产路径。P00 转场优先使用已锁定的实时印迹首帧和 SC01 车内末帧，不混入无关人物或参考视频。

### 3.3 时长、分辨率和音频

- Seedance 2.0 输出固定 24fps，时长为 4–15 个整数秒；2.0 不接受 `frames` 参数，也不支持 `seed` 与 `camera_fixed`。
- P00 转场传 `duration: 7`；168 帧是验收期望值，不作为 API 的 `frames` 请求参数。
- 1080p 输出为 1920×1080 / 1080×1920；4K 输出为 3840×2160 / 2160×3840。
- 4K 为 10-bit H.265/HEVC，浏览器兼容性不足；若采用 4K 母版，必须保留原始母版并派生 H.264/yuv420p/faststart Web 版。
- `generate_audio` 默认 `true`。P00 B03 转场必须显式传 `false`，正式水声、车轮、对白与音乐始终独立分轨；不能让模型把随机对白烧进视频。
- `watermark` 显式传 `false`。

### 3.4 结果生命周期

成功结果至少核对 `video_url`、`duration`、`resolution`、`ratio`、`framespersecond`、`generate_audio`、`created_at`、`updated_at` 与 `usage`。签名视频 URL 约 24 小时有效，成功后必须立刻安全下载、完整解码和写入哈希；journal 只保存 task ID、状态、时间、媒体元数据与最终哈希，不保存签名 URL 或完整响应。

## 4. 真人与角色一致性

- 使用现实人物肖像或声音前，必须取得权利人本人授权；通过平台验证不替代项目自身的权利证明。
- Public 真人资产库需要登录 BytePlus 并完成对应授权流程；高 KYC 的私有真人/虚拟角色 API 只有账号具备权限时才能作为生产依赖。
- Seedance 的真人/数字角色引用使用 `asset://<ASSET_ID>`。
- 同账号生成的含脸可信输出存在时间窗口；原始输出应立即归档，但二次压缩或跨账号转发不能被假定仍保有平台信任状态。
- 《金陵入梦》的贾宝玉、黛玉、贾母和熙凤在没有明确真人授权包时，只使用虚构演员形象标准包，不上传或仿制现实演员、明星或用户照片。

## 5. 本地配置边界

- `apps/web/.env.local` 当前保存 ModelArk/Seedance 与 SeedAudio 的本地凭据/地址；本地影游生产 runner 优先把 `SEEDANCE_API_KEY`、`SEEDANCE_BASE_URL` 映射为 ModelArk 通用凭据，显式进程配置可以覆盖；值不得写入 manifest、日志、截图或提交说明。
- 模型与 endpoint 以机器 manifest 为唯一生产源，不读取可能漂移的 `SEEDANCE_MODEL` 决定任务模型。
- `apps/server/.env` 的 `BYTEPLUS_MODELARK_*` 只作为本地回退/启用开关；不能在 web 本地凭据已存在时悄然换用另一账号。CI 或隔离制作环境应显式注入 `BYTEPLUS_MODELARK_*`。
- `plan` 只能输出“是否已配置”和脱敏 fingerprint，不能输出环境变量值。
- 正式制作提交到现有 FizzDragon `/aurora/ai/jobs`，由云端 Worker 调用 ModelArk；本机不再直接持有长时间图片生成连接。当前人工 session 仅用于验证，最终无人值守 runner 必须使用独立服务身份。

## 6. P00 当前准入

- Seedream 5 Pro 历史横竖构图结果只作为评审证据；活动生产仅接受 16:9 横屏母版，不再提交 9:16 成片。
- P00＋SC01 的 7 条 SeedAudio 文本、表演方向、目标时长、48kHz/24-bit 单声道交付和运行时触发点已经锁定；正式生成前只剩两张声音卡的选声试听与 provider voice ID 绑定，不再允许改词。
- Seedance B03 仍被最终印迹首帧、SC01 车内末帧与色彩 handoff 阻断；接口已核实不等于资产可提前生成。
- 任何 Provider 结果默认进入 `REVIEW`，不自动 `APPROVED`。
