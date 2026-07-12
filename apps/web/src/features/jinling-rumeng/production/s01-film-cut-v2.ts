export type JinlingFilmShotV2 = {
  id: string;
  act: "ARRIVAL" | "CORRIDOR" | "HOUSE" | "NIGHT";
  condition: string;
  purpose: string;
  action: string;
  timeline: string;
  dialogue: string[];
  references: Array<{ path: string; role: string }>;
  durationSeconds: 15;
};

export type JinlingFilmContinuityRule = {
  predecessorId: string;
  join: "direct" | "hidden-cut";
};

const review = (name: string) => `docs/jinling-rumeng/visual/review/${name}`;
const preview = (name: string) => `apps/web/public/jinling-rumeng/preview/story/${name}`;

export const JINLING_FILM_CUT_V2 = [
  {
    id: "A1-S01-CARRIAGE-WAKE",
    act: "ARRIVAL",
    condition: "always",
    purpose: "The player wakes in a moving carriage and discovers the recommendation letter.",
    action:
      "First-person inside a late-Qing carriage before dawn. Begin on rain-soft Qinhuai reflections through the lattice, then a slow handheld tilt finds an old recommendation letter and keepsake in the player's lap. The driver remains off screen.",
    timeline:
      "0–4s carriage wheels and river light; 4–10s camera discovers the letter; 6–12s driver speaks off screen; 12–15s carriage slows and the letter seal catches light.",
    dialogue: ["车夫（画外）：前头就是荣府。沈老夫人那封荐书，可收好了。"],
    references: [
      { path: preview("sc01-letter.png"), role: "carriage letter composition" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "canonical recommendation letter" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A1-S02-DAIYU-SEDAN",
    act: "ARRIVAL",
    condition: "always",
    purpose: "Daiyu's sedan and the player's carriage converge at Rongguo Mansion.",
    action:
      "First-person steps down behind Lin Daiyu's sedan at the Rongguo gate. A restrained dolly forward crosses misty flagstones; the curtain lifts and Daiyu gives one intelligent, uncertain glance toward camera, never posing.",
    timeline:
      "0–5s sedan enters and servants cross naturally; 5–10s curtain lifts and Daiyu looks toward camera; 8–12s she speaks softly; 12–15s curtain falls and the gate fills frame.",
    dialogue: ["黛玉（极轻）：也是来做客的么？"],
    references: [
      { path: preview("sc02-daiyu.png"), role: "Daiyu threshold composition" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "locked Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A1-S03-GATE-ARRIVAL",
    act: "ARRIVAL",
    condition: "always",
    purpose: "The household welcomes Daiyu but stops the unknown player.",
    action:
      "One continuous first-person gate shot with layered blocking. Daiyu's sedan passes through while a middle-aged gate steward calls inward, then plants one palm into the foreground to stop camera. Natural servants continue behind him.",
    timeline:
      "0–6s steward calls Daiyu's arrival; 6–9s sedan clears the threshold; 9–12s his palm stops camera; 12–15s he asks for the calling card.",
    dialogue: ["门上：林姑老爷家的姑娘到了——里头已经候着了。", "门上：慢。你的名帖呢？"],
    references: [
      { path: preview("sc02-daiyu.png"), role: "Rongguo threshold and period palette" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A1-S04-GATE-QUESTION",
    act: "ARRIVAL",
    condition: "always",
    purpose: "The old seal earns attention but not entry, leading to the first choice.",
    action:
      "Medium close first-person interrogation at the gate. The steward opens only the edge of the letter, recognizes the old private seal, changes from dismissive to cautious, and studies camera. End in a steady neutral waiting composition suitable for the choice overlay.",
    timeline:
      "0–5s steward studies paper fibres and seal; 5–12s he asks the question with controlled suspicion; 12–15s he waits without repeated mouth movement.",
    dialogue: ["门上：沈老夫人的旧印……你与林姑娘同行，还是另有来处？"],
    references: [
      { path: preview("sc02-daiyu.png"), role: "gate lighting and depth" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "old letter and seal" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C1-R01-OLD-TRUST",
    act: "ARRIVAL",
    condition: "choice.C1-OLD-TRUST",
    purpose: "Reaction when the player tells the old connection truthfully.",
    action:
      "The gate steward's suspicion settles into formal caution. He returns the letter with both hands, signals a messenger maid, and moves half a step aside. The messenger repeats the request as she starts inward.",
    timeline:
      "0–3s steward absorbs the silent answer; 3–10s he speaks and returns the letter; 10–15s messenger speaks while walking toward the inner gate.",
    dialogue: [
      "门上：既是旧托，先在门内候。话我照原样传，少一句都不成。",
      "传话丫鬟：姓名和来处，再说一遍。",
    ],
    references: [
      { path: preview("sc02-daiyu.png"), role: "gate continuity" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C1-R02-DAIYU-ROAD",
    act: "ARRIVAL",
    condition: "choice.C1-DAIYU-ROAD",
    purpose: "Reaction when the player claims to have arrived with Daiyu.",
    action:
      "The steward checks the Lin household arrival slip, finds no matching name, and looks past camera toward Daiyu's disappearing sedan. He reluctantly waves camera through but keeps the letter in view as evidence.",
    timeline:
      "0–4s he checks the slip; 4–7s first line with a hard glance; 7–14s reluctant admission and warning; 14–15s inner gate opens.",
    dialogue: ["门上：林家的帖上没有你。", "门上：罢了，先并作同路报进去。若问起来，你自己圆。"],
    references: [
      { path: preview("sc02-daiyu.png"), role: "gate and Daiyu route continuity" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "distant Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C1-R03-KEEPSAKE",
    act: "ARRIVAL",
    condition: "choice.C1-KEEPSAKE",
    purpose: "Reaction when the player proves origin with a keepsake instead of explanation.",
    action:
      "The steward examines a genuine old keepsake without taking it, recognizes its quality, and lowers his voice. He allows camera inside while warning that Wang Xifeng notices objects more quickly than stories.",
    timeline:
      "0–5s close observation of keepsake; 5–12s steward speaks quietly; 12–15s he opens a path but watches camera pass.",
    dialogue: ["门上：东西是真的。先进去，收紧些——凤奶奶眼尖。"],
    references: [
      { path: preview("sc02-daiyu.png"), role: "gate continuity" },
      { path: review("PROP-TOKEN-KIN-REF-V01.png"), role: "representative old keepsake material" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A2-S01-CORRIDOR-ENTRY",
    act: "CORRIDOR",
    condition: "always",
    purpose: "The player follows Daiyu into the deep household order.",
    action:
      "First-person tracking shot behind Daiyu and a lamp-bearing maid through a long timber gallery. Use strong foreground pillars and receding practical lamps, quiet lateral parallax, silk and footsteps. Daiyu is never glamor posed.",
    timeline:
      "0–6s slow tracking through layered pillars; 6–12s maid turns only her head and warns camera; 12–15s wind starts under the last words.",
    dialogue: ["仆妇：脚下看着。这里门槛多，话也多。"],
    references: [
      { path: preview("sc03-lantern.png"), role: "corridor and lantern blocking" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "locked Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A2-S02-WIND-CRISIS",
    act: "CORRIDOR",
    condition: "always",
    purpose: "Wind entangles the lantern, Daiyu's sleeve and the hidden letter.",
    action:
      "A realistic corridor gust creates three simultaneous readable dangers: the lantern swings toward flame, Daiyu's sleeve catches on carved wood, and the recommendation letter slips from the first-person sleeve into foreground. No one resolves them before the cut. End on suspended tension for choice UI.",
    timeline:
      "0–4s wind grows through bamboo and lamps; 4–9s lantern swings and sleeve catches; 9–12s letter slips into view; 12–15s maid gasps and all three risks remain legible.",
    dialogue: ["仆妇：小心灯！"],
    references: [
      {
        path: review("PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01.png"),
        role: "lantern action geometry",
      },
      {
        path: review("PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04.png"),
        role: "Daiyu and foreground action blocking",
      },
    ],
    durationSeconds: 15,
  },
  {
    id: "C2-R01-PROTECT-DAIYU",
    act: "CORRIDOR",
    condition: "choice.C2-PROTECT-DAIYU",
    purpose: "The player frees Daiyu without grabbing her body.",
    action:
      "First-person hands pin only the caught fabric beside the hook so Daiyu can withdraw her own sleeve. She recoils half a step, recognizes the respectful distance, then looks at the exposed letter and back to camera.",
    timeline:
      "0–5s careful fabric action; 5–9s Daiyu withdraws and speaks first line; 9–14s she notices the letter and speaks second line; 14–15s shared look.",
    dialogue: ["黛玉：我自己来……好了。", "黛玉：你也当心自己的信。"],
    references: [
      {
        path: review("PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04.png"),
        role: "respectful action blocking",
      },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "locked Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C2-R02-STEADY-LANTERN",
    act: "CORRIDOR",
    condition: "choice.C2-STEADY-LANTERN",
    purpose: "The player steadies the flame before it reaches Daiyu.",
    action:
      "First-person catches the heavy lantern frame with believable inertia while the maid frees Daiyu's sleeve. Daiyu watches the hand rather than the flame, surprised that camera avoids touching her. Fire settles naturally.",
    timeline:
      "0–5s catch and physical recoil; 5–9s maid secures flame; 9–14s Daiyu speaks with restrained gratitude; 14–15s lantern settles.",
    dialogue: ["黛玉：多谢。你倒比我先看见风。"],
    references: [
      {
        path: review("PLAYER-POV-ACTION-STABILIZE-LANTERN-REF-V01.png"),
        role: "lantern catch geometry",
      },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "locked Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C2-R03-PROTECT-LETTER",
    act: "CORRIDOR",
    condition: "choice.C2-PROTECT-LETTER",
    purpose: "The player protects the secret while others handle the danger.",
    action:
      "First-person presses the letter back into the sleeve. The maid catches the lantern and Daiyu frees herself. Daiyu's gaze stays on the hidden paper; the maid delivers a dry warning without villainy.",
    timeline:
      "0–4s letter is secured; 4–8s maid catches lantern and Daiyu frees sleeve; 8–11s Daiyu speaks; 11–15s maid answers while they resume walking.",
    dialogue: ["黛玉：那封信，比火还怕见风么？", "仆妇：进了这府，藏得越紧，瞧见的人越多。"],
    references: [
      { path: preview("sc03-lantern.png"), role: "corridor continuity" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A2-S03-JIAMU-EMBRACE",
    act: "CORRIDOR",
    condition: "always",
    purpose: "Grandmother Jia sees Daiyu and the film gives the original emotion full priority.",
    action:
      "Respectful over-shoulder first-person co-frame in Grandmother Jia's warm room. She rises with age and urgency, draws Daiyu into a real embrace, and studies how thin she has become. Family members soften in depth; camera does not intrude.",
    timeline:
      "0–4s Grandmother Jia recognizes Daiyu and rises; 4–11s embrace and first line; 11–15s Daiyu answers through held breath.",
    dialogue: ["贾母：我的儿，今日才见着你了……怎么这样瘦？", "黛玉：外祖母。"],
    references: [
      { path: review("SC04-B01-POV-COFRAME-REF-V02.png"), role: "locked embrace composition" },
      { path: review("CAST-ENSEMBLE-REF-V01.png"), role: "ensemble continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A2-S04-JIAMU-COMFORT",
    act: "CORRIDOR",
    condition: "always",
    purpose: "The embrace breathes and Grandmother Jia promises Daiyu a home.",
    action:
      "Intimate but restrained 50mm two-shot. Grandmother Jia cups Daiyu's shoulders, wipes no theatrical tears, and says the promise with grief under control. Daiyu listens rather than posing; quiet relatives remain present.",
    timeline:
      "0–4s held silence and cloth movement; 4–11s Grandmother Jia speaks; 11–15s Daiyu lowers her eyes and grips the elder's sleeve.",
    dialogue: ["贾母：往后这里就是家。缺什么，只管告诉我。"],
    references: [
      { path: review("SC04-B01-EMOTION-BLOCKING-REF-V01.png"), role: "emotion blocking" },
      { path: review("CHAR-JIAMU-CAST-A-REF-V02.png"), role: "locked Grandmother Jia identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A2-S05-JIAMU-TURNS",
    act: "CORRIDOR",
    condition: "always",
    purpose: "Only after receiving Daiyu does Grandmother Jia notice the unknown visitor.",
    action:
      "The camera stays first-person at respectful distance. Grandmother Jia sits with one hand still holding Daiyu, then finally turns to camera. Her gaze recognizes the named old connection but not the person; she invites camera one measured step closer.",
    timeline:
      "0–5s room settles around Daiyu; 5–12s Grandmother Jia asks camera to come closer; 12–15s slow step forward and her searching gaze.",
    dialogue: ["贾母：你就是沈家老姐姐信里说的孩子？近些，让我看看。"],
    references: [
      { path: review("CHAR-JIAMU-CAST-A-REF-V02.png"), role: "locked Grandmother Jia identity" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "Daiyu continuity beside her" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A2-S06-LETTER-TO-XIFENG",
    act: "CORRIDOR",
    condition: "always",
    purpose:
      "The old relationship is accepted for one night, while Xifeng takes control of the evidence.",
    action:
      "Grandmother Jia studies the old signature and the impossible pale-red seal. Her fingers pause, then she passes the letter sideways to Wang Xifeng. Xifeng receives it with a warm social smile that never reaches her analytical eyes.",
    timeline:
      "0–5s elder studies signature and seal; 5–10s she grants one night and passes letter; 10–15s Xifeng answers while testing camera.",
    dialogue: [
      "贾母：旧人我认得，旧情也认得。既来了，先住一夜。信，明日再细看。",
      "熙凤：老祖宗放心。我最会替人安置‘来处不清’的客。",
    ],
    references: [
      { path: review("CHAR-JIAMU-CAST-A-REF-V02.png"), role: "Grandmother Jia identity" },
      { path: review("CHAR-XIFENG-CAST-A-REF-V02.png"), role: "locked Wang Xifeng identity" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S01-XIFENG-CLOSES-DOOR",
    act: "HOUSE",
    condition: "always",
    purpose: "Xifeng turns hospitality into a private examination.",
    action:
      "First-person follows Wang Xifeng into a smaller side room. She closes the door herself, places the letter precisely on a dark table, and does not offer camera a seat. Her wit is attractive and socially effortless, never caricature villainy.",
    timeline:
      "0–5s lateral follow and door closes behind camera; 5–9s letter placed on table; 9–15s Xifeng delivers the line and studies the silent answer.",
    dialogue: ["熙凤：门上传来的话，我一字没忘。现在，该你自己说了。"],
    references: [
      { path: review("SC05-B02-POV-WAIT-REF-V01.png"), role: "side-room first-person composition" },
      { path: review("CHAR-XIFENG-CAST-A-REF-V02.png"), role: "locked Wang Xifeng identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S02-XIFENG-DATE-TRAP",
    act: "HOUSE",
    condition: "always",
    purpose: "Xifeng exposes that the letter's history and fresh seal cannot coexist.",
    action:
      "Controlled 65mm first-person interrogation. Xifeng turns the paper with one fingertip, intentionally states inconsistent dates, and watches camera rather than the letter for a reaction. Accurate natural Mandarin lip sync and micro-expression.",
    timeline:
      "0–4s paper turns under fingertip; 4–8s first date line; 8–13s second line and measured smile; 13–15s silence with direct gaze.",
    dialogue: [
      "熙凤：沈老夫人的信，落的是三月初七。",
      "熙凤：可惜——她老人家三月初五便不见外客了。",
    ],
    references: [
      { path: preview("sc05-xifeng.png"), role: "Xifeng letter-table composition" },
      { path: review("CHAR-XIFENG-CAST-A-REF-V02.png"), role: "locked Wang Xifeng identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S03-XIFENG-SEAL",
    act: "HOUSE",
    condition: "always",
    purpose: "Xifeng keeps the mystery alive without another blocking choice.",
    action:
      "Xifeng's fingertip stops short of touching the pale-red seal. It seems newly wet only in changing lamp reflection, never magical glow. She pushes the letter back one inch—neither returning nor confiscating it—and makes a pragmatic offer.",
    timeline:
      "0–5s fingertip and seal insert; 5–11s Xifeng speaks with low amused caution; 11–15s she pushes letter one inch and opens the door on sound bridge.",
    dialogue: ["熙凤：旧事是真的，印却太新。你不肯说也罢——先别让旁人替你说。"],
    references: [
      { path: preview("sc05-xifeng.png"), role: "side-room continuity" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "seal close-up" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S04-BAOYU-FORMAL-ENTRY",
    act: "HOUSE",
    condition: "always",
    purpose: "Baoyu first appears in the formal costume described by the novel.",
    action:
      "Sound bridge into Grandmother Jia's room. Jia Baoyu enters in the exact novel-faithful formal look: jeweled purple-gold crown, dragon pearl headband, red butterfly-flower arrow sleeves, dark teal patterned outer coat, black court boots. He moves with bright natural curiosity, not imperial swagger.",
    timeline:
      "0–5s doors open and formal Baoyu crosses layered family foreground; 5–9s Grandmother Jia sends him to see his mother; 9–15s he answers with a quick affectionate bow and exits.",
    dialogue: ["贾母：去见你娘来。"],
    references: [
      { path: review("CHAR-BAOYU-FORMAL-REF-V02.png"), role: "novel-faithful formal Baoyu" },
      {
        path: review("SC07-B01-B02-COSTUME-TRANSITION-REF-V03.png"),
        role: "formal-to-home scene continuity",
      },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S05-BAOYU-HOME-RETURN",
    act: "HOUSE",
    condition: "always",
    purpose: "Baoyu returns in his home costume and meets Daiyu as in the novel.",
    action:
      "Baoyu returns in the exact home look: short braided hair gathered into a glossy long braid with red ties and four large pearls, faded silver-red flowered jacket, collar jade and protective pendants, pine-green trousers, thick red shoes. He stops on seeing Daiyu; recognition replaces performance.",
    timeline:
      "0–5s home-costume Baoyu enters with lively steps; 5–10s he sees Daiyu and softly says the famous line; 10–15s Grandmother Jia rebukes him and he smiles without mockery.",
    dialogue: ["宝玉：这个妹妹，我曾见过的。", "贾母：又胡说。你何曾见过她？"],
    references: [
      { path: review("CHAR-BAOYU-HOME-REF-V02.png"), role: "novel-faithful home Baoyu" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "locked Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S06-BAOYU-RECOGNITION",
    act: "HOUSE",
    condition: "always",
    purpose: "Baoyu articulates the uncanny recognition and then notices the player.",
    action:
      "A gently circling relationship shot keeps Baoyu and Daiyu in the same frame while the first-person camera remains the third point. Baoyu explains the familiarity sincerely, then turns to camera with the sudden intuition that the player is also unwritten.",
    timeline:
      "0–8s Baoyu speaks to Grandmother Jia while looking at Daiyu; 8–11s he turns toward camera; 11–15s he asks the player the unsettling question.",
    dialogue: ["宝玉：虽没见过，看着面善，心里倒像远别重逢。", "宝玉：你呢？你从哪一册里来的？"],
    references: [
      { path: review("CHAR-BAOYU-HOME-REF-V02.png"), role: "home Baoyu identity" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "Daiyu identity" },
      { path: review("CAST-ENSEMBLE-REF-V01.png"), role: "room ensemble scale" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S07-ASK-ABOUT-JADE",
    act: "HOUSE",
    condition: "always",
    purpose: "The original jade exchange unfolds without interruption.",
    action:
      "Natural medium two-shot. Baoyu lightly touches his own collar jade and asks Daiyu; she answers honestly with contained vulnerability. Family members in depth sense the danger before he does. No melodramatic zoom.",
    timeline:
      "0–4s Baoyu asks about jade; 4–11s Daiyu answers; 11–15s Baoyu's expression changes and his fingers tighten around the cord.",
    dialogue: ["宝玉：妹妹可也有玉没有？", "黛玉：我没有那个。想来那玉是件罕物，岂能人人都有。"],
    references: [
      { path: review("SC08-B01-JADE-ACTION-BLOCKING-REF-V02.png"), role: "jade scene blocking" },
      { path: review("PROP-JADE-REF-V01.png"), role: "canonical Tongling jade" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A3-S08-JADE-THROW",
    act: "HOUSE",
    condition: "always",
    purpose: "Baoyu throws the jade and the third choice arrives at peak pressure.",
    action:
      "Baoyu's hurt turns inward rather than aggressive toward Daiyu. He pulls off the jade and releases it toward the foreground floor with believable cord weight. Use a fast but readable pan following the object, then freeze the dramatic geometry before impact for the choice overlay; no actual impact yet.",
    timeline:
      "0–7s Baoyu rejects the jade in one breath; 7–11s hand removes and releases it; 11–15s camera follows the descending jade and holds the unresolved action.",
    dialogue: ["宝玉：家里姐姐妹妹都没有，单我有。我说它是什么好东西！"],
    references: [
      { path: review("SC08-B01-JADE-ACTION-BLOCKING-REF-V02.png"), role: "throw action blocking" },
      { path: review("CHAR-BAOYU-HOME-REF-V02.png"), role: "home Baoyu identity and costume" },
      { path: review("PROP-JADE-REF-V01.png"), role: "canonical jade" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C3-R01-CATCH-JADE",
    act: "HOUSE",
    condition: "choice.C3-CATCH-JADE",
    purpose: "The player catches the jade and absorbs the physical consequence.",
    action:
      "First-person hand catches the falling jade just above the floor; cord snaps tight and the hand recoils with pain. Baoyu is startled by the intervention, Grandmother Jia moves forward, Daiyu watches the player's hurt rather than the object.",
    timeline:
      "0–4s catch and painful recoil; 4–7s Baoyu blurts his line; 7–12s Grandmother Jia checks jade and hand; 12–15s Daiyu speaks softly.",
    dialogue: [
      "宝玉：谁叫你接的？",
      "贾母：先把玉拿稳！手可伤了？",
      "黛玉：为一件东西，倒叫旁人受伤。",
    ],
    references: [
      { path: review("PLAYER-POV-ACTION-CATCH-JADE-REF-V02.png"), role: "jade catch geometry" },
      { path: review("PROP-JADE-REF-V01.png"), role: "canonical jade" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C3-R02-SHIELD-DAIYU",
    act: "HOUSE",
    condition: "choice.C3-SHIELD-DAIYU",
    purpose: "The player shields Daiyu while the jade hits the floor.",
    action:
      "First-person moves between Daiyu and the falling jade without touching her. The jade hits wood once out of foreground; Daiyu starts to object, while Baoyu immediately clarifies that he was not throwing it at her. The room remains emotionally complex, not action cinema.",
    timeline:
      "0–4s camera shifts and sleeve shields; 4–6s one jade impact; 6–10s Daiyu begins; 10–14s Baoyu answers; 14–15s stunned room tone.",
    dialogue: ["黛玉：我无事。你不用——", "宝玉：我不是要砸她。"],
    references: [
      {
        path: review("PLAYER-POV-ACTION-SHIELD-DAIYU-REF-V04.png"),
        role: "shield action blocking",
      },
      { path: review("CHAR-BAOYU-HOME-REF-V02.png"), role: "Baoyu reaction identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C3-R03-CALL-JIAMU",
    act: "HOUSE",
    condition: "choice.C3-CALL-JIAMU",
    purpose: "The player calls the elder instead of entering the physical conflict.",
    action:
      "The jade strikes wood once as camera turns immediately toward Grandmother Jia. She takes authority, servants stop crowding, and Wang Xifeng notes that the newcomer already understands who can end a household crisis.",
    timeline:
      "0–3s impact and camera turns; 3–9s Grandmother Jia takes command; 9–14s Xifeng comments with half a smile; 14–15s order returns.",
    dialogue: ["贾母：孽障！先把玉捡起来！", "熙凤：这府里的人，倒叫你认得快。"],
    references: [
      { path: review("CHAR-JIAMU-CAST-A-REF-V02.png"), role: "Grandmother Jia authority" },
      { path: review("CHAR-XIFENG-CAST-A-REF-V02.png"), role: "Xifeng reaction identity" },
      { path: review("PROP-JADE-REF-V01.png"), role: "jade continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C3-R04-LET-FALL",
    act: "HOUSE",
    condition: "choice.C3-LET-FALL",
    purpose: "The player does not intervene and the family absorbs the consequence.",
    action:
      "The jade hits the wooden floor once in a clear wide relationship frame. Everyone flinches differently; Grandmother Jia rebukes Baoyu, Daiyu withdraws into guilt, and camera remains the only still point. No shattered jade and no repeated impact.",
    timeline:
      "0–3s single impact; 3–9s room reactions; 9–13s Grandmother Jia rebukes Baoyu; 13–15s Daiyu looks down and Baoyu freezes.",
    dialogue: ["贾母：孽障！还不快捡起来！"],
    references: [
      { path: review("SC08-B01-JADE-ACTION-BLOCKING-REF-V02.png"), role: "wide impact blocking" },
      { path: review("CAST-ENSEMBLE-REF-V01.png"), role: "ensemble identities" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A4-S01-DAIYU-NIGHT-ARRIVAL",
    act: "NIGHT",
    condition: "always",
    purpose: "Daiyu visits at night after the public crisis.",
    action:
      "Moonlit first-person room, motivated by one low warm oil lamp and cool lattice light. Daiyu enters alone, closes neither distance nor door theatrically, notices the player's hand, then asks about the injury and the letter in one restrained breath.",
    timeline:
      "0–5s Daiyu appears at doorway and listens for others; 5–12s she asks the question; 12–15s her gaze drops to the player's hand and returns.",
    dialogue: ["黛玉：方才那一下，可曾伤着？我来，是还想问那封信。"],
    references: [
      { path: preview("sc09-daiyu-night.png"), role: "night Daiyu composition" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "locked Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A4-S02-DAIYU-REMEMBERS",
    act: "NIGHT",
    condition: "always",
    purpose: "Daiyu reveals that she has watched the player's choices all day.",
    action:
      "Daiyu sits at the edge of lamplight, keeping the player at conversational distance. She recalls that the household kept asking where camera came from, yet camera's actions showed what mattered. Her intelligence leads the emotion; no romantic posing.",
    timeline:
      "0–4s quiet settling and tea steam; 4–12s Daiyu speaks with small pauses; 12–15s distant footsteps make both listen.",
    dialogue: ["黛玉：这府里人人问你的来处。可一个人先护什么，倒比话更真。"],
    references: [
      { path: preview("sc09-daiyu-night.png"), role: "night room continuity" },
      { path: review("CHAR-DAIYU-LIGHT-TEST-V01.png"), role: "Daiyu mixed lamp and moon lighting" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A4-S03-LETTER-REVEAL",
    act: "NIGHT",
    condition: "always",
    purpose: "Daiyu sees the impossible seal and names its danger.",
    action:
      "First-person opens only the sealed edge of the letter on the table. Daiyu leans enough to see the pale-red mark but never touches it. Rack focus moves from paper fibres to her face as she understands that a false mark can destroy true history.",
    timeline:
      "0–5s letter edge opens and lamp reveals seal; 5–12s rack focus to Daiyu while she speaks; 12–15s she looks from seal to camera.",
    dialogue: ["黛玉：真的东西上，也能落一个假的印。那假的，便会把真的也拖累了。"],
    references: [
      { path: review("PROP-LETTER-REF-V01.png"), role: "canonical letter and seal" },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A4-S04-DAIYU-REFUSES-FATE",
    act: "NIGHT",
    condition: "always",
    purpose: "Daiyu rejects a book deciding a person's whole life.",
    action:
      "A slow restrained push toward Daiyu as she stops looking at the letter and addresses camera directly. She does not know the supernatural mechanism, but recognizes the loneliness of being unwritten. Let both lines breathe with silence between them.",
    timeline:
      "0–3s she raises her eyes; 3–8s first line; 8–10s held silence and lamp movement; 10–15s second line.",
    dialogue: ["黛玉：我不信什么册子替人把一生写完。", "黛玉：可我信有人会梦见自己没有地方可写。"],
    references: [
      { path: preview("sc09-daiyu-night.png"), role: "night composition" },
      { path: review("CHAR-DAIYU-LIGHT-TEST-V01.png"), role: "Daiyu night lighting" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A4-S05-SEAL-AWAKENS",
    act: "NIGHT",
    condition: "always",
    purpose:
      "The letter's pale-red pattern behaves like water without turning into fantasy spectacle.",
    action:
      "Macro live-action insert on authentic paper fibres and seal. Oil-lamp reflection travels like water across the pale-red mark; for one moment the pattern appears to retreat against the fibres, achieved as subtle practical optical ambiguity, never glowing magic. An unidentified female voice is heard.",
    timeline:
      "0–5s paper, breath and lamp macro; 5–10s subtle reverse-looking seal motion; 7–12s voice asks the question; 12–15s reflection becomes ordinary again.",
    dialogue: ["命册女声（画外）：信是真的，人便是真的么？"],
    references: [
      { path: review("PROP-LETTER-REF-V01.png"), role: "canonical paper and seal" },
      { path: review("LOCATION-TAIXU-REF-V01.png"), role: "subtle water-reflection motif only" },
    ],
    durationSeconds: 15,
  },
  {
    id: "A4-S06-LETTER-CHOICE-WAIT",
    act: "NIGHT",
    condition: "always",
    purpose: "A clean, living wait plate for the final destination choice.",
    action:
      "Locked first-person two-plane composition: recommendation letter in foreground, Daiyu seated in soft focus beyond it. Only reversible natural motion—breathing, lamp flame, faint curtain and tea steam. No speech, no hand entry, no blinking loop emphasis, and no irreversible action. End matches its own calm beginning for a seamless wait.",
    timeline:
      "0–15s continuous quiet living tableau with night insects, soft flame and cloth room tone; no dialogue; preserve stable choice-safe negative space on the lower right.",
    dialogue: [],
    references: [
      { path: preview("sc10-letter.png"), role: "letter foreground composition" },
      { path: preview("sc09-daiyu-night.png"), role: "Daiyu night background continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C4-E01-TRUST-DAIYU",
    act: "NIGHT",
    condition: "ending.E01",
    purpose:
      "Ending: the player entrusts the letter to Daiyu and they face the household as two guests.",
    action:
      "First-person offers the closed letter across the table. Daiyu does not grab it; she places her fingertips beside it, accepting shared responsibility. Dawn cools the lattice while the lamp remains warm. Her final smile is tiny, tired and real.",
    timeline:
      "0–5s letter is offered and Daiyu considers; 5–11s she speaks first line; 11–15s fingertips settle beside letter and she completes the promise.",
    dialogue: ["黛玉：这府里路多，门也多。我未必认得全。", "黛玉：既都是客，路便一同认吧。"],
    references: [
      {
        path: review("PLAYER-POV-ACTION-OFFER-LETTER-REF-V01.png"),
        role: "letter offering composition",
      },
      { path: review("CHAR-DAIYU-CAST-A-REF-V02.png"), role: "Daiyu identity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C4-E02-HAND-XIFENG",
    act: "NIGHT",
    condition: "ending.E02",
    purpose: "Ending: Xifeng legitimizes the player's name while keeping leverage over the letter.",
    action:
      "Early morning first-person side room. Xifeng receives the letter, stamps a separate household entry slip rather than the mysterious page, and looks directly at camera. Her gift of status and acquisition of leverage occur in the same elegant action.",
    timeline:
      "0–5s letter changes hands and entry slip is positioned; 5–10s she stamps and speaks first line; 10–15s she keeps the old letter and speaks second line.",
    dialogue: [
      "熙凤：从今往后，门上知道怎么报你的名字了。",
      "熙凤：至于旧信——旧东西，我替你收着最妥当。",
    ],
    references: [
      { path: review("CHAR-XIFENG-CAST-A-REF-V02.png"), role: "Xifeng identity" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C4-E03-KEEP-LETTER",
    act: "NIGHT",
    condition: "ending.E03",
    purpose: "Ending: the player keeps authorship and the blank register acknowledges resistance.",
    action:
      "First-person folds the letter back into the sleeve as dawn begins. Match dissolve through Qinhuai water reflection to the blank register resting closed, not floating. The pale-red pattern fades instead of sealing a verdict.",
    timeline:
      "0–6s letter is folded and kept; 6–11s water-reflection match transition; 11–15s closed register and female voice, then a quiet breath of water.",
    dialogue: ["命册女声（画外）：原来真有不肯照写的人。"],
    references: [
      { path: preview("ending-water.png"), role: "Qinhuai ending reflection" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter continuity" },
      { path: review("LOCATION-TAIXU-REF-V01.png"), role: "register motif" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C4-E04-DESTROY-LEAVE",
    act: "NIGHT",
    condition: "ending.E04",
    purpose: "Ending: the player destroys the seal and leaves without borrowed proof.",
    action:
      "First-person tears only the sealed edge from the letter, drops the impossible mark into a water basin where ink disperses naturally, then walks out through the Rongguo gate at blue dawn. The same steward watches, now curious rather than dismissive.",
    timeline:
      "0–5s sealed edge tears and enters water; 5–10s ink disperses and camera turns; 10–15s camera passes gate as steward asks the final question.",
    dialogue: ["门上：来时凭一封信，走时倒什么也不带？"],
    references: [
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter seal continuity" },
      { path: preview("ending-water.png"), role: "water and dawn palette" },
      { path: preview("sc02-daiyu.png"), role: "gate continuity" },
    ],
    durationSeconds: 15,
  },
  {
    id: "C4-E05-UNWRITTEN",
    act: "NIGHT",
    condition: "ending.E05",
    purpose: "Ending: no one accepts the letter yet, but the story explicitly remains open.",
    action:
      "Wang Xifeng returns the unopened letter across a long table at dawn, withholding household recognition without cruelty. After her line, cut within the same moving shot to the letter reflected in dark water; the unidentified female voice answers that the page is unfinished.",
    timeline:
      "0–7s Xifeng returns letter and speaks; 7–12s camera lowers with letter toward dark reflective tabletop; 12–15s female voice and one expanding water-like reflection.",
    dialogue: ["熙凤：没有人担保的话，旧情也只能算一张旧纸。", "命册女声（画外）：还没有写完。"],
    references: [
      { path: review("CHAR-XIFENG-CAST-A-REF-V02.png"), role: "Xifeng identity" },
      { path: review("PROP-LETTER-REF-V01.png"), role: "letter continuity" },
      { path: preview("ending-water.png"), role: "unfinished reflection motif" },
    ],
    durationSeconds: 15,
  },
] as const satisfies readonly JinlingFilmShotV2[];

/**
 * Physical generation segments are capped at 15 seconds, but the audience-facing
 * film is staged as a simulated unbroken take. Every direct successor must start
 * from the exact tail frame of its predecessor. Hidden cuts are reserved for
 * motivated lens occlusion around scene changes and player choices.
 */
export const JINLING_FILM_CONTINUITY_V3: Readonly<Record<string, JinlingFilmContinuityRule>> = {
  "A1-S02-DAIYU-SEDAN": { predecessorId: "A1-S01-CARRIAGE-WAKE", join: "hidden-cut" },
  "A1-S03-GATE-ARRIVAL": { predecessorId: "A1-S02-DAIYU-SEDAN", join: "direct" },
  "A1-S04-GATE-QUESTION": { predecessorId: "A1-S03-GATE-ARRIVAL", join: "direct" },
  "C1-R01-OLD-TRUST": { predecessorId: "A1-S04-GATE-QUESTION", join: "direct" },
  "C1-R02-DAIYU-ROAD": { predecessorId: "A1-S04-GATE-QUESTION", join: "direct" },
  "C1-R03-KEEPSAKE": { predecessorId: "A1-S04-GATE-QUESTION", join: "direct" },

  "A2-S02-WIND-CRISIS": { predecessorId: "A2-S01-CORRIDOR-ENTRY", join: "direct" },
  "C2-R01-PROTECT-DAIYU": { predecessorId: "A2-S02-WIND-CRISIS", join: "direct" },
  "C2-R02-STEADY-LANTERN": { predecessorId: "A2-S02-WIND-CRISIS", join: "direct" },
  "C2-R03-PROTECT-LETTER": { predecessorId: "A2-S02-WIND-CRISIS", join: "direct" },

  "A2-S04-JIAMU-COMFORT": { predecessorId: "A2-S03-JIAMU-EMBRACE", join: "direct" },
  "A2-S05-JIAMU-TURNS": { predecessorId: "A2-S04-JIAMU-COMFORT", join: "direct" },
  "A2-S06-LETTER-TO-XIFENG": { predecessorId: "A2-S05-JIAMU-TURNS", join: "direct" },
  "A3-S01-XIFENG-CLOSES-DOOR": { predecessorId: "A2-S06-LETTER-TO-XIFENG", join: "hidden-cut" },
  "A3-S02-XIFENG-DATE-TRAP": { predecessorId: "A3-S01-XIFENG-CLOSES-DOOR", join: "direct" },
  "A3-S03-XIFENG-SEAL": { predecessorId: "A3-S02-XIFENG-DATE-TRAP", join: "direct" },
  "A3-S04-BAOYU-FORMAL-ENTRY": { predecessorId: "A3-S03-XIFENG-SEAL", join: "hidden-cut" },
  "A3-S05-BAOYU-HOME-RETURN": { predecessorId: "A3-S04-BAOYU-FORMAL-ENTRY", join: "hidden-cut" },
  "A3-S06-BAOYU-RECOGNITION": { predecessorId: "A3-S05-BAOYU-HOME-RETURN", join: "direct" },
  "A3-S07-ASK-ABOUT-JADE": { predecessorId: "A3-S06-BAOYU-RECOGNITION", join: "direct" },
  "A3-S08-JADE-THROW": { predecessorId: "A3-S07-ASK-ABOUT-JADE", join: "direct" },
  "C3-R01-CATCH-JADE": { predecessorId: "A3-S08-JADE-THROW", join: "direct" },
  "C3-R02-SHIELD-DAIYU": { predecessorId: "A3-S08-JADE-THROW", join: "direct" },
  "C3-R03-CALL-JIAMU": { predecessorId: "A3-S08-JADE-THROW", join: "direct" },
  "C3-R04-LET-FALL": { predecessorId: "A3-S08-JADE-THROW", join: "direct" },

  "A4-S02-DAIYU-REMEMBERS": { predecessorId: "A4-S01-DAIYU-NIGHT-ARRIVAL", join: "direct" },
  "A4-S03-LETTER-REVEAL": { predecessorId: "A4-S02-DAIYU-REMEMBERS", join: "direct" },
  "A4-S04-DAIYU-REFUSES-FATE": { predecessorId: "A4-S03-LETTER-REVEAL", join: "direct" },
  "A4-S05-SEAL-AWAKENS": { predecessorId: "A4-S04-DAIYU-REFUSES-FATE", join: "hidden-cut" },
  "A4-S06-LETTER-CHOICE-WAIT": { predecessorId: "A4-S05-SEAL-AWAKENS", join: "direct" },
  "C4-E01-TRUST-DAIYU": { predecessorId: "A4-S06-LETTER-CHOICE-WAIT", join: "direct" },
  "C4-E02-HAND-XIFENG": { predecessorId: "A4-S06-LETTER-CHOICE-WAIT", join: "hidden-cut" },
  "C4-E03-KEEP-LETTER": { predecessorId: "A4-S06-LETTER-CHOICE-WAIT", join: "direct" },
  "C4-E04-DESTROY-LEAVE": { predecessorId: "A4-S06-LETTER-CHOICE-WAIT", join: "direct" },
  "C4-E05-UNWRITTEN": { predecessorId: "A4-S06-LETTER-CHOICE-WAIT", join: "hidden-cut" },
};

/** Visually reviewed seams that are completed in the final edit with a motivated occluder. */
export const JINLING_FILM_EDIT_BRIDGES_V3: Readonly<Record<string, string>> = {
  "A1-S04-GATE-QUESTION": "red-gate-pillar-whip",
  "A2-S06-LETTER-TO-XIFENG": "letter-rise-pullback",
  "A3-S03-XIFENG-SEAL": "letter-rise-seal-insert",
  "A4-S02-DAIYU-REMEMBERS": "candle-steam-pullback",
  "A4-S03-LETTER-REVEAL": "hands-enter-letter-rack-focus",
  "A4-S04-DAIYU-REFUSES-FATE": "letter-lower-eye-lift",
  "C1-R01-OLD-TRUST": "choice-confirm-gate-dip",
  "C1-R02-DAIYU-ROAD": "choice-confirm-gate-dip",
  "C1-R03-KEEPSAKE": "choice-confirm-gate-dip",
  "C2-R01-PROTECT-DAIYU": "choice-confirm-lantern-dip",
  "C2-R02-STEADY-LANTERN": "choice-confirm-lantern-dip",
  "C2-R03-PROTECT-LETTER": "choice-confirm-lantern-dip",
  "C3-R01-CATCH-JADE": "choice-confirm-sleeve-dip",
  "C3-R02-SHIELD-DAIYU": "choice-confirm-sleeve-dip",
  "C3-R03-CALL-JIAMU": "choice-confirm-sleeve-dip",
  "C3-R04-LET-FALL": "choice-confirm-sleeve-dip",
  "C4-E01-TRUST-DAIYU": "final-choice-lamp-dip",
  "C4-E02-HAND-XIFENG": "final-choice-lamp-dip",
  "C4-E03-KEEP-LETTER": "final-choice-lamp-dip",
  "C4-E04-DESTROY-LEAVE": "final-choice-lamp-dip",
  "C4-E05-UNWRITTEN": "final-choice-lamp-dip",
};

export const JINLING_FILM_CUT_V2_COMMON_SECONDS = JINLING_FILM_CUT_V2.filter(
  (shot) => shot.condition === "always"
).reduce((total, shot) => total + shot.durationSeconds, 0);

export const JINLING_FILM_CUT_V2_ROUTE_SECONDS = JINLING_FILM_CUT_V2_COMMON_SECONDS + 4 * 15;
