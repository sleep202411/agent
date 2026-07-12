# 玩家第一视角视觉生成记录

状态：ACTIVE
最后更新：2026-07-11
规范：[15-PLAYER-POV-PRODUCTION-SPEC.md](../15-PLAYER-POV-PRODUCTION-SPEC.md)
生成器：Codex 内置图像生成，用于美术与建模参考；不是最终 GLTF、PBR 贴图或 Seedance 成片。

## PLAYER-POV-HAND-GEOMETRY-REF-V01

- 文件：[PLAYER-POV-HAND-GEOMETRY-REF-V01.png](./review/PLAYER-POV-HAND-GEOMETRY-REF-V01.png)
- 状态：REVIEW
- 目标：建立 BALANCED 中性手型的同一双手几何、掌背、侧面、接物、精握、双手递物与侧向保护姿态。
- 生成约束：18–25 岁成年人；五指、短指甲、无首饰/疤痕/纹身；裸露前臂显示绑定边界；八格同一比例和材质；不使用男性/女性刻板编码。
- 初审通过：左右手方向、五指、腕宽、指节、指甲和主要动作姿态成立；接物、精握、双手递物与保护姿态能由一套骨骼表达。
- 初审限制：图片不能证明拓扑与蒙皮；SLENDER/BROAD 两种相容网格、极限关节、拇指对握和双手碰撞仍需 3D 验证。
- 结论：作为 BALANCED 手部建模母版进入 REVIEW。

## PLAYER-POV-SLEEVE-WEAVE-REF-V01

- 文件：[PLAYER-POV-SLEEVE-WEAVE-REF-V01.png](./review/PLAYER-POV-SLEEVE-WEAVE-REF-V01.png)
- 状态：REVIEW
- 引用：手部几何 V01。
- 目标：让织造出身在普通镜头中保持烟靛蓝克制，只在近景读到细密丝棉、旧金/雾蓝窄云水边和经纬校样。
- 初审通过：左右袖口一致、月白内层和腕口锚点稳定；正常距离不显宫廷，微距才出现织造知识。
- 初审限制：生成窄边略偏装饰性卷草，正式纹样和组织结构需云锦/织造顾问重新绘制，禁止直接贴图。
- 结论：结构与层级进入 REVIEW，纹样未 LOCKED。

## PLAYER-POV-SLEEVE-KIN-REF-V01

- 文件：[PLAYER-POV-SLEEVE-KIN-REF-V01.png](./review/PLAYER-POV-SLEEVE-KIN-REF-V01.png)
- 状态：REVIEW
- 引用：手部几何 V01。
- 目标：用石青灰细斜纹绸、烟黑窄滚边和极细旧金线表达礼数与旧交体面，不使用官服、补子或贾府徽记。
- 初审通过：结构最规整但不显权位；正常镜头与微距材质一致；左右袖口和腕口锚点稳定。
- 初审限制：斜纹密度、滚边厚度和袖口折叠仍需在递信、接玉与护人动画中做碰撞压力测试。
- 结论：进入 REVIEW，作为三出身中最中性的动作测试袖口。

## PLAYER-POV-SLEEVE-MEDIC-REF-V01

- 文件：[PLAYER-POV-SLEEVE-MEDIC-REF-V01.png](./review/PLAYER-POV-SLEEVE-MEDIC-REF-V01.png)
- 状态：REVIEW
- 引用：手部几何 V01。
- 目标：用洗旧蓝灰细棉麻、深靛加固和同色内补缀表达卫生、耐用与实际工作，避免白大褂、药童戏服和贫困化。
- 初审通过：外观干净、腕口一致、材质比另两套更实用；无污渍、药材挂件或现代医疗符号。
- 初审限制：内侧补缀和收袖结构在微距中偏大，建模时需缩小、压平并确保不与道具碰撞。
- 结论：进入 REVIEW，内侧结构未 LOCKED。

## PLAYER-POV-SKIN-MATERIAL-V01

- 文件：[PLAYER-POV-SKIN-MATERIAL-V01.png](./review/PLAYER-POV-SKIN-MATERIAL-V01.png)
- 状态：REVIEW
- 引用：手部几何 V01。
- 目标：以五行肤色、三列冷窗/暖灯/夜间混光验证材质覆盖和曝光，不把肤色变体做成简单乘色。
- 初审通过：五档明度和底色可区分；深肤色夜景仍保留轮廓、指节和甲床；暖灯没有把所有肤色压成同一橙色。
- 初审限制：不同格存在轻微几何/毛发感变化；图片只能作为视觉目标，PBR baseColor、SSS、roughness、normal 和 nail 参数必须在同一网格上受控重建。
- 结论：进入 REVIEW，不允许从图片直接裁切贴图。

## PROP-LANTERN-REF-V01

- 文件：[PROP-LANTERN-REF-V01.png](./review/PROP-LANTERN-REF-V01.png)
- 状态：REVIEW
- 初审：六角硬木/旧铜框、角片/云母罩、油杯、通风帽、提梁摆轴、维护门、圆钝铜扣和冷上框握点成立；正式 GLTF 仍需锁定角片工艺、尺寸和仆妇持握节点。

## PLAYER-POV-ACTION-CATCH-JADE-REF-V01–V02

- V01：[PLAYER-POV-ACTION-CATCH-JADE-REF-V01.png](./review/PLAYER-POV-ACTION-CATCH-JADE-REF-V01.png) — REJECTED；前两格成立，后两格攥拳并遮住玉。
- V02：[PLAYER-POV-ACTION-CATCH-JADE-REF-V02.png](./review/PLAYER-POV-ACTION-CATCH-JADE-REF-V02.png) — REVIEW；手掌开放缓冲，玉面始终可见，丝绦从小指侧自然垂下。
- 限制：动态碰撞、丝绦擦掌、掌心轻伤和 GLTF 轨迹仍需实机验证。

## PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01

- 文件：[PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01.png](./review/PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01.png)
- 状态：REVIEW
- 初审：同一灯体完成约 15°摆斜、冷上框接触、回正至约 5°和自然释放；手不碰罩片、热通风帽、火焰或铜扣。
- 限制：画外承重点像短悬链，正式 GLTF/镜头必须改为仆妇手持提梁节点，不能误做固定吊灯。

## PLAYER-POV-ACTION-OFFER-LETTER-REF-V01

- 文件：[PLAYER-POV-ACTION-OFFER-LETTER-REF-V01.png](./review/PLAYER-POV-ACTION-OFFER-LETTER-REF-V01.png)
- 状态：REVIEW
- 生成方式：Codex 内置图像生成；以手部几何、故交袖口和荐书为身份/材质引用，采用四格连续动作参考模式。
- 提示摘要：同一第一视角依次完成低位持信、抬起、前递与等待接取；双手始终托住信件边缘，封面不生成文字、印章或姓名，拇指不压住主要可合成面。
- 初审：手数、左右手方向、袖口、信件尺寸和镜位连续；最后一格达到可交接等待姿，未提前生成接收者或强制放手。
- 限制：图中拇指仍接触信件左右边缘；正式网格必须用 `handoff_letter` 锚点锁定压力区，并验证交接后自然收手与动态姓名叠加。

## PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V01–V04

- V01：[PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V01.png](./review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V01.png) — REJECTED；首格左手疑似缺指/融合，落垫后的丝绦从散绳突变为短闭环。
- V02：[PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V02.png](./review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V02.png) — REJECTED；四格五指已可审计，但玉绳仍被简化成只有提环、没有长流苏的结构。
- V03：[PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V03.png](./review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V03.png) — REJECTED；五指与玉绳已连续，但末格翻掌后从左手镜像成右手。
- V04：[PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04.png](./review/PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04.png) — REVIEW；末格保持手背朝镜头，以同一左手降低前臂收势；玉绳结构沿用 V03。
- 生成方式：Codex 内置图像生成；以手部几何、故交袖口、黛玉 V02 和通灵玉为身份/动作引用，采用四格连续动作参考与局部连续性修订模式。
- 提示摘要：玉沿右下空地软垫方向下降；玩家只用左臂在黛玉肩线以下形成非战斗保护边界；玉落稳后黛玉仅以指尖扶住袖料，双方不抓腕、不牵手、不拥抱。
- V04 初审：黛玉脸部、服装与空间轴线连续，玉始终不朝她；四格均为同一左手且五指独立可辨；提环与长流苏没有变成另一套道具；脸和双眼无遮挡，收势没有把误判改写成真实攻击。
- 限制：末格扶袖接触面积仍需在 3D 中压缩到外层布料，禁止触发腕部/身体碰撞；人物前景遮挡、景深和玉落点必须与 SC08 干净底片实机复核。

## 当前进度与下一步

已完成 REVIEW：BALANCED 手部几何、三出身袖口、五肤色三光线校色，以及扶灯、递信、接玉、护人四项高风险动作参考。

下一步：

1. 建立 `PLAYER-POV-HAND-RIG-V01` 与三袖口相容网格，先完成低位、递信、扶灯、接玉和护人五个动作片段。
2. 用荐书、风灯和通灵玉 GLTF 锁定交接、握点、碰撞与丝绦模拟。
3. 用 SC08 干净底片验证黛玉遮挡、焦段、深度、玉轨迹与释放帧合成。
4. 玩家 POV 运行时资产通过后再生成 SC08 四条 QTE 结果板。
