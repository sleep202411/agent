# 第一季逐镜素材任务表

状态：PARTIALLY LOCKED · v0.3
最后更新：2026-07-11
上游：[18-DIALOGUE-REVIEW.md](./18-DIALOGUE-REVIEW.md)
说明：P00＋SC01 已由 `s01-p00-sc01-production-v1.json` 锁定为首个正式生产切片；其余场景仍按本表继续拆镜。任何历史六秒流程片均不是正式台词成片。首次流程只装配 [19-FIRST-PLAY-MASTER-EDIT.md](./19-FIRST-PLAY-MASTER-EDIT.md) 锁定的四次显式选择；本表保留的其他反应片是内容素材池，不代表首次流程会逐项弹出交互。

## 1. 任务规则

- MAIN：不可交互的剧情主片。
- WAIT：为选择专门拍摄的自然等待循环。
- REACT：选择后独立真人反应片。
- CONFIRM：事务成功后播放的确认表演片。
- TRANSITION：连接两个稳定节点的连续转场片。
- OUTCOME：动作或 QTE 的独立后果片。
- ENDING：独立结局影片。
- INTERACTIVE：HTML 动态叠加、3D、GLTF 或 360°扩展；固定表演与运镜仍由视频承担。
- AUDIO：不依附固定视频时间线的对白、环境、拟音与音乐分轨任务。

每段 WAIT 必须能自然循环，并与所有 REACT 共用人物站位、服装、光线和声音底。

## 2. 任务清单

| 任务 ID                                 | 类型        | 内容                                         | 目标时长  | 依赖                                           |
| --------------------------------------- | ----------- | -------------------------------------------- | --------- | ---------------------------------------------- |
| S01-P00-B01-AUDIO-OPENING               | AUDIO       | 黑场、远水、翻页、模糊点名与两句未知女声     | 10–14s    | 未知女声声音卡、分轨声音时间线                 |
| S01-P00-B02-VIDEO-OPENING               | MAIN        | 空水面、线装命册出现并打开，末帧稳定         | 12s       | 16:9 横屏母版、无内嵌音轨                      |
| S01-P00-B02-VIDEO-CREATION-WAIT         | WAIT        | 开放命册的自然等待循环或显式末帧保持         | 6s loop   | OPENING 终帧、无文字/姓名、循环缝              |
| S01-P00-B02-INTERACTIVE-PROFILE         | INTERACTIVE | 姓名、出身、性情、第一视角外在与确认         | 70–100s   | HTML 表单、动态姓名安全区、本地草稿            |
| S01-P00-B03-VIDEO-CONFIRM               | CONFIRM     | 存档成功后的显墨、落印与纸纤维响应           | 6s        | Profile 事务、动态姓名/印记叠加、WAIT 连续性   |
| S01-P00-B03-VIDEO-TRANSITION            | TRANSITION  | 印迹特写转秦淮水纹并进入 SC01 车厢           | 7s        | 无姓名印迹特写首帧、SC01 稳定起始帧、16:9 母版 |
| S01-SC01-B01-VIDEO-MAIN-V2              | MAIN        | 车内醒来、车夫提醒、黛玉轿出现               | 12s       | 荐书构图；车夫 VO 独立分轨                     |
| S01-SC01-C01A-VIDEO-REACT-V2            | REACT       | 从黛玉轿仍在门前连续低头查署名，抬头时已错过 | 6s        | 主片精确末帧 + 荐书精确终帧；车夫 VO 独立分轨  |
| S01-SC01-C01B-VIDEO-REACT-CONTROLLED-V2 | REACT       | 淡红纸纤维纹印在自然反光中出现并退色         | 6s        | 受控 SVG/PNG 纸纤维层；未知女声独立分轨        |
| S01-SC01-C01C-VIDEO-REACT-V1            | REACT       | 黛玉隔帘回望并低声问客                       | 6s        | 黛玉身份参考、虚拟人像认证、同步口型           |
| S01-SC02-B01-VIDEO-MAIN                 | MAIN        | 黛玉被迎入，门上拦住玩家                     | 20–30s    | 荣府门前空间、林家轿                           |
| S01-SC02-B02-VIDEO-WAIT                 | WAIT        | 门上持荐书等待玩家回答                       | 4–6s loop | 门上角色、荐书                                 |
| S01-SC02-C02-VIDEO-REACT-A              | REACT       | 如实陈述后双手传帖                           | 8–12s     | 门上、传话丫鬟                                 |
| S01-SC02-C02-VIDEO-REACT-B              | REACT       | 查无姓名、合并报帖、黛玉帘动                 | 8–12s     | 林家报帖、轿帘                                 |
| S01-SC02-C02-VIDEO-REACT-C              | REACT       | 出示信物，按出身选择内部短变体               | 10–14s    | 三件出身信物                                   |
| S01-SC03-B01-VIDEO-MAIN                 | MAIN        | 游廊行走、风起与动作危机                     | 20–30s    | 空间卡、风灯、荐书、黛玉衣袖                   |
| S01-SC03-B02-VIDEO-WAIT                 | WAIT        | 灯罩倾斜、衣袖挂住的短动作循环               | 3–5s loop | 动作连续性测试                                 |
| S01-SC03-C03-VIDEO-OUTCOME-A            | OUTCOME     | 扶灯，黛玉感谢                               | 8–12s     | 风灯物理一致性                                 |
| S01-SC03-C03-VIDEO-OUTCOME-B            | OUTCOME     | 解衣袖，黛玉先退后放松                       | 8–12s     | POV 手部/袖口                                  |
| S01-SC03-C03-VIDEO-OUTCOME-C            | OUTCOME     | 护荐书，仆妇扶灯，黛玉追问                   | 9–13s     | 荐书位置连续                                   |
| S01-SC03-C03-VIDEO-OUTCOME-D            | OUTCOME     | 无动作，仆妇收场，黛玉等玩家                 | 8–12s     | 辅助与超时路径                                 |
| S01-SC04-B01-VIDEO-MAIN                 | MAIN        | 黛玉与贾母相见的原著情感主片                 | 45–60s    | SC04-PROD-CARD-V01、正厅、群演座次、声音连续性 |
| S01-SC04-B02-VIDEO-GUEST                | MAIN        | 贾母看荐书、玩家获准暂留、熙凤接信           | 25–35s    | SC04-PROD-CARD-V01、贾母、熙凤、淡红痕         |
| S01-SC05-B01-VIDEO-MAIN                 | MAIN        | 熙凤带玩家进侧厅并复述门前说法               | 20–30s    | SC05-PROD-CARD-V01、SC02 状态台词变体          |
| S01-SC05-B02-VIDEO-WAIT                 | WAIT        | 熙凤说错日期后观察玩家                       | 4–7s loop | SC05-PROD-CARD-V01、侧厅站位、荐书             |
| S01-SC05-C05-VIDEO-REACT-A              | REACT       | 玩家坦白异常，熙凤扣信                       | 12–18s    | 熙凤近场表演                                   |
| S01-SC05-C05-VIDEO-REACT-B              | REACT       | 玩家拆穿日期，熙凤转为拉拢                   | 12–18s    | QUICK/洞察条件                                 |
| S01-SC05-C05-VIDEO-REACT-CW             | REACT       | 云锦出身专属验物                             | 12–18s    | 云锦标准包                                     |
| S01-SC05-C05-VIDEO-REACT-CK             | REACT       | 故交私印出身专属验物                         | 12–18s    | 私印标准包                                     |
| S01-SC05-C05-VIDEO-REACT-CM             | REACT       | 医馆香囊出身专属验物                         | 12–18s    | 香囊标准包                                     |
| S01-SC05-C05-VIDEO-REACT-D              | REACT       | 以礼挡拆，熙凤交还荐书                       | 12–18s    | CAREFUL 条件                                   |
| S01-SC06-B01-VIDEO-MAIN                 | MAIN        | 王夫人告诫黛玉并提醒玩家                     | 30–45s    | 王夫人房、黛玉、群演                           |
| S01-SC06-B02-VIDEO-WAIT                 | WAIT        | 仆妇等待玩家选择客房                         | 4–6s loop | 三处空间提示                                   |
| S01-SC06-C06-VIDEO-REACT-A              | REACT       | 选择黛玉近房，王夫人划定边界                 | 8–12s     | 夜谈入口 A                                     |
| S01-SC06-C06-VIDEO-REACT-B              | REACT       | 选择外院，王夫人认可先查身份                 | 8–12s     | 夜谈入口 B                                     |
| S01-SC06-C06-VIDEO-REACT-C              | REACT       | 选择熙凤厢房，熙凤帘外接话                   | 8–12s     | 夜谈入口 C                                     |
| S01-SC07-B01-VIDEO-MAIN                 | MAIN        | 宝玉正式装进厅、请安、奉命离厅               | 12–18s    | 正厅连续、宝玉正式装、黛玉                     |
| S01-SC07-B02-VIDEO-MAIN                 | MAIN        | 宝玉家常装返回、宝黛厮见与似曾相识           | 40–55s    | 同脸换装、家常装佩饰组、黛玉                   |
| S01-SC07-B03-VIDEO-WAIT                 | WAIT        | 宝玉转向玩家问“哪一册”                       | 4–7s loop | 家常装连续、眼线精度                           |
| S01-SC07-C07-VIDEO-REACT-A              | REACT       | 册外回答，宝玉产生既视感                     | 10–15s    | 命册悬疑                                       |
| S01-SC07-C07-VIDEO-REACT-B              | REACT       | 信物回应，宝玉质疑以物认人                   | 10–15s    | 三信物镜头变体                                 |
| S01-SC07-C07-VIDEO-REACT-C              | REACT       | 暂住之客，黛玉先回应“客”                     | 10–15s    | 黛玉关系状态                                   |
| S01-SC07-C07-VIDEO-REACT-D              | REACT       | 玩家退让视线，宝黛轻微交锋                   | 10–15s    | HEART 条件                                     |
| S01-SC08-B01-VIDEO-MAIN                 | MAIN        | 问玉、情绪突变、宝玉把玉掷出                 | 25–35s    | 宝玉家常装、颈前佩饰组、通灵玉最高连续性       |
| S01-SC08-Q08-VIDEO-OUTCOME-A            | OUTCOME     | 玩家接玉、手伤、众人反应                     | 15–22s    | POV 手部、玉丝绦                               |
| S01-SC08-Q08-VIDEO-OUTCOME-B            | OUTCOME     | 玩家护黛玉、玉落软垫、宝玉停顿               | 15–22s    | 黛玉站位                                       |
| S01-SC08-Q08-VIDEO-OUTCOME-C            | OUTCOME     | 呼唤袭人、空间被重新组织                     | 15–22s    | 袭人功能角色                                   |
| S01-SC08-Q08-VIDEO-OUTCOME-D            | OUTCOME     | 迟疑、玉落地、混乱加剧                       | 15–22s    | 坏结局组合条件                                 |
| S01-SC09-B01-VIDEO-ENTRY-A              | MAIN        | 黛玉近房主动探望                             | 15–22s    | roomNearDaiyu                                  |
| S01-SC09-B01-VIDEO-ENTRY-B              | MAIN        | 外院查验记录与廊下相遇                       | 15–22s    | roomNearOuter                                  |
| S01-SC09-B01-VIDEO-ENTRY-C              | MAIN        | 熙凤厢房物品被动过与门外提醒                 | 15–22s    | roomNearXifeng                                 |
| S01-SC09-B02-VIDEO-WAIT                 | WAIT        | 黛玉回收两项历史后等待回答                   | 4–7s loop | 历史台词组合                                   |
| S01-SC09-C09-VIDEO-REACT-A              | REACT       | 告知封印异常                                 | 14–20s    | 黛玉信任状态                                   |
| S01-SC09-C09-VIDEO-REACT-B              | REACT       | 邀黛玉共查，信放在两人之间                   | 14–20s    | 荐书完整状态                                   |
| S01-SC09-C09-VIDEO-REACT-C              | REACT       | 保密并承诺，黛玉暂时接受                     | 14–20s    | CAREFUL 条件                                   |
| S01-SC09-C09-VIDEO-REACT-D              | REACT       | 说出无字命册，黛玉回应梦                     | 16–24s    | ledgerInsight 条件                             |
| S01-SC10-B01-INTERACTIVE-PANO           | INTERACTIVE | 三种房间入口的夜间 360°探索                  | 90–150s   | 空间变体、热点等价列表                         |
| S01-SC10-B02-INTERACTIVE-LETTER         | INTERACTIVE | 3D 荐书、淡红纹与最终动作                    | 45–90s    | 荐书 GLTF、动态姓名                            |
| S01-E01-VIDEO-ENDING                    | ENDING      | 黛玉递灯，“一同认路”                         | 25–40s    | daiyuTrust 高                                  |
| S01-E02-VIDEO-ENDING                    | ENDING      | 熙凤递新名帖、扣下旧信                       | 25–40s    | 动态姓名名帖                                   |
| S01-E03-VIDEO-ENDING                    | ENDING      | 荣府静止叠回太虚，无判词                     | 30–45s    | 视频 + Three.js 合成                           |
| S01-E04-VIDEO-ENDING                    | ENDING      | 清晨侧门离府与条件送别                       | 25–40s    | 送别人物变体                                   |
| S01-E05-VIDEO-ENDING                    | ENDING      | 厅堂质问、门合、姓名晕开                     | 30–45s    | 低关系危机组合                                 |

## 3. 当前计数

- 已锁定生产切片：P00 复用 2 条无声横屏视觉，SC01 新生产 4 条 1920×1080 / 24fps 横屏视频候选。
- 已锁定独立对白音频：7 条，其中 P00 未知女声 4 条、SC01 车夫 2 条、未知女声 1 条；黛玉 1 条由 Seedance 同步口型和音轨生成。
- 交互场景：P00 是视频底片上的 HTML Profile overlay；夜间全景和 3D 荐书是显式高级扩展。P00 不再属于实时 3D 道具场景。
- 三种出身产生的轻量视频变体尚未全部拆分；正式视频量预计 50–60 段。
- 图片、角色参考、道具标准、场景参考、音频、字幕、poster 和编码派生物另计。

## 4. 下一轮补齐

视觉方向确定后，为每个任务补充：

- 精确镜头、焦段、机位和运动；
- 人物、服装、道具、场景参考 ID；
- Seedance 输入模式、提示词和负面约束；
- SeedAudio 对白、环境和音乐分轨；
- 开始帧、结束帧与循环点；
- 横屏字幕与交互安全区；
- 预计生成轮次和验收标准。
