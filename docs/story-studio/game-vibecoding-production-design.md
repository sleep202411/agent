# FizzDragon 影游外观设计

创作者在已有影游项目内，通过官方 Harness 对话修改作品外观。视频、章节、剧情分支、选项、数值与存档由现有影游运行时拥有。

## 1 用户流程

打开项目 → 进入真实预览 → 对话修改外观 → 试玩 → 保存 → 提交审核。预览顶部复用项目发行资料与审核流程，先保存当前外观，再打开审核资料；不会直接绕过确认提交。

## 2 职责

| 层         | 职责                                                   |
| ---------- | ------------------------------------------------------ |
| Studio     | 项目预览、固定比例面板、外观草稿与撤销、保存与审核入口 |
| Game Agent | 官方 Harness 会话、模型调用、三个外观工具              |
| Server     | 项目授权、外观校验、版本比较、项目保存和 Build         |
| 共享播放器 | 视频、时钟、交互、数值、地图、访问、暂停和检查点       |

Game Agent 是独立服务。Harness 负责对话与工具循环；模型凭据留在服务端，不引入 Agent OS 运行时。单次请求和官方对话共用同一外观工具实现与提交边界。

Web 与 Studio 共同使用 packages/experience-player-react，两端适配器分别处理账号、访问和保存。试玩与正式 Build 使用同一外观契约。

## 3 外观契约

唯一外观表示是 {version:1,presentation:{theme?,copy?}}。主题是经过校验的 CSS／SVG 包，可修改开始、选项、播放控制和暂停区域；文案配置只开放多语言的就绪开始按钮。真实动作、剧情和数值不可由外观工具修改。

项目外观与浏览器草稿只接受当前格式，读取时严格校验；未知版本或字段直接报错，保留原数据。浏览器草稿使用项目范围的 Zustand 保存当前外观、提示词、基准版本与最多 40 个撤销记录；写回为 v3，并按 2 MiB UTF-16 预算裁剪最旧记录，保留当前草稿。配额失败保留内存修改及原磁盘草稿。

媒体与封面完整保留作者画幅。外观按播放器窗口尺寸响应，保持可读文案、键盘焦点、触摸目标和减少动态效果支持。构建语义版本为 10，避免复用已退役源码契约的缓存。

## 4 播放界面与动作

播放器只有首次开始、播放和结束重玩三个阶段。播放中的暂停、继续、情节地图和访问检查均由现有播放器负责；不再提供独立主菜单或返回主菜单动作。

自定义只接受经过校验的 CSS／SVG 外观与多语言开始文案。开始、选项、播放控制和暂停区域通过稳定的 region／part 选择器暴露；真实动作、数值、素材、存档和访问规则保持由引擎执行。

## 5 数值与存档归属

保留 `packages/shared/src/story-stats.ts` 的作者数值语法，以及现有 Runtime Manifest 状态定义、条件、效果与检查点。

数值编辑器是创作表示，影游引擎是执行权威。对话编程接入这份状态，不能另建同名变量并使剧情条件和代码 HUD 使用不同数据。作品级／跨章节状态如需扩展，应有明确版本和迁移规则；不能静默改变已有 session 或已发布作品的含义。

正式玩家存档继续走 Web 的现有保存路径；Studio 继续走现有试玩行为。

## 6 外观保存与构建

Harness 只开放 read_appearance、check_appearance、submit_appearance。校验后提交完全相同的外观，拒绝过期、取消和重复提交；Server 通过项目权限和版本比较保存。正式 Build 冻结同一份 CSS／SVG 外观，玩家浏览器不编译或运行生成源码。

浏览器外观草稿只保存当前外观、提示词与撤销记录。草稿和会话各自只保留一份当前契约，不转换旧格式或丢弃未知字段。数据库移除源码字段使用向前迁移，保留历史迁移记录。

## 7 预览窗口

左侧真实播放器仍运行在可信预览 iframe 内，地图、弹窗、焦点、快捷键和 CSS 尺寸响应只作用于游戏窗口。右侧是官方 Harness GUI。正式玩家直接运行同一播放器与发布外观；不再嵌套运行生成菜单源码的 iframe。

## 8 官方对话托管边界

Studio 通过 `POST /aurora/game-agent/projects/:projectId/appearance/web` 打开、轮询或关闭会话。Nest 沿用 FD 登录，检查现有影游项目的 `story.generate`、`story.edit` 权限和可信 Studio origin，再补入真实用户、项目身份和项目标题。浏览器不决定工作区归属。旧 `/api/dev/appearance-harness` 路由已删除，不再另留仅本地可用的对话入口。

官方 GUI 挂载在 `/aurora/game-agent/projects/:projectId/appearance/web/:id/`，HTTP 资源、RPC 和 WebSocket mux 统一进入 Nest。每次 HTTP 请求和 WebSocket 建连均重新检查账号及项目权限；Worker 再核对已准入会话的用户、项目和会话身份。Worker 的 `/v1/game-agent/appearance/web` 控制接口以及对应 `/:id/proxy/*` 代理只面向可信内网，要求独立内部令牌和 Server 产生的作用域信息。官方子进程的端口、启动令牌、鉴权 Cookie 和模型密钥均留在服务端。

代理先私下初始化确切工作区与固定官方会话，再交付首个 GUI 页面，防止官方默认导航创建另一份会话。浏览器仅能使用固定会话的必要 HTTP/RPC/只读流与文字对话；宿主文件、任意工作区、其他会话、设置、模型切换、终端和上传接口不开放。请求、响应、流数量和并发均有上限。仍使用官方对话组件与扩展点，不增加另一套聊天渲染器或 Agent 循环。

Nest 开启 `GAME_AGENT_ENABLED=true` 时必须配置 `GAME_AGENT_WORKER_URL`、`GAME_AGENT_INTERNAL_TOKEN` 和 `GAME_AGENT_STUDIO_ORIGIN`。后者是完整且唯一的 Studio origin，生产为 HTTPS，本地可用 HTTP loopback；不带路径和尾斜杠。Worker 必须配置绝对私有目录 `GAME_AGENT_WORKSPACE_ROOT`，启动时实际验证原子写入和同步。生产入口将 `/aurora/game-agent/*` 的 HTTP 与 WebSocket 升级直接送入 Nest，并按现有约定去掉 `/aurora`。本地 Studio 沿用原生 `/aurora/:path*` Next rewrite，设置 `AURORA_PROXY_TARGET` 指向本地 Server；Nest 路由无此前缀时设置 `AURORA_STRIP_PREFIX=1`。不增加另一套开发入口或 Web rewrite。新加坡生产入口已配置这条路由；每次相关发布仍需验证 HTTP/WebSocket 和项目权限。

持久工作区按用户、现有影游项目、浏览器窗口键和 locale 计算不透明目录名，保存稳定 public session UUID、官方 session ID、最后请求上下文和官方历史。元数据与上下文采用受大小限制的原子写入；损坏或版本不符时明确失败，保留原文件；拒绝符号链接及路径逃逸。同内容重连保留请求身份，改变外观或上下文拒绝旧提案。编辑窗口的 admission lease 阻止过期关闭请求结束新 admission。

正常离开和优雅重启先停止官方子进程组、撤销 HTTP/WebSocket，再释放文件系统 lease，保留工作区文件。部署契约为单 Worker、副本数 1、私有持久 ReadWriteOnce 卷和 Recreate 更新。生产已启用独立组件：卷挂载 `/var/lib/game-agent/workspaces`，UID/GID 1001 在其中创建私有 `sessions` 目录，Pod 使用 fsGroup 1001；只读镜像之外仅开放持久卷和受大小限制的 `/tmp`。PVC 使用保留标记，停用组件不自动删除工作区；手动删除 PVC 仍受底层回收策略影响。模型密钥仅进入 Worker，内部令牌通过另一份 Secret 的单个键注入 Worker 与 Nest，不投射整份业务密钥。当前每个 Worker 最多同时运行两个对话进程，不提供多副本会话路由或分布式文件写入。

`.com` 的六个应用服务运行在账号 `5332868355276356`、`ap-southeast-1` 的
`fizzdragon-com-sg` 集群和 `fizzdragon` 命名空间。日常发布从干净 `main` 的固定 HEAD
构建镜像，更新选定组件并保留现网配置与工作区；Server、Studio 与 Worker 的相关修改
应在同一发布中审核。不要把切流前暂停／隔离配置重新应用到生产。具体流程见
[新加坡发布说明](../../deploy/aliyun-sg/README.md)。

强制崩溃不承诺无条件自动恢复。Worker 在 spawn 前保存启动标记，并立即记录子进程的 Linux PID、启动时刻、boot ID 和 PID namespace。只有同一 boot/namespace 中旧父进程及已登记子进程均能证实消失时才允许自动接管；仍存活、PID 复用、缺失子进程记录、跨 namespace 或证据不足均拒绝接管。遇到这种拒绝，运维必须先证明旧 Pod/进程组已经停止、旧卷挂载已释放，才清理该工作区过期的 `.lease`；不得因时间已久而解锁，不删除元数据、上下文或历史。

Server 仍是项目写入权威；模型执行器只产生经过检查的预览提案。文件系统持久化和
进程恢复契约见 [Game Agent 说明](../../apps/game-agent/README.md)。

## 9 验收与能力限制

本地账号／权限 fixtures、HTTP/WebSocket 假服务、文件系统和独立进程测试验证相应
边界；它们不能替代真实账号、模型、生产网络和卷的验收。macOS 测试不能计为 Linux
进程身份及强制崩溃恢复分支已验证。

已有私有环境检查使用真实 FD 账号和百炼模型，覆盖拥有的项目、模型对话、工具外观
修改、项目保存／重载，以及优雅 ACK Worker 重启后恢复同一会话与历史。恢复曾需要
点击 Reconnect；这不建立自动重连或强制崩溃恢复的保证。

上线检查覆盖公开 HTTPS、就绪、数据源绑定和未登录访问边界。一次新的公开域名
真实登录 → 对话修改 → 保存 → 返回恢复 → Build / 发布完整旅程，及移动设备、支付与
全部素材类型的验收，仍须按实际执行范围分别报告，不能由容器就绪或上述局部检查推断。

日常回归覆盖真实项目进入与返回、开始、暂停继续、真实地图与焦点、结束重玩、CSS／SVG 主题和多语言开始文案、外观保存、过期提案，以及桌面与手机窗口。原生 Mobile 使用其自己的播放器和版本化契约；Web 外观能力不代表原生样式同步。结束页使用默认样式，不开放主题区域。
