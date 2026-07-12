#!/usr/bin/env -S npx tsx

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseJinlingDialogueLock,
  type JinlingDialogueLock,
} from "../../src/features/jinling-rumeng/production/dialogue-lock-contract";
import { WEB_ROOT } from "./paths";

type Line = JinlingDialogueLock["lines"][number];
type Choice = JinlingDialogueLock["choices"][number];

const OUTPUT_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-dialogue-lock-v1.json"
);

const line = (
  dialogueId: string,
  sceneId: string,
  speakerId: string,
  text: string,
  condition: string,
  performance: string,
  targetDurationSeconds: number,
  audioStrategy: Line["audioStrategy"] = sceneId === "S01-SC02" ? "seedaudio-vo" : "seedance-sync"
): Line => ({
  dialogueId,
  sceneId,
  shotId: `${dialogueId}-SHOT`,
  speakerId,
  text,
  condition,
  performance,
  targetDurationSeconds,
  audioStrategy,
  aspectRatio: "16:9",
  subtitle: true,
});

const choice = (
  choiceId: string,
  sceneId: string,
  text: string,
  reactionDialogueIds: string[]
): Choice => ({ choiceId, sceneId, text, spoken: false, reactionDialogueIds });

const lines: Line[] = [
  line(
    "S01-P00-B01-VO-01",
    "S01-P00",
    "VOICE-LEDGER",
    "一页一页，都有来处，也有归处。",
    "always",
    "遥远、平静，不表现具体年龄或身份。",
    5,
    "seedaudio-vo"
  ),
  line(
    "S01-P00-B01-VO-02",
    "S01-P00",
    "VOICE-LEDGER",
    "怎么空了一页？",
    "always",
    "第一次出现疑问，仍不惊恐。",
    3,
    "seedaudio-vo"
  ),
  line(
    "S01-P00-B02-VO-01",
    "S01-P00",
    "VOICE-LEDGER",
    "册中无名，便没有命么？",
    "always",
    "近一些，像对玩家发问，也像自问。",
    5,
    "seedaudio-vo"
  ),
  line(
    "S01-P00-B03-VO-01",
    "S01-P00",
    "VOICE-LEDGER",
    "既不肯照写——便自己去走。",
    "profile.confirmed",
    "破折号前停一拍，后半句不是威胁，而是放行。",
    6,
    "seedaudio-vo"
  ),

  line(
    "S01-SC01-B01-VO-01",
    "S01-SC01",
    "VOICE-DRIVER",
    "前头就是荣府。沈老夫人那封荐书，可收好了。",
    "always",
    "车帘外中距离，年长车夫，平常嘱咐。",
    6,
    "seedaudio-vo"
  ),
  line(
    "S01-SC01-C01A-VO-01",
    "S01-SC01",
    "VOICE-DRIVER",
    "到了——别误了门上的报帖。",
    "choice.C01-A",
    "车停时略提高音量，不催命。",
    4,
    "seedaudio-vo"
  ),
  line(
    "S01-SC01-C01B-VO-01",
    "S01-SC01",
    "VOICE-LEDGER",
    "写下了，便是真的么？",
    "choice.C01-B",
    "几不可闻，像水声中的人声倒影。",
    4,
    "seedaudio-vo"
  ),
  line(
    "S01-SC01-C01C-DY-01",
    "S01-SC01",
    "CHAR-DAIYU",
    "也是来做客的么？",
    "choice.C01-C",
    "隔轿帘轻问，不确定玩家是否听见，说完即收回目光。",
    4
  ),

  line(
    "S01-SC02-B01-GATE-01",
    "S01-SC02",
    "CHAR-GATE",
    "林姑老爷家的姑娘到了——里头已经候着了。",
    "always",
    "对轿队唱报，声音利落。",
    6
  ),
  line(
    "S01-SC02-B01-GATE-02",
    "S01-SC02",
    "CHAR-GATE",
    "慢。你的名帖呢？",
    "always",
    "拦住玩家，短句，不粗暴。",
    3
  ),
  line(
    "S01-SC02-B01-GATE-03",
    "S01-SC02",
    "CHAR-GATE",
    "沈老夫人的旧印……你与林姑娘同行，还是另有来处？",
    "always",
    "认出旧印后收敛态度，停顿落在旧印。",
    7
  ),
  line(
    "S01-SC02-C02A-GATE-01",
    "S01-SC02",
    "CHAR-GATE",
    "既是旧托，先在门内候。话我照原样传，少一句都不成。",
    "choice.C02-A",
    "重新打量后双手交信，公事公办。",
    7
  ),
  line(
    "S01-SC02-C02A-MSG-01",
    "S01-SC02",
    "CHAR-MESSENGER",
    "姓名和来处，再说一遍。",
    "choice.C02-A",
    "走前回头确认，语速快。",
    4
  ),
  line(
    "S01-SC02-C02B-GATE-01",
    "S01-SC02",
    "CHAR-GATE",
    "林家的帖上没有你。",
    "choice.C02-B",
    "翻帖后直接指出矛盾。",
    4
  ),
  line(
    "S01-SC02-C02B-GATE-02",
    "S01-SC02",
    "CHAR-GATE",
    "罢了，先并作同路报进去。若问起来，你自己圆。",
    "choice.C02-B",
    "给一条临时通路，也把风险还给玩家。",
    7
  ),
  line(
    "S01-SC02-C02C-GATE-01",
    "S01-SC02",
    "CHAR-GATE",
    "这不是寻常铺子的样。你先进去，东西收紧些，凤奶奶眼尖。",
    "choice.C02-C && origin.WEAVE",
    "不碰云锦，只近看；后半句压低。",
    7
  ),
  line(
    "S01-SC02-C02C-GATE-02",
    "S01-SC02",
    "CHAR-GATE",
    "这印我见管事房拓过。你先候着，我不敢替里头认人。",
    "choice.C02-C && origin.KIN",
    "立即让开半步，但不越权担保。",
    7
  ),
  line(
    "S01-SC02-C02C-GATE-03",
    "S01-SC02",
    "CHAR-GATE",
    "今儿府里没请外医。你若是来投亲，药箱别往内院乱带。",
    "choice.C02-C && origin.MEDIC",
    "闻见药香后提醒规矩，不嘲讽。",
    7
  ),
  line(
    "S01-SC02-B02-MSG-01",
    "S01-SC02",
    "CHAR-MESSENGER",
    "林姑娘后头还有一位——他说的是……",
    "always",
    "边走边向下一道门复述，尾句进入音桥。",
    5
  ),

  line(
    "S01-SC03-B01-MAID-01",
    "S01-SC03",
    "CHAR-MAID",
    "脚下看着。这里门槛多，话也多。",
    "always",
    "提醒行路，也暗示府中耳目。",
    5
  ),
  line(
    "S01-SC03-C03A-MAID-01",
    "S01-SC03",
    "CHAR-MAID",
    "手稳。再迟一寸，火便燎到衣上了。",
    "choice.C03-A",
    "先惊后松，确认灯稳后才说。",
    5
  ),
  line(
    "S01-SC03-C03A-DY-01",
    "S01-SC03",
    "CHAR-DAIYU",
    "多谢。你倒比我先看见风。",
    "choice.C03-A",
    "看玩家扶灯的手，轻谢中带观察。",
    5
  ),
  line(
    "S01-SC03-C03B-DY-01",
    "S01-SC03",
    "CHAR-DAIYU",
    "我自己来……好了。",
    "choice.C03-B",
    "先退半步，发现玩家守住距离后放松。",
    4
  ),
  line(
    "S01-SC03-C03B-DY-02",
    "S01-SC03",
    "CHAR-DAIYU",
    "你也当心自己的信。",
    "choice.C03-B",
    "目光转向玩家袖口，善意但不亲昵。",
    4
  ),
  line(
    "S01-SC03-C03C-DY-01",
    "S01-SC03",
    "CHAR-DAIYU",
    "那封信，比火还怕见风么？",
    "choice.C03-C",
    "轻声反问，锋利藏在平静里。",
    5
  ),
  line(
    "S01-SC03-C03C-MAID-01",
    "S01-SC03",
    "CHAR-MAID",
    "进了这府，藏得越紧，瞧见的人越多。",
    "choice.C03-C",
    "淡淡接话，不看玩家。",
    6
  ),
  line(
    "S01-SC03-C03D-MAID-01",
    "S01-SC03",
    "CHAR-MAID",
    "吓住了？走路不能只顾看。",
    "choice.C03-D",
    "替玩家收场，不羞辱。",
    4
  ),
  line(
    "S01-SC03-C03D-DY-01",
    "S01-SC03",
    "CHAR-DAIYU",
    "来吧。",
    "choice.C03-D",
    "让出半步，等玩家跟上。",
    2
  ),

  line(
    "S01-SC04-B01-JM-01",
    "S01-SC04",
    "CHAR-JIAMU",
    "我的儿，今日才见着你了……怎么这样瘦？",
    "always",
    "见黛玉后情绪涌上，但不号哭式表演。",
    7
  ),
  line(
    "S01-SC04-B01-DY-01",
    "S01-SC04",
    "CHAR-DAIYU",
    "外祖母。",
    "always",
    "只够说出称呼，气息被眼泪截住。",
    3
  ),
  line(
    "S01-SC04-B01-JM-02",
    "S01-SC04",
    "CHAR-JIAMU",
    "往后这里就是家。缺什么，只管告诉我。",
    "always",
    "拥住黛玉，温暖而有决定全室的权威。",
    7
  ),
  line(
    "S01-SC04-B02-JM-01",
    "S01-SC04",
    "CHAR-JIAMU",
    "你就是沈家老姐姐信里说的孩子？近些，让我看看。",
    "always",
    "情绪稍定后才看玩家，不抢宝黛亲情中心。",
    7
  ),
  line(
    "S01-SC04-B02-JM-02",
    "S01-SC04",
    "CHAR-JIAMU",
    "旧人我认得，旧情也认得。既来了，先住一夜。",
    "always",
    "看旧署名后给体面，但不等于完全相信。",
    8
  ),
  line(
    "S01-SC04-B02-JM-03",
    "S01-SC04",
    "CHAR-JIAMU",
    "信，明日再细看。",
    "always",
    "一句轻声结束众人追问。",
    4
  ),
  line(
    "S01-SC04-B02-XF-01",
    "S01-SC04",
    "CHAR-XIFENG",
    "老祖宗放心。我最会替人安置‘来处不清’的客。",
    "always",
    "笑着接信，来处不清四字说得轻，目光落向玩家。",
    7
  ),

  line(
    "S01-SC05-B01-XF-01",
    "S01-SC05",
    "CHAR-XIFENG",
    "门上说，你受沈家旧托，持荐书来见老祖宗。字字都说得周全。",
    "history.C02-A",
    "准确复述，像夸奖，也像核对口供。",
    8
  ),
  line(
    "S01-SC05-B01-XF-02",
    "S01-SC05",
    "CHAR-XIFENG",
    "门上说，你随林妹妹同路。可林家的报帖上，偏偏没有你的名字。",
    "history.C02-B",
    "前句带笑，偏偏二字落下压力。",
    8
  ),
  line(
    "S01-SC05-B01-XF-03",
    "S01-SC05",
    "CHAR-XIFENG",
    "门上说，你什么也没解释，只亮了一件东西。倒比一张嘴省事。",
    "history.C02-C",
    "明快，不立即判断信物真假。",
    8
  ),
  line(
    "S01-SC05-B01-XF-04",
    "S01-SC05",
    "CHAR-XIFENG",
    "话传过两道门，还是原样。现在该你自己说了。",
    "always",
    "共同台词；笑意在后半句收窄。",
    7
  ),
  line(
    "S01-SC05-B02-XF-01",
    "S01-SC05",
    "CHAR-XIFENG",
    "沈老夫人的信，落的是三月初七。",
    "always",
    "故意说错日期，像随口确认。",
    5
  ),
  line(
    "S01-SC05-B02-XF-02",
    "S01-SC05",
    "CHAR-XIFENG",
    "可惜——她老人家三月初五便不见外客了。",
    "always",
    "破折号后压低声音，盯住玩家反应。",
    6
  ),
  line(
    "S01-SC05-C05A-XF-01",
    "S01-SC05",
    "CHAR-XIFENG",
    "不知道最好。知道得太多的人，住一夜也嫌长。",
    "choice.C05-A",
    "笑意变窄，危险来自平静。",
    7
  ),
  line(
    "S01-SC05-C05A-XF-02",
    "S01-SC05",
    "CHAR-XIFENG",
    "信先放我这里。明日我替你问个明白。",
    "choice.C05-A",
    "把信向自己一侧拉，像照看也像扣留。",
    6
  ),
  line(
    "S01-SC05-C05B-XF-01",
    "S01-SC05",
    "CHAR-XIFENG",
    "好眼力。",
    "choice.C05-B",
    "停一拍后第一次真正看玩家。",
    3
  ),
  line(
    "S01-SC05-C05B-XF-02",
    "S01-SC05",
    "CHAR-XIFENG",
    "我喜欢会看的人。只是不喜欢会看、又不肯说的人。",
    "choice.C05-B",
    "把信推回一寸，后一句降低音量。",
    7
  ),
  line(
    "S01-SC05-C05C-XF-01",
    "S01-SC05",
    "CHAR-XIFENG",
    "织法是真的，边是旧的。可你拿它来证明自己——便是把自己也当成一件货了。",
    "choice.C05-C && origin.WEAVE",
    "对灯验织物，结论精准但不羞辱。",
    9
  ),
  line(
    "S01-SC05-C05C-XF-02",
    "S01-SC05",
    "CHAR-XIFENG",
    "印是真的。借印说话的人，未必都真。",
    "choice.C05-C && origin.KIN",
    "不落印，短句像判语。",
    6
  ),
  line(
    "S01-SC05-C05C-XF-03",
    "S01-SC05",
    "CHAR-XIFENG",
    "药能救人，也能叫人说不清。你最好只用它做前一样事。",
    "choice.C05-C && origin.MEDIC",
    "不碰药囊，末句是提醒也是警告。",
    8
  ),
  line(
    "S01-SC05-C05D-XF-01",
    "S01-SC05",
    "CHAR-XIFENG",
    "拿礼来挡我？也好。",
    "choice.C05-D",
    "笑出声，不恼。",
    4
  ),
  line(
    "S01-SC05-C05D-XF-02",
    "S01-SC05",
    "CHAR-XIFENG",
    "你自己收着。丢了，可别说是我动的手。",
    "choice.C05-D",
    "交还信，笑后停一拍。",
    6
  ),
  line(
    "S01-SC05-B03-XF-01",
    "S01-SC05",
    "CHAR-XIFENG",
    "你今晚住哪儿，我替你挑。住得近，话听得多；住得远，命长些。",
    "always",
    "前半句热络，后半句像玩笑，不能演成恐吓。",
    9
  ),

  line(
    "S01-SC06-B01-WANG-01",
    "S01-SC06",
    "CHAR-WANG",
    "我有一个孽根祸胎，是家里的混世魔王。你往后不要睬他。你这些姊妹都不敢沾惹他的。",
    "always",
    "对黛玉说，语气平稳，采用原著语义。",
    10
  ),
  line(
    "S01-SC06-B01-WANG-02",
    "S01-SC06",
    "CHAR-WANG",
    "你也是客。既来投旧，不要被新鲜人、新鲜话带得忘了分寸。",
    "always",
    "转向玩家，礼貌但边界清楚。",
    8
  ),
  line(
    "S01-SC06-C06-MAID-01",
    "S01-SC06",
    "CHAR-MAID",
    "客房有三处。老太太说，让你自己挑一处清静的。",
    "always",
    "按吩咐传话，不暗示答案。",
    7
  ),
  line(
    "S01-SC06-C06A-WANG-01",
    "S01-SC06",
    "CHAR-WANG",
    "隔一重廊。不要扰她歇息。",
    "choice.C06-A",
    "没有反对，只确认边界。",
    5
  ),
  line(
    "S01-SC06-C06B-WANG-01",
    "S01-SC06",
    "CHAR-WANG",
    "知道先查明自己，很好。",
    "choice.C06-B",
    "轻微认可，不亲近。",
    4
  ),
  line(
    "S01-SC06-C06C-XF-01",
    "S01-SC06",
    "CHAR-XIFENG",
    "听话的人，我自然照看得周全。",
    "choice.C06-C",
    "从帘外接话，听话二字略有意味。",
    5
  ),

  line(
    "S01-SC07-B01-JM-01",
    "S01-SC07",
    "CHAR-JIAMU",
    "去见你娘来。",
    "always",
    "宝玉正式装初入后，简短吩咐。",
    3
  ),
  line(
    "S01-SC07-B02-JM-01",
    "S01-SC07",
    "CHAR-JIAMU",
    "外客未见，就脱了衣裳。还不去见你妹妹。",
    "always",
    "见宝玉换家常装回来，亲昵责备。",
    6
  ),
  line(
    "S01-SC07-B02-BY-01",
    "S01-SC07",
    "CHAR-BAOYU",
    "这个妹妹，我曾见过的。",
    "always",
    "只对黛玉说；真切、脱口而出，不是调情。",
    5
  ),
  line(
    "S01-SC07-B02-JM-02",
    "S01-SC07",
    "CHAR-JIAMU",
    "又胡说。你何曾见过她？",
    "always",
    "半嗔半笑。",
    4
  ),
  line(
    "S01-SC07-B02-BY-02",
    "S01-SC07",
    "CHAR-BAOYU",
    "虽没见过，看着面善，心里倒像远别重逢。",
    "always",
    "看黛玉，语速自然，越说越确信。",
    6
  ),
  line(
    "S01-SC07-B02-BY-03",
    "S01-SC07",
    "CHAR-BAOYU",
    "妹妹像是见过。你呢？",
    "always",
    "宝黛核心停顿完整结束后才转向玩家。",
    4
  ),
  line(
    "S01-SC07-B02-BY-04",
    "S01-SC07",
    "CHAR-BAOYU",
    "你从哪一册里来的？",
    "always",
    "好奇脱口而出，说完自己也有一瞬困惑。",
    4
  ),
  line(
    "S01-SC07-C07A-BY-01",
    "S01-SC07",
    "CHAR-BAOYU",
    "怪。方才这句话，倒像我先听你说过。",
    "choice.C07-A",
    "笑意先起又转困惑。",
    6
  ),
  line(
    "S01-SC07-C07A-XF-01",
    "S01-SC07",
    "CHAR-XIFENG",
    "今儿尽是‘见过’的人。",
    "choice.C07-A && xifeng.present",
    "侧目轻接，不抢场。",
    4
  ),
  line(
    "S01-SC07-C07B-BY-01",
    "S01-SC07",
    "CHAR-BAOYU",
    "人若要靠东西才算有来处，那东西丢了，人也没了么？",
    "choice.C07-B",
    "靠近看信物但不拿，真心发问。",
    7
  ),
  line(
    "S01-SC07-C07C-DY-01",
    "S01-SC07",
    "CHAR-DAIYU",
    "客字说得倒轻。",
    "choice.C07-C",
    "先于宝玉回应，轻而锋利。",
    4
  ),
  line(
    "S01-SC07-C07C-BY-01",
    "S01-SC07",
    "CHAR-BAOYU",
    "住一夜也是人。明日走不走，明日再说。",
    "choice.C07-C",
    "不接受身份把人变轻，语速稍快。",
    6
  ),
  line(
    "S01-SC07-C07D-BY-01",
    "S01-SC07",
    "CHAR-BAOYU",
    "你们两个都不肯先说话。倒显得我一个人吵。",
    "choice.C07-D",
    "看看玩家再看黛玉，自嘲化开沉默。",
    6
  ),
  line(
    "S01-SC07-C07D-DY-01",
    "S01-SC07",
    "CHAR-DAIYU",
    "本来就是。",
    "choice.C07-D",
    "极轻，第一次与玩家共享一点默契。",
    3
  ),

  line(
    "S01-SC08-B01-BY-01",
    "S01-SC08",
    "CHAR-BAOYU",
    "妹妹可也有玉没有？",
    "always",
    "承接宝黛厮见，问黛玉。",
    4
  ),
  line(
    "S01-SC08-B01-DY-01",
    "S01-SC08",
    "CHAR-DAIYU",
    "我没有那个。想来那玉是件罕物，岂能人人都有。",
    "always",
    "平静作答，不知会触发宝玉失控。",
    7
  ),
  line(
    "S01-SC08-B01-BY-02",
    "S01-SC08",
    "CHAR-BAOYU",
    "家里姐姐妹妹都没有，单我有。我说它是什么好东西！",
    "always",
    "情绪真实失控，最后一句随摘玉动作爆发。",
    7
  ),
  line(
    "S01-SC08-Q08A-BY-01",
    "S01-SC08",
    "CHAR-BAOYU",
    "谁叫你接的？",
    "choice.Q08-A",
    "怒意未散，盯着玩家手里的玉。",
    3
  ),
  line(
    "S01-SC08-Q08A-JM-01",
    "S01-SC08",
    "CHAR-JIAMU",
    "先把玉拿稳！手可伤了？",
    "choice.Q08-A",
    "先控制局面，再关心玩家。",
    5
  ),
  line(
    "S01-SC08-Q08A-DY-01",
    "S01-SC08",
    "CHAR-DAIYU",
    "为一件东西，倒叫旁人受伤。",
    "choice.Q08-A",
    "看玩家掌心再看宝玉，克制自责。",
    5
  ),
  line(
    "S01-SC08-Q08B-DY-01",
    "S01-SC08",
    "CHAR-DAIYU",
    "我无事。你不用——",
    "choice.Q08-B",
    "扶住玩家袖口，话被宝玉打断。",
    4
  ),
  line(
    "S01-SC08-Q08B-BY-01",
    "S01-SC08",
    "CHAR-BAOYU",
    "我不是要砸她。",
    "choice.Q08-B",
    "看见黛玉扶玩家后第一次停顿，声音低下来。",
    4
  ),
  line(
    "S01-SC08-Q08C-WANG-01",
    "S01-SC08",
    "CHAR-WANG",
    "还知道先叫谁，没乱。",
    "choice.Q08-C",
    "看玩家，简短评价。",
    4
  ),
  line(
    "S01-SC08-Q08C-XF-01",
    "S01-SC08",
    "CHAR-XIFENG",
    "这府里的人，倒叫你认得快。",
    "choice.Q08-C",
    "低声观察，不是夸奖。",
    5
  ),
  line(
    "S01-SC08-Q08D-JM-01",
    "S01-SC08",
    "CHAR-JIAMU",
    "孽障！还不快捡起来！",
    "choice.Q08-D",
    "玉落地后压住全室混乱，权威而非尖叫。",
    4
  ),

  line(
    "S01-SC09-B01A-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "我原不该来。只是方才那一下……想问你可有伤着。",
    "room.NEAR-DAIYU",
    "门外持灯，先看玩家的手，关心中保留边界。",
    7
  ),
  line(
    "S01-SC09-B01B-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "他们也在查你的来处？看来做客的人，先要把自己交代明白。",
    "room.NEAR-OUTER",
    "廊下看见查验记录，带一点自嘲。",
    8
  ),
  line(
    "S01-SC09-B01C-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "若是你的东西，最好自己数一遍。这里替人收拾的人太周到了。",
    "room.NEAR-XIFENG",
    "周到二字轻讽，不直接指控熙凤。",
    8
  ),
  line(
    "S01-SC09-H01-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "进门以前，你先看的是我，不是那封信。我一直记着。",
    "history.C01-C",
    "不是表白，只陈述她记住了玩家的注意顺序。",
    7
  ),
  line(
    "S01-SC09-H02-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "门上把你写作与我同路。你那时为什么没有否认？",
    "history.C02-B",
    "直接追问，不替玩家找理由。",
    7
  ),
  line(
    "S01-SC09-H03-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "游廊里，你扶的是灯。你是不愿碰我，还是怕我多心？",
    "history.C03-A",
    "平静反问，允许玩家自己解释边界。",
    8
  ),
  line(
    "S01-SC09-H04-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "你先护住了信。如今还不肯告诉我，里面写了什么？",
    "history.C03-C",
    "目光落在荐书，语气比白日更直接。",
    8
  ),
  line(
    "S01-SC09-H05-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "手伸得那样快。玉若碎了，总还有人；手伤了，却是你自己的。",
    "history.Q08-A",
    "看伤处，后半句很轻。",
    8
  ),
  line(
    "S01-SC09-H06-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "你挡在我前头时，可曾想过那玉不是冲我来的？",
    "history.Q08-B",
    "不是责怪，追问玩家为什么行动。",
    7
  ),
  line(
    "S01-SC09-C09A-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "真的东西上，也能落一个假的印。那假的，便会把真的也拖累了。",
    "choice.C09-A",
    "看灯再看信，像谈荐书，也像谈人。",
    8
  ),
  line(
    "S01-SC09-C09B-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "你给我看，是信我，还是想让我替你担着？",
    "choice.C09-B",
    "没有立刻接信，先确认责任边界。",
    7
  ),
  line(
    "S01-SC09-C09B-DY-02",
    "S01-SC09",
    "CHAR-DAIYU",
    "那便一起看。",
    "choice.C09-B",
    "见玩家把信放在两人之间后才坐下。",
    4
  ),
  line(
    "S01-SC09-C09C-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "不能说和不肯说，不是一回事。",
    "choice.C09-C",
    "停顿前不退让。",
    5
  ),
  line(
    "S01-SC09-C09C-DY-02",
    "S01-SC09",
    "CHAR-DAIYU",
    "我暂且当你是前一样。",
    "choice.C09-C",
    "停顿后给有限信任，暂且必须清楚。",
    5
  ),
  line(
    "S01-SC09-C09D-DY-01",
    "S01-SC09",
    "CHAR-DAIYU",
    "我不信什么册子替人把一生写完。",
    "choice.C09-D",
    "长久看玩家，没有讥笑，第一句先否定宿命。",
    6
  ),
  line(
    "S01-SC09-C09D-DY-02",
    "S01-SC09",
    "CHAR-DAIYU",
    "可我信有人会梦见自己没有地方可写。",
    "choice.C09-D",
    "更轻，承认玩家的孤独但不承认命册权威。",
    7
  ),

  line(
    "S01-SC10-B01-VO-01",
    "S01-SC10",
    "VOICE-LEDGER",
    "信是真的，人便是真的么？",
    "always",
    "与 P00 同一声音，近而平静。",
    5,
    "seedaudio-vo"
  ),

  line(
    "S01-E01-DY-01",
    "S01-E01",
    "CHAR-DAIYU",
    "这府里路多，门也多。我未必认得全。",
    "ending.E01",
    "天未亮，隔半开的门，语气克制。",
    6
  ),
  line(
    "S01-E01-DY-02",
    "S01-E01",
    "CHAR-DAIYU",
    "既都是客，路便一同认吧。",
    "ending.E01",
    "把灯递向玩家，不演成爱情告白。",
    5
  ),
  line(
    "S01-E02-XF-01",
    "S01-E02",
    "CHAR-XIFENG",
    "从今往后，门上知道怎么报你的名字了。",
    "ending.E02",
    "推来新名帖，像给位置也像立规矩。",
    6
  ),
  line(
    "S01-E02-XF-02",
    "S01-E02",
    "CHAR-XIFENG",
    "至于旧信——旧东西，我替你收着最妥当。",
    "ending.E02",
    "笑着扣住原荐书，妥当二字压低。",
    6
  ),
  line(
    "S01-E03-VO-01",
    "S01-E03",
    "VOICE-LEDGER",
    "原来真有不肯照写的人。",
    "ending.E03",
    "第一次带极轻的释然，不揭示身份。",
    5,
    "seedaudio-vo"
  ),
  line(
    "S01-E04-GATE-01",
    "S01-E04",
    "CHAR-GATE",
    "来时凭一封信，走时倒什么也不带？",
    "ending.E04",
    "清晨侧门，意外但不挖苦。",
    6
  ),
  line(
    "S01-E05-XF-01",
    "S01-E05",
    "CHAR-XIFENG",
    "没有人担保的话，旧情也只能算一张旧纸。",
    "ending.E05",
    "画外音，冷静陈述结论，不做胜利反派腔。",
    7,
    "seedaudio-vo"
  ),
  line(
    "S01-E05-VO-01",
    "S01-E05",
    "VOICE-LEDGER",
    "还没有写完。",
    "ending.E05",
    "名字被水晕开后出现，保留后续可能。",
    3,
    "seedaudio-vo"
  ),
];

const choices: Choice[] = [
  choice("S01-C01-A", "S01-SC01", "先看荐书署名与旧交落款", ["S01-SC01-C01A-VO-01"]),
  choice("S01-C01-B", "S01-SC01", "先看封口那道不属于人间的淡红纹印", ["S01-SC01-C01B-VO-01"]),
  choice("S01-C01-C", "S01-SC01", "先望向轿帘后的林黛玉", ["S01-SC01-C01C-DY-01"]),
  choice("S01-C02-A", "S01-SC02", "如实说明另有来处，请门上单独通报", [
    "S01-SC02-C02A-GATE-01",
    "S01-SC02-C02A-MSG-01",
  ]),
  choice("S01-C02-B", "S01-SC02", "借黛玉同行之名，请门上并作同路通报", [
    "S01-SC02-C02B-GATE-01",
    "S01-SC02-C02B-GATE-02",
  ]),
  choice("S01-C02-C", "S01-SC02", "不解释荐书，先出示自己的出身信物", [
    "S01-SC02-C02C-GATE-01",
    "S01-SC02-C02C-GATE-02",
    "S01-SC02-C02C-GATE-03",
  ]),
  choice("S01-C03-A", "S01-SC03", "先扶稳灯罩，不让火落到黛玉衣上", [
    "S01-SC03-C03A-MAID-01",
    "S01-SC03-C03A-DY-01",
  ]),
  choice("S01-C03-B", "S01-SC03", "压住挂钩，让黛玉自己抽回衣袖", [
    "S01-SC03-C03B-DY-01",
    "S01-SC03-C03B-DY-02",
  ]),
  choice("S01-C03-C", "S01-SC03", "先按住滑出的荐书与信物", [
    "S01-SC03-C03C-DY-01",
    "S01-SC03-C03C-MAID-01",
  ]),
  choice("S01-C03-D", "S01-SC03", "一时迟疑，没有立即动作", [
    "S01-SC03-C03D-MAID-01",
    "S01-SC03-C03D-DY-01",
  ]),
  choice("S01-C05-A", "S01-SC05", "说明旧事为真，但承认自己也不知道封印来历", [
    "S01-SC05-C05A-XF-01",
    "S01-SC05-C05A-XF-02",
  ]),
  choice("S01-C05-B", "S01-SC05", "指出日期试探，反问她真正想查的是不是封印", [
    "S01-SC05-C05B-XF-01",
    "S01-SC05-C05B-XF-02",
  ]),
  choice("S01-C05-C", "S01-SC05", "用出身信物证明自己，但不交出荐书", [
    "S01-SC05-C05C-XF-01",
    "S01-SC05-C05C-XF-02",
    "S01-SC05-C05C-XF-03",
  ]),
  choice("S01-C05-D", "S01-SC05", "坚持等贾母在场时再拆信", [
    "S01-SC05-C05D-XF-01",
    "S01-SC05-C05D-XF-02",
  ]),
  choice("S01-C06-A", "S01-SC06", "请求住在离黛玉近一重廊的客房", ["S01-SC06-C06A-WANG-01"]),
  choice("S01-C06-B", "S01-SC06", "住到外院附近，方便查明荐书", ["S01-SC06-C06B-WANG-01"]),
  choice("S01-C06-C", "S01-SC06", "住进熙凤安排的厢房", ["S01-SC06-C06C-XF-01"]),
  choice("S01-C07-A", "S01-SC07", "告诉宝玉：我不在你见过的册里", [
    "S01-SC07-C07A-BY-01",
    "S01-SC07-C07A-XF-01",
  ]),
  choice("S01-C07-B", "S01-SC07", "展示信物，反问人是否只能靠物件证明来处", [
    "S01-SC07-C07B-BY-01",
  ]),
  choice("S01-C07-C", "S01-SC07", "只说自己是暂住一夜的客", [
    "S01-SC07-C07C-DY-01",
    "S01-SC07-C07C-BY-01",
  ]),
  choice("S01-C07-D", "S01-SC07", "不回答，后退半步把视线让回黛玉", [
    "S01-SC07-C07D-BY-01",
    "S01-SC07-C07D-DY-01",
  ]),
  choice("S01-Q08-A", "S01-SC08", "伸手接住通灵玉", [
    "S01-SC08-Q08A-BY-01",
    "S01-SC08-Q08A-JM-01",
    "S01-SC08-Q08A-DY-01",
  ]),
  choice("S01-Q08-B", "S01-SC08", "横移一步，先护住黛玉", [
    "S01-SC08-Q08B-DY-01",
    "S01-SC08-Q08B-BY-01",
  ]),
  choice("S01-Q08-C", "S01-SC08", "叫袭人先收玉，并让众人不要围住宝玉", [
    "S01-SC08-Q08C-WANG-01",
    "S01-SC08-Q08C-XF-01",
  ]),
  choice("S01-Q08-D", "S01-SC08", "迟疑片刻，让玉落到地上", ["S01-SC08-Q08D-JM-01"]),
  choice("S01-C09-A", "S01-SC09", "说明旧署名和旧事为真，只有封印来历不明", [
    "S01-SC09-C09A-DY-01",
  ]),
  choice("S01-C09-B", "S01-SC09", "把信放在两人之间，请黛玉一同查验", [
    "S01-SC09-C09B-DY-01",
    "S01-SC09-C09B-DY-02",
  ]),
  choice("S01-C09-C", "S01-SC09", "暂时保密，但承诺不再借她的名字，也不牵连她", [
    "S01-SC09-C09C-DY-01",
    "S01-SC09-C09C-DY-02",
  ]),
  choice("S01-C09-D", "S01-SC09", "告诉黛玉无字命册与空白命页的真相", [
    "S01-SC09-C09D-DY-01",
    "S01-SC09-C09D-DY-02",
  ]),
  choice("S01-C10-A", "S01-SC10", "把荐书交给黛玉，与她共同保守真相", [
    "S01-E01-DY-01",
    "S01-E01-DY-02",
  ]),
  choice("S01-C10-B", "S01-SC10", "把荐书交给熙凤，换取府中的正式位置", [
    "S01-E02-XF-01",
    "S01-E02-XF-02",
  ]),
  choice("S01-C10-C", "S01-SC10", "自己保留荐书，继续追查无字命册", ["S01-E03-VO-01"]),
  choice("S01-C10-D", "S01-SC10", "烧掉荐书，拒绝让凭证决定来处", ["S01-E04-GATE-01"]),
];

const lock = parseJinlingDialogueLock({
  schemaVersion: 1,
  lockVersion: "1.0.0",
  status: "LOCKED",
  language: "zh-CN",
  title: "金陵入梦：无字来客",
  playerVoice: "silent-choice-intent",
  orientation: "landscape-only",
  aspectRatio: "16:9",
  speakers: [
    {
      speakerId: "VOICE-LEDGER",
      displayName: "未知女声",
      voiceDirection: "无明确年龄，平静、疏离、非恐怖、非耳语 ASMR；本季不揭示身份。",
    },
    {
      speakerId: "VOICE-DRIVER",
      displayName: "车夫",
      voiceDirection: "年长男声，朴实、稳定，来自车帘外的中距离。",
    },
    {
      speakerId: "CHAR-GATE",
      displayName: "门上甲",
      voiceDirection: "成年男声，利落守规矩；态度变化清楚但不粗俗。",
    },
    {
      speakerId: "CHAR-MESSENGER",
      displayName: "传话丫鬟",
      voiceDirection: "年轻成年女声，语速略快，做事熟练。",
    },
    {
      speakerId: "CHAR-MAID",
      displayName: "引路仆妇",
      voiceDirection: "中年女声，克制、见多识广，不抢主角。",
    },
    {
      speakerId: "CHAR-DAIYU",
      displayName: "林黛玉",
      voiceDirection: "轻、短、气息真实、咬字清楚；反问保护边界，禁止甜美偶像腔。",
    },
    {
      speakerId: "CHAR-JIAMU",
      displayName: "贾母",
      voiceDirection: "温暖、缓慢、有权威；轻声即可让全室停下。",
    },
    {
      speakerId: "CHAR-XIFENG",
      displayName: "王熙凤",
      voiceDirection: "明快、带笑、句子精准；真正危险时降低音量，禁止纯反派腔。",
    },
    {
      speakerId: "CHAR-WANG",
      displayName: "王夫人",
      voiceDirection: "平稳、少情绪、信息明确；压力来自秩序而非恶意。",
    },
    {
      speakerId: "CHAR-BAOYU",
      displayName: "贾宝玉",
      voiceDirection: "明亮、自然、想到便说、情绪起伏明显；发怒时仍保留有情。",
    },
  ],
  lines,
  choices,
});

async function main(): Promise<void> {
  await writeFile(OUTPUT_PATH, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  process.stdout.write(`${OUTPUT_PATH}\n`);
}

void main();
