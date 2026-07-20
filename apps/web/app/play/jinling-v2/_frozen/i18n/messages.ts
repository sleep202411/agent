/**
 * Frozen copy of the jinlingRumeng message subtree (extracted at a187e155).
 * Deliberately NOT in messages/*.json so global i18n cleanups cannot break this demo.
 */
export const JINLING_MESSAGES = {
  "en-US": {
    back: "Games",
    loading: "Looking for your page…",
    resumePlayback: "Continue playback",
    meta: {
      title: "Dream of Jinling · The Unwritten Visitor",
      description: "Create an original character and enter the world of the Red Chamber.",
    },
    entry: {
      season: "Season One · The Unwritten Visitor",
      chapter: "Prologue · The Blank Register",
      title: "Dream of Jinling",
      question: "If there is no name in the register, is there no fate?",
      description:
        "Create an original person of your own, enter the world of the Red Chamber, and let every choice write what the old register never foretold.",
      begin: "Write my name",
      continueEyebrow: "Your page remains open",
      continue: "Continue · {name}",
      draftEyebrow: "An unfinished line remains",
      resumeDraft: "Finish writing my page",
      newPage: "Open another page",
      browsePages: "Written pages · {count}",
      localSave: "Your character and progress are stored only on this device.",
    },
    archive: {
      eyebrow: "Pages already written",
      title: "The register remembers every visitor",
      body: "Each identity keeps its own origin, temperament, choices, and stable checkpoint.",
      close: "Close",
      active: "Current page",
      updated: "Last written · {date}",
    },
    creation: {
      eyebrow: "The unwritten prologue",
      ledgerTitle: "The Blank Register",
      progress: "{current} / {total}",
      asideNote:
        "The register records only what you choose. It does not assign a correct origin or temperament.",
      steps: {
        name: "Name",
        origin: "Origin",
        trait: "Temperament",
        confirm: "Seal",
      },
      name: {
        eyebrow: "First line",
        title: "Who will enter the story?",
        body: "This is your own name in the world—not the name of anyone already written in the Red Chamber.",
        label: "Name in the register",
        placeholder: "Write a name",
        hint: "1–8 characters. Spoken scenes will address you naturally without reading a custom name aloud.",
        tooLong: "The name must contain no more than 8 characters.",
      },
      origin: {
        eyebrow: "Second line",
        title: "How were you written into this world?",
        body: "Every origin leads to the same gates, but people will notice different knowledge, objects, and contradictions in you.",
        options: {
          weave: {
            title: "Descendant of a Jiangning weaver",
            description:
              "Recognise cloth, paper, seals, and the hidden history of household procurement.",
            keepsake: "Keepsake · Half a cloud-brocade sample",
          },
          kin: {
            title: "Junior of an old Jia family friend",
            description:
              "Know forms of address, seating, and how old relationships exert their quiet pressure.",
            keepsake: "Keepsake · An old private calling card",
          },
          medic: {
            title: "Apprentice from a Jinling clinic",
            description:
              "Notice breath, fatigue, medicine scents, and feelings that words try to conceal.",
            keepsake: "Keepsake · A medicinal sachet",
          },
        },
      },
      trait: {
        eyebrow: "Third line",
        title: "What do you trust when the room falls silent?",
        body: "Temperament unlocks a way of acting. It is not a score and never turns another choice into the wrong answer.",
        options: {
          heart: {
            title: "Compassion",
            description: "Protect, comfort, and take on what another person cannot carry alone.",
          },
          careful: {
            title: "Care",
            description:
              "Observe, keep confidence, and understand where a boundary must not be crossed.",
          },
          quick: {
            title: "Wit",
            description:
              "Test a claim, see through a feint, and turn a dangerous moment without breaking it.",
          },
        },
      },
      confirm: {
        eyebrow: "Before the seal falls",
        title: "{name}, this is your unwritten page",
        body: "A recommendation letter tied to Jia Min’s past will carry this identity to Rongguo Mansion. Only the pale-red seal is impossible.",
        originLabel: "Origin",
        traitLabel: "Temperament",
        keepsakeLabel: "Keepsake",
        warning:
          "Once sealed, a new local session begins at Qinhuai. You may later open another page without erasing this identity.",
      },
      cancel: "Close the register",
      back: "Previous line",
      next: "Continue",
      stamp: "Set the seal",
    },
    stamping: "The blank register is writing you into the world",
    sealed: {
      eyebrow: "The pale-red seal has fallen",
      title: "{name} is now inside the story",
      body: "The register has given your name a past, a keepsake, and a letter of recommendation. The first stable checkpoint waits in a carriage beside the Qinhuai River.",
      originLabel: "Worldly origin",
      traitLabel: "Remembered temperament",
      enterStory: "Enter Qinhuai",
      returnToLedger: "Return to the register",
      saved: "This identity has been saved on this device.",
    },
    story: {
      exit: "Leave the story",
      progress: "Chapter One · {current}/{total}",
      choose: "In this moment, you—",
      reactionPlaying: "The choice is made. Its consequence is unfolding…",
      reactionFailed:
        "The consequence film could not load. Your choice has not been committed, so it is safe to retry.",
      reactionRetry: "Retry consequence film",
      sound: {
        enable: "Enable sound",
        disable: "Mute sound",
        resume: "Play film with sound",
      },
      cut: {
        progress: "Film · {current}/{total}",
        chapters: {
          c1: {
            eyebrow: "Choice I · At the gate",
            title: "How will you prove your origin?",
            body: "The old seal has earned you one question. Your answer will reach the inner house before you do.",
            choices: {
              oldTrust: "Tell the truth: you carry an old entrusted letter for Grandmother Jia",
              daiyuRoad: "Say you arrived on the same road as Lin Daiyu",
              keepsake: "Show your keepsake and offer no further explanation",
            },
          },
          c2: {
            eyebrow: "Choice II · The corridor wind",
            title: "What do you protect first?",
            body: "The lantern, Daiyu’s caught sleeve and the exposed letter are all moving toward the same flame.",
            choices: {
              protectDaiyu: "Free Daiyu’s sleeve without taking hold of her",
              steadyLantern: "Catch and steady the heavy lantern first",
              protectLetter: "Secure the recommendation letter and its pale-red seal",
            },
          },
          c3: {
            eyebrow: "Choice III · The jade falls",
            title: "The room will remember this instant",
            body: "Baoyu has released the Tongling jade. There is only enough time for one clear action.",
            choices: {
              catchJade: "Catch the jade before it strikes the floor",
              shieldDaiyu: "Move between Daiyu and the falling jade",
              callJiamu: "Call Grandmother Jia and let her take command",
              letFall: "Do not intervene; let the household face the consequence",
            },
          },
          c4: {
            eyebrow: "Choice IV · Before dawn",
            title: "Who will carry the unwritten page?",
            body: "The letter’s history is real and its seal is impossible. Its next owner will decide what your first night in the Red Chamber means.",
            choices: {
              daiyu: "Entrust the letter to Daiyu and guard the truth together",
              xifeng: "Give it to Xifeng in exchange for a recognized place",
              keep: "Keep it and investigate the blank register yourself",
              burn: "Destroy the impossible seal and leave without borrowed proof",
            },
          },
        },
      },
      scenes: {
        sc01: {
          eyebrow: "SC01 · Waking by Qinhuai",
          title: "A letter that should not exist",
          body: "A carriage follows the Qinhuai River. When {name} wakes, an old letter of recommendation rests across their knees. Beyond the curtain, Lin Daiyu is also travelling toward Rongguo Mansion.",
          choices: {
            signature: "Look down and verify the old signature and provenance",
            seal: "Examine the letter’s unnaturally pale-red seal",
            curtain: "Look first toward the silent Lin Daiyu beyond the curtain",
          },
        },
        sc02: {
          eyebrow: "SC02 · At Rongguo Gate",
          title: "The gatekeepers recognize only provenance",
          body: "Daiyu’s card has gone inside. The gatekeeper turns to you and asks where the letter came from. Borrowing her name is easy—and leaves a future flaw.",
          choices: {
            honest: "State your origin truthfully and ask to be announced separately",
            borrow: "Claim Daiyu as your companion and send both names inside together",
          },
        },
        sc03: {
          eyebrow: "SC03 · Lantern in the gallery",
          title: "The wind reaches her first",
          body: "A draught slams the lantern toward the rail. Daiyu’s sleeve and the letter are both pulled toward the flame. You can protect only one first.",
          choices: {
            daiyu: "Free Daiyu’s sleeve from the lantern hook",
            letter: "Pin down the letter before the pale-red seal reaches the fire",
          },
        },
        sc04: {
          eyebrow: "SC04 · Meeting Grandmother Jia",
          title: "One nameless guest amid a room of tears",
          body: "Grandmother Jia gathers Daiyu into her arms. Old grief overwhelms ceremony. From outside the family circle, you catch the old woman’s brief glance through her tears.",
          choices: {
            bow: "Step back and let grandmother and granddaughter speak first",
            observe: "Watch who in the room notices the letter before anyone else",
          },
        },
        sc05: {
          eyebrow: "SC05 · Xifeng tests the guest",
          title: "Smiling, she names the wrong date",
          body: "Wang Xifeng takes you aside and casually misstates the letter’s date. She is waiting for you to follow her lead and expose a lie.",
          choices: {
            expose: "Correct the date and ask why she is testing you",
            handOver: "Hand her the letter to inspect and surrender the initiative for now",
          },
        },
        sc06: {
          eyebrow: "SC06 · Madam Wang’s boundary",
          title: "The household has chosen your place",
          body: "Madam Wang is courteous: the outer court is quiet and proper. A room near Daiyu offers companionship, but draws you deeper into the household’s gaze.",
          choices: {
            outer: "Accept the outer court and protect your boundaries",
            nearDaiyu: "Ask to stay closer to Daiyu so you may watch over one another",
          },
        },
        sc07: {
          eyebrow: "SC07 · A familiar stranger",
          title: "Baoyu asks: which register are you from?",
          body: "Baoyu returns in household clothes. He looks at Daiyu, then at you, as though he truly saw this unwritten page in a dream.",
          choices: {
            outsideLedger: "Tell him: I belong to no register already written",
            guest: "Say only that you are a temporary guest and return his attention to Daiyu",
          },
        },
        sc08: {
          eyebrow: "SC08 · The jade falls",
          title: "The instant the jade leaves his hand",
          body: "Baoyu’s emotion breaks. The jade flies from his hand; Daiyu stands beside its path, while you are closer. Everyone will remember what you do now.",
          choices: {
            catch: "Catch the jade and risk the cut to your hand",
            shield: "Shield Daiyu first and let the jade strike the floor",
          },
        },
        sc09: {
          eyebrow: "SC09 · Fellow guests",
          title: "At night, Daiyu asks about the pale-red seal",
          body: "As the lamps fail, Daiyu comes alone. She already knows the paper is real—and the seal belongs to no part of this world.",
          choices: {
            truth: "Tell her about the blank register and everything since you woke",
            promise: "Keep the truth for now, but promise the letter will not harm her",
          },
        },
        sc10: {
          eyebrow: "SC10 · Who writes fate?",
          title: "The letter’s final page remains blank",
          body: "The mansion grows dark. The letter was never meant to prove who you are; it was forcing you to choose who may write what comes next.",
          choices: {
            daiyu: "Give the letter to Daiyu and guard the truth together",
            xifeng: "Give the letter to Xifeng in exchange for a place in the mansion",
            keep: "Keep the letter and investigate the blank register yourself",
            burn: "Burn the letter and refuse every fate written for you",
          },
        },
      },
      ending: {
        eyebrow: "End of Chapter One",
        path: "This page recorded {count} choices. Progress is saved on this device.",
        restart: "Rewrite this chapter",
        exit: "Return to the register",
      },
      endings: {
        e01: {
          title: "Kindred Wanderers",
          body: "{name} places the letter in Daiyu’s hands. Two strangers who should never have met now guard an unfinished page together.",
        },
        e02: {
          title: "A Place in the House",
          body: "Xifeng takes the letter and makes a place for {name}. The position is real; its price will reveal itself slowly.",
        },
        e03: {
          title: "The Blank Register",
          body: "{name} keeps the letter and sees a new blank page beneath the pale-red seal: a register may record choices, but it cannot make them.",
        },
        e04: {
          title: "Home Before Dawn",
          body: "Fire consumes the letter and Qinhuai’s water returns. {name} leaves the mansion, still unwritten by any old fate.",
        },
        e05: {
          title: "Jade Breaks the Dream",
          body: "Choice and trust failed to catch one another. The jade strikes, and every watching eye pushes {name} back toward an unstable dream.",
        },
      },
    },
    storyV2: {
      exit: "Step away",
      loading: "Loading the reel…",
      rotate: {
        title: "Rotate to landscape",
        hint: "Turn your phone sideways for the full cinematic frame.",
      },
      choose: "In this moment, you—",
      reactionPlaying: "The choice is made. Its consequence is unfolding…",
      reactionFailed:
        "The consequence clip failed to load. Your choice hasn't been submitted — you can safely retry.",
      reactionRetry: "Retry consequence clip",
      sound: {
        enable: "Turn on sound",
        disable: "Turn off sound",
        resume: "Play with sound",
      },
      cut: {
        progress: "Cut · {current}/{total}",
        chapters: {
          c1: {
            eyebrow: "Choice I · The Rong Gate",
            title: "How will you prove where you came from?",
            body: "The gatekeeper has taken the letter, but still waits for a token that counts. Whatever you offer will reach the inner court before you do.",
            choices: {
              brocade: "Show the old Jiangning brocade fragment",
              oldSeal: "Show an old friend's private seal, and let him check the imprint",
              medicinePouch: "Show the medicine pouch and its worn prescription slip",
            },
          },
          c2: {
            eyebrow: "Choice II · Lantern in the Gallery",
            title: "The wind reaches her first",
            body: "A draft gusts through; the wind-lantern tips toward the rail. Daiyu's sleeve is snagged on its hook, and the letter is sliding from your own. You can only save one in time.",
            choices: {
              protectDaiyu: "Free Daiyu's snagged sleeve without touching her",
              steadyLantern: "Steady the heavy lantern first and bring the flame down",
              protectLetter: "Shield the letter and its faint crimson seal",
            },
          },
          c3: {
            eyebrow: "Choice III · The Falling Jade",
            title: "The whole hall will remember this instant",
            body: "Baoyu asks whether Daiyu has a jade — then tears his own free, cord and all, and hurls it at the floor. There is only time for one clear act.",
            choices: {
              catchJade: "Reach down and catch the falling jade",
              shieldDaiyu: "Step between Daiyu and the falling jade",
              callHousehold: "Call out for the household to take over the chaos",
              observePattern: "Stay your hand, and watch the crimson trace on jade and letter",
            },
          },
          c4: {
            eyebrow: "Choice IV · Before Daybreak",
            title: "Into whose hands does this unwritten fate go?",
            body: "Daiyu comes alone in the night. The letter's crimson trace rises in the lamplight yet never forms a single word. Where it lands will decide what your first night in the Rong house means.",
            choices: {
              spring: "Promise Daiyu the crabapple gallery, and live out this spring first",
              name: "Ask the house to enter your name on its roll, and stay in earnest",
              memory: "Tell her the truth of the wordless ledger and the waking",
              unwritten: "Settle nothing, and leave the fate ahead a blank page",
            },
          },
        },
      },
      ending: {
        eyebrow: "End of Reel One",
        path: "This fate-page recorded {count} choices. Progress is saved on this device.",
        restart: "Rewrite this reel",
        exit: "Back to the ledger",
      },
      endings: {
        e01: {
          title: "A Shared Spring",
          body: "{name} meets Daiyu beneath the crabapple gallery. Two strangers to this world take this one spring and live it fully first.",
        },
        e02: {
          title: "A Name in the House",
          body: "The Rong house enters {name} on its roll. The place is real; how to carry the name is a question the days ahead must answer.",
        },
        e03: {
          title: "A Shared Memory",
          body: "{name} tells the truth of the wordless ledger. Someone chooses to keep this impossible memory with you — the fate is no longer yours to bear alone.",
        },
        e04: {
          title: "Unwritten",
          body: "{name} settles nothing. The letter's last page stays blank — the ledger can record a choice, but it never finishes the road ahead for anyone.",
        },
      },
    },
    error: {
      localStateTitle: "The local register could not be opened",
      localStateBody:
        "The saved page may be damaged or belong to an incompatible story release. Retry first, or discard only this device’s Dream of Jinling data.",
      mediaTitle: "The film could not continue",
      mediaBody:
        "A required scene failed to load. Retry the same authored media before changing your saved identity or story state.",
      retry: "Retry",
      discardLocalState: "Discard local Jinling data",
    },
  },
  "zh-CN": {
    back: "游戏",
    loading: "正在寻找属于你的那一页……",
    resumePlayback: "继续播放",
    meta: {
      title: "金陵入梦 · 无字来客",
      description: "创建原创角色，以第一视角进入红楼世界，让每一次选择写下未曾预言的命运。",
    },
    entry: {
      season: "第一季 · 无字来客",
      chapter: "序章 · 无字命册",
      title: "金陵入梦",
      question: "册中无名，便没有命么？",
      description:
        "创建一个真正属于你的原创人物，进入红楼世界，让每一次选择写下旧命册未曾预言的命运。",
      begin: "写下我的名字",
      continueEyebrow: "你的命页仍未合上",
      continue: "继续 · {name}",
      draftEyebrow: "还有一行没有写完",
      resumeDraft: "继续写完我的命页",
      newPage: "另开一页",
      browsePages: "翻阅命页 · {count}",
      localSave: "角色与进度只保存在当前设备。",
    },
    archive: {
      eyebrow: "已经写下的命页",
      title: "命册记得每一位来客",
      body: "每个身份都保留自己的出身、性情、选择与稳定存档点。",
      close: "合上",
      active: "当前命页",
      updated: "最近落笔 · {date}",
    },
    creation: {
      eyebrow: "未写下的序章",
      ledgerTitle: "无字命册",
      progress: "{current} / {total}",
      asideNote: "命册只记你亲手做出的选择。出身与性情都没有标准答案。",
      steps: {
        name: "姓名",
        origin: "出身",
        trait: "性情",
        confirm: "落印",
      },
      name: {
        eyebrow: "命册第一行",
        title: "是谁，要走进这个故事？",
        body: "这是你自己在红楼世界中的名字，不借用、替代任何一个已经写进原著的人。",
        label: "命册姓名",
        placeholder: "写下名字",
        hint: "限 1–8 个字符。预录对白会用自然称谓与你交谈，不会生硬朗读自由姓名。",
        tooLong: "名字不能超过 8 个字符。",
      },
      origin: {
        eyebrow: "命册第二行",
        title: "你如何被写进这个人间？",
        body: "三种出身都会抵达同一扇府门，但人物会留意你不同的见识、旧物与破绽。",
        options: {
          weave: {
            title: "江宁织造故人之后",
            description: "识得织法、纸张、印章，也看得见府中采买背后的旧事。",
            keepsake: "信物 · 半幅云锦旧样",
          },
          kin: {
            title: "贾府故交晚辈",
            description: "熟悉称呼、座次，也懂得旧交如何不动声色地施加分量。",
            keepsake: "信物 · 故交旧名帖",
          },
          medic: {
            title: "金陵医馆学徒",
            description: "能从呼吸、疲惫与药香里，察觉言语试图藏住的情绪。",
            keepsake: "信物 · 随身药香囊",
          },
        },
      },
      trait: {
        eyebrow: "命册第三行",
        title: "满屋沉默时，你更相信什么？",
        body: "性情解锁不同的行动方法，它不是分数，也不会把其他选择变成错误答案。",
        options: {
          heart: {
            title: "重情",
            description: "保护、安慰，也愿意替旁人承担一时难以独自承受的事。",
          },
          careful: {
            title: "谨慎",
            description: "先观察、能守密，也明白有些边界不能轻易越过。",
          },
          quick: {
            title: "机敏",
            description: "试探真假、识破虚招，在危险将合未合之际临场转圜。",
          },
        },
      },
      confirm: {
        eyebrow: "淡红印落下之前",
        title: "{name}，这是属于你的无字命页",
        body: "一封牵连贾敏旧情的荐书会把这个身份带进荣国府。旧纸、旧署名都是真的，只有那枚淡红封印不可能存在。",
        originLabel: "出身",
        traitLabel: "性情",
        keepsakeLabel: "信物",
        warning: "落印后将从秦淮建立新的本地存档。以后可以另开命页，不会抹去这个身份。",
      },
      cancel: "合上命册",
      back: "返回上一行",
      next: "继续",
      stamp: "落下淡红印",
    },
    stamping: "无字命册正在把你写进人间",
    sealed: {
      eyebrow: "淡红印已经落下",
      title: "{name}，从此在故事之中",
      body: "命册为你的姓名补上了来处、信物与荐书。第一个稳定存档点停在秦淮河畔的一辆马车里。",
      originLabel: "人间来处",
      traitLabel: "命册所记性情",
      enterStory: "进入秦淮",
      returnToLedger: "返回命册",
      saved: "这个身份已经保存在当前设备。",
    },
    story: {
      exit: "暂离故事",
      progress: "第一回 · {current}/{total}",
      choose: "此刻，你会——",
      reactionPlaying: "选择已经落定，后果正在发生……",
      reactionFailed: "后果片段未能载入。你的选择尚未提交，可以安全重试。",
      reactionRetry: "重试后果片段",
      sound: {
        enable: "开启声音",
        disable: "关闭声音",
        resume: "播放影片并开启声音",
      },
      cut: {
        progress: "影片 · {current}/{total}",
        chapters: {
          c1: {
            eyebrow: "第一择 · 府门",
            title: "你要如何证明来处？",
            body: "旧印只替你换来一次开口的机会。你说的话，会比你先传进内院。",
            choices: {
              oldTrust: "如实说明：受故人旧托，持荐书来见老太太",
              daiyuRoad: "借黛玉同行之名，说自己与林家轿队同路",
              keepsake: "只出示随身信物，不再解释荐书来历",
            },
          },
          c2: {
            eyebrow: "第二择 · 游廊风起",
            title: "你先护住什么？",
            body: "风灯、黛玉被挂住的衣袖与滑出的荐书，正在一同逼近火光。",
            choices: {
              protectDaiyu: "不碰她的身体，先替黛玉解开被挂住的衣袖",
              steadyLantern: "先接住沉重的风灯，把火稳下来",
              protectLetter: "先护住荐书与那枚淡红纹印",
            },
          },
          c3: {
            eyebrow: "第三择 · 玉声将落",
            title: "满屋人都会记住这一瞬",
            body: "通灵玉已经脱手。时间只够你做出一个清楚的动作。",
            choices: {
              catchJade: "伸手接住通灵玉，不让它落地",
              shieldDaiyu: "先挡到黛玉与落玉之间",
              callJiamu: "先唤贾母，让她接管眼前的乱局",
              letFall: "不出手，让府中人自己承担这一声玉响",
            },
          },
          c4: {
            eyebrow: "第四择 · 天明以前",
            title: "谁来接住这页未写完的命？",
            body: "荐书的旧情是真的，淡红封印却不可能存在。它落到谁手里，会决定你在红楼的第一个夜晚意味着什么。",
            choices: {
              daiyu: "把荐书托付黛玉，与她共同守住真相",
              xifeng: "交给熙凤，以此换取府中被承认的位置",
              keep: "自己保留荐书，继续追查无字命册",
              burn: "毁掉不可能的封印，不再借任何旧情证明自己",
            },
          },
        },
      },
      scenes: {
        sc01: {
          eyebrow: "SC01 · 秦淮醒来",
          title: "一封不该存在的荐书",
          body: "马车沿秦淮河岸缓缓前行。{name}醒来时，膝上压着一封旧荐书；帘外另一辆轿中，林黛玉也正向荣国府去。",
          choices: {
            signature: "先低头核对荐书的旧署与来历",
            seal: "先察看荐书上淡红得异常的纹印",
            curtain: "先望向轿帘后沉默的林黛玉",
          },
        },
        sc02: {
          eyebrow: "SC02 · 荣府门前",
          title: "门上的人只认来处",
          body: "黛玉的名帖已经递入。门上转向你，问荐书从何而来。借她的名义最省事，也最容易留下日后的破绽。",
          choices: {
            honest: "如实说明自己的出身，请门上单独通报",
            borrow: "借黛玉同行之名，让两份名帖一同送入",
          },
        },
        sc03: {
          eyebrow: "SC03 · 游廊风灯",
          title: "风先吹向了她",
          body: "穿堂风骤起，风灯撞向栏杆，黛玉的衣袖与荐书同时被卷向火光。你只能先护住一样。",
          choices: {
            daiyu: "先替黛玉解开被灯钩挂住的衣袖",
            letter: "先按住荐书，不让淡红纹印碰到火",
          },
        },
        sc04: {
          eyebrow: "SC04 · 贾母相见",
          title: "满堂哭声里，多了一个无名之人",
          body: "贾母抱住黛玉，旧情一时压过满堂规矩。你站在亲疏之外，却看见她在泪光中向你投来一眼。",
          choices: {
            bow: "依礼退后，让祖孙先把旧情说完",
            observe: "留心屋中谁最先注意到那封荐书",
          },
        },
        sc05: {
          eyebrow: "SC05 · 熙凤验客",
          title: "她笑着，把日期说错了一天",
          body: "王熙凤把你带进侧厅，像闲谈般问起荐书旧事，却故意说错落款日期。她在等你顺着她的话露出破绽。",
          choices: {
            expose: "当面指出日期不对，反问她为何试探",
            handOver: "把荐书交给她验看，暂时不争主动",
          },
        },
        sc06: {
          eyebrow: "SC06 · 王夫人的边界",
          title: "府里已经替你选好了位置",
          body: "王夫人的话很客气：外院清静，也合规矩。另一处住处离黛玉近，却会让你更深地卷进府中目光。",
          choices: {
            outer: "接受外院安置，先守住自己的边界",
            nearDaiyu: "请求住得离黛玉近些，方便彼此照应",
          },
        },
        sc07: {
          eyebrow: "SC07 · 似曾相识",
          title: "宝玉问：你从哪一册里来？",
          body: "换过家常衣裳的宝玉再次进厅。他看过黛玉，又看向你，像真的在梦里见过这一页。",
          choices: {
            outsideLedger: "告诉他：我不在任何已经写成的册中",
            guest: "只说自己是暂住之客，把话题让回黛玉",
          },
        },
        sc08: {
          eyebrow: "SC08 · 玉声骤起",
          title: "通灵玉脱手的一瞬",
          body: "宝玉情绪骤变，通灵玉从掌中飞出。黛玉就在落点旁，而你离玉更近——这一瞬会被满屋人记住。",
          choices: {
            catch: "伸手接住通灵玉，承受可能的割伤",
            shield: "先护住黛玉，让玉落到地上",
          },
        },
        sc09: {
          eyebrow: "SC09 · 同为客",
          title: "夜里，黛玉来问那枚淡红印",
          body: "灯影将尽时，黛玉独自来找你。她已经看出荐书的纸是真的，印却不属于这个人间。",
          choices: {
            truth: "告诉她无字命册与醒来时发生的一切",
            promise: "暂时保密，只承诺不会让荐书伤到她",
          },
        },
        sc10: {
          eyebrow: "SC10 · 谁来写命",
          title: "荐书的最后一页仍是空白",
          body: "府中灯火渐熄。你终于明白：荐书不是要证明你是谁，而是在逼你选择让谁来书写往后的命。",
          choices: {
            daiyu: "把荐书交给黛玉，与她共同保守真相",
            xifeng: "把荐书交给熙凤，换取府中的位置",
            keep: "自己保留荐书，追查无字命册",
            burn: "烧掉荐书，拒绝被任何命册定义",
          },
        },
      },
      ending: {
        eyebrow: "第一回终",
        path: "本次命页记录了 {count} 次选择。进度已保存在当前设备。",
        restart: "重写这一回",
        exit: "返回命册",
      },
      endings: {
        e01: {
          title: "同是天涯客",
          body: "{name}把荐书交到黛玉手中。两个本不该相识的异乡人，从此共同守着一页没有写完的命。",
        },
        e02: {
          title: "府中有位",
          body: "熙凤收起荐书，也替{name}在府里留下一席之地。位置是真的，代价要等往后的日子慢慢显现。",
        },
        e03: {
          title: "空白命册",
          body: "{name}保留荐书，终于看见淡红纹印下浮出新的空白页：命册能记录选择，却不能替人作出选择。",
        },
        e04: {
          title: "一夜还乡",
          body: "火焰吞没荐书，秦淮的水声再次涌来。{name}离开荣府，却保住了不被任何旧命书写的自己。",
        },
        e05: {
          title: "玉声断梦",
          body: "选择与信任没有来得及接住彼此。玉声落下，{name}在众人的注视中被推回那页尚未写稳的梦。",
        },
      },
    },
    storyV2: {
      exit: "暂离故事",
      loading: "影片加载中……",
      rotate: {
        title: "请横屏观看",
        hint: "将手机旋转到横屏，获得完整的电影画面。",
      },
      choose: "此刻，你会——",
      reactionPlaying: "选择已经落定，后果正在发生……",
      reactionFailed: "后果片段未能载入。你的选择尚未提交，可以安全重试。",
      reactionRetry: "重试后果片段",
      sound: {
        enable: "开启声音",
        disable: "关闭声音",
        resume: "播放影片并开启声音",
      },
      cut: {
        progress: "影片 · {current}/{total}",
        chapters: {
          c1: {
            eyebrow: "第一择 · 荣府门前",
            title: "你拿什么证明自己的来处？",
            body: "门房收下了荐书，却仍在等一件能作数的凭据。你递出的东西，会先你一步传进内院。",
            choices: {
              brocade: "出示江宁织造的旧云锦残片",
              oldSeal: "出示故交私印，请门房比对印面",
              medicinePouch: "出示随身药囊与那张旧方笺",
            },
          },
          c2: {
            eyebrow: "第二择 · 游廊风灯",
            title: "风先扑向了她",
            body: "穿堂风骤起，风灯歪向栏杆；黛玉的衣袖被灯钩挂住，你袖中的荐书也正滑出。你只来得及先护住一样。",
            choices: {
              protectDaiyu: "不触她的身体，先替黛玉解开被挂住的衣袖",
              steadyLantern: "先稳住那盏沉重的风灯，把火压下来",
              protectLetter: "先护住荐书与那枚淡红封印",
            },
          },
          c3: {
            eyebrow: "第三择 · 玉声将落",
            title: "满堂人都会记住这一瞬",
            body: "宝玉问黛玉可有玉，话音未落便连玉带绦一并摘下、掷向砖地。时间只够你做一个清楚的动作。",
            choices: {
              catchJade: "俯身接住那块坠落的通灵玉",
              shieldDaiyu: "先挡到黛玉与落玉之间",
              callHousehold: "扬声唤众人，让府里人接管这一乱",
              observePattern: "不出手，只盯住玉与荐书上那道淡红纹",
            },
          },
          c4: {
            eyebrow: "第四择 · 天明以前",
            title: "这页未写完的命，交到谁手里？",
            body: "夜里黛玉独自来访，荐书的淡红痕在灯下浮起，却始终不成一个字。它落在谁那里，会决定你在荣府的第一夜意味着什么。",
            choices: {
              spring: "与黛玉相约海棠廊下，把这一春过完再说",
              name: "请府中为你立一张名帖，正正经经留下来",
              memory: "把无字命册与醒来时的一切，如实说与她听",
              unwritten: "什么都不定下，让往后的命仍是空白的一页",
            },
          },
        },
      },
      ending: {
        eyebrow: "第一回终",
        path: "本次命页记录了 {count} 次选择。进度已保存在当前设备。",
        restart: "重写这一回",
        exit: "返回命册",
      },
      endings: {
        e01: {
          title: "共春",
          body: "{name}与黛玉相约海棠廊下。两个本不相识的异乡人，先把眼前这一春认认真真地过完。",
        },
        e02: {
          title: "立名",
          body: "荣府为{name}立了一张名帖。位置是真的，往后要如何担起这个名字，得由日子慢慢作答。",
        },
        e03: {
          title: "共忆",
          body: "{name}把无字命册的秘密如实相告。有人愿与你共守这段不该存在的记忆，命便不再只由一个人扛。",
        },
        e04: {
          title: "未写",
          body: "{name}什么都没有定下。荐书的最后一页仍旧空白——命册能记录选择，却始终没能替人写完往后的路。",
        },
      },
    },
    error: {
      localStateTitle: "无法打开本地命册",
      localStateBody:
        "存档可能已经损坏，或属于不兼容的剧情版本。请先重试；也可以只清除当前设备上的《金陵入梦》数据。",
      mediaTitle: "影片无法继续播放",
      mediaBody:
        "必需的剧情镜头加载失败。请重试同一份正式素材；你的角色存档与剧情状态不会因此改变。",
      retry: "重试",
      discardLocalState: "清除本地金陵数据",
    },
  },
  "zh-HK": {
    back: "遊戲",
    loading: "正在尋找屬於你的那一頁……",
    resumePlayback: "繼續播放",
    meta: {
      title: "金陵入夢 · 無字來客",
      description: "建立原創角色，以第一視角進入紅樓世界，讓每一次選擇寫下未曾預言的命運。",
    },
    entry: {
      season: "第一季 · 無字來客",
      chapter: "序章 · 無字命冊",
      title: "金陵入夢",
      question: "冊中無名，便沒有命麼？",
      description:
        "建立一個真正屬於你的原創人物，進入紅樓世界，讓每一次選擇寫下舊命冊未曾預言的命運。",
      begin: "寫下我的名字",
      continueEyebrow: "你的命頁仍未合上",
      continue: "繼續 · {name}",
      draftEyebrow: "還有一行沒有寫完",
      resumeDraft: "繼續寫完我的命頁",
      newPage: "另開一頁",
      browsePages: "翻閱命頁 · {count}",
      localSave: "角色與進度只保存在目前裝置。",
    },
    archive: {
      eyebrow: "已經寫下的命頁",
      title: "命冊記得每一位來客",
      body: "每個身份都保留自己的出身、性情、選擇與穩定存檔點。",
      close: "合上",
      active: "目前命頁",
      updated: "最近落筆 · {date}",
    },
    creation: {
      eyebrow: "未寫下的序章",
      ledgerTitle: "無字命冊",
      progress: "{current} / {total}",
      asideNote: "命冊只記你親手作出的選擇。出身與性情都沒有標準答案。",
      steps: {
        name: "姓名",
        origin: "出身",
        trait: "性情",
        confirm: "落印",
      },
      name: {
        eyebrow: "命冊第一行",
        title: "是誰，要走進這個故事？",
        body: "這是你自己在紅樓世界中的名字，不借用、取代任何一個已經寫進原著的人。",
        label: "命冊姓名",
        placeholder: "寫下名字",
        hint: "限 1–8 個字元。預錄對白會用自然稱謂與你交談，不會生硬朗讀自由姓名。",
        tooLong: "名字不能超過 8 個字元。",
      },
      origin: {
        eyebrow: "命冊第二行",
        title: "你如何被寫進這個人間？",
        body: "三種出身都會抵達同一扇府門，但人物會留意你不同的見識、舊物與破綻。",
        options: {
          weave: {
            title: "江寧織造故人之後",
            description: "識得織法、紙張、印章，也看得見府中採買背後的舊事。",
            keepsake: "信物 · 半幅雲錦舊樣",
          },
          kin: {
            title: "賈府故交晚輩",
            description: "熟悉稱呼、座次，也懂得舊交如何不動聲色地施加分量。",
            keepsake: "信物 · 故交舊名帖",
          },
          medic: {
            title: "金陵醫館學徒",
            description: "能從呼吸、疲憊與藥香裏，察覺言語試圖藏住的情緒。",
            keepsake: "信物 · 隨身藥香囊",
          },
        },
      },
      trait: {
        eyebrow: "命冊第三行",
        title: "滿屋沉默時，你更相信甚麼？",
        body: "性情解鎖不同的行動方法，它不是分數，也不會把其他選擇變成錯誤答案。",
        options: {
          heart: {
            title: "重情",
            description: "保護、安慰，也願意替旁人承擔一時難以獨自承受的事。",
          },
          careful: {
            title: "謹慎",
            description: "先觀察、能守密，也明白有些邊界不能輕易越過。",
          },
          quick: {
            title: "機敏",
            description: "試探真假、識破虛招，在危險將合未合之際臨場轉圜。",
          },
        },
      },
      confirm: {
        eyebrow: "淡紅印落下之前",
        title: "{name}，這是屬於你的無字命頁",
        body: "一封牽連賈敏舊情的薦書會把這個身份帶進榮國府。舊紙、舊署名都是真的，只有那枚淡紅封印不可能存在。",
        originLabel: "出身",
        traitLabel: "性情",
        keepsakeLabel: "信物",
        warning: "落印後將從秦淮建立新的本地存檔。以後可以另開命頁，不會抹去這個身份。",
      },
      cancel: "合上命冊",
      back: "返回上一行",
      next: "繼續",
      stamp: "落下淡紅印",
    },
    stamping: "無字命冊正在把你寫進人間",
    sealed: {
      eyebrow: "淡紅印已經落下",
      title: "{name}，從此在故事之中",
      body: "命冊為你的姓名補上了來處、信物與薦書。第一個穩定存檔點停在秦淮河畔的一輛馬車裏。",
      originLabel: "人間來處",
      traitLabel: "命冊所記性情",
      enterStory: "進入秦淮",
      returnToLedger: "返回命冊",
      saved: "這個身份已經保存在目前裝置。",
    },
    story: {
      exit: "暫離故事",
      progress: "第一回 · {current}/{total}",
      choose: "此刻，你會——",
      reactionPlaying: "選擇已經落定，後果正在發生……",
      reactionFailed: "後果片段未能載入。你的選擇尚未提交，可以安全重試。",
      reactionRetry: "重試後果片段",
      sound: {
        enable: "開啟聲音",
        disable: "關閉聲音",
        resume: "播放影片並開啟聲音",
      },
      cut: {
        progress: "影片 · {current}/{total}",
        chapters: {
          c1: {
            eyebrow: "第一擇 · 府門",
            title: "你要如何證明來處？",
            body: "舊印只替你換來一次開口的機會。你說的話，會比你先傳進內院。",
            choices: {
              oldTrust: "如實說明：受故人舊託，持薦書來見老太太",
              daiyuRoad: "借黛玉同行之名，說自己與林家轎隊同路",
              keepsake: "只出示隨身信物，不再解釋薦書來歷",
            },
          },
          c2: {
            eyebrow: "第二擇 · 遊廊風起",
            title: "你先護住甚麼？",
            body: "風燈、黛玉被掛住的衣袖與滑出的薦書，正在一同逼近火光。",
            choices: {
              protectDaiyu: "不碰她的身體，先替黛玉解開被掛住的衣袖",
              steadyLantern: "先接住沉重的風燈，把火穩下來",
              protectLetter: "先護住薦書與那枚淡紅紋印",
            },
          },
          c3: {
            eyebrow: "第三擇 · 玉聲將落",
            title: "滿屋人都會記住這一瞬",
            body: "通靈玉已經脫手。時間只夠你做出一個清楚的動作。",
            choices: {
              catchJade: "伸手接住通靈玉，不讓它落地",
              shieldDaiyu: "先擋到黛玉與落玉之間",
              callJiamu: "先喚賈母，讓她接管眼前的亂局",
              letFall: "不出手，讓府中人自己承擔這一聲玉響",
            },
          },
          c4: {
            eyebrow: "第四擇 · 天明以前",
            title: "誰來接住這頁未寫完的命？",
            body: "薦書的舊情是真的，淡紅封印卻不可能存在。它落到誰手裏，會決定你在紅樓的第一個夜晚意味著甚麼。",
            choices: {
              daiyu: "把薦書託付黛玉，與她共同守住真相",
              xifeng: "交給熙鳳，以此換取府中被承認的位置",
              keep: "自己保留薦書，繼續追查無字命冊",
              burn: "毀掉不可能的封印，不再借任何舊情證明自己",
            },
          },
        },
      },
      scenes: {
        sc01: {
          eyebrow: "SC01 · 秦淮醒來",
          title: "一封不該存在的薦書",
          body: "馬車沿秦淮河岸緩緩前行。{name}醒來時，膝上壓着一封舊薦書；簾外另一輛轎中，林黛玉也正向榮國府去。",
          choices: {
            signature: "先低頭核對薦書的舊署與來歷",
            seal: "先察看薦書上淡紅得異常的紋印",
            curtain: "先望向轎簾後沉默的林黛玉",
          },
        },
        sc02: {
          eyebrow: "SC02 · 榮府門前",
          title: "門上的人只認來處",
          body: "黛玉的名帖已經遞入。門上轉向你，問薦書從何而來。借她的名義最省事，也最容易留下日後的破綻。",
          choices: {
            honest: "如實說明自己的出身，請門上單獨通報",
            borrow: "借黛玉同行之名，讓兩份名帖一同送入",
          },
        },
        sc03: {
          eyebrow: "SC03 · 遊廊風燈",
          title: "風先吹向了她",
          body: "穿堂風驟起，風燈撞向欄杆，黛玉的衣袖與薦書同時被捲向火光。你只能先護住一樣。",
          choices: {
            daiyu: "先替黛玉解開被燈鈎掛住的衣袖",
            letter: "先按住薦書，不讓淡紅紋印碰到火",
          },
        },
        sc04: {
          eyebrow: "SC04 · 賈母相見",
          title: "滿堂哭聲裏，多了一個無名之人",
          body: "賈母抱住黛玉，舊情一時壓過滿堂規矩。你站在親疏之外，卻看見她在淚光中向你投來一眼。",
          choices: {
            bow: "依禮退後，讓祖孫先把舊情說完",
            observe: "留心屋中誰最先注意到那封薦書",
          },
        },
        sc05: {
          eyebrow: "SC05 · 熙鳳驗客",
          title: "她笑着，把日期說錯了一天",
          body: "王熙鳳把你帶進側廳，像閒談般問起薦書舊事，卻故意說錯落款日期。她在等你順着她的話露出破綻。",
          choices: {
            expose: "當面指出日期不對，反問她為何試探",
            handOver: "把薦書交給她驗看，暫時不爭主動",
          },
        },
        sc06: {
          eyebrow: "SC06 · 王夫人的邊界",
          title: "府裏已經替你選好了位置",
          body: "王夫人的話很客氣：外院清靜，也合規矩。另一處住處離黛玉近，卻會讓你更深地捲進府中目光。",
          choices: {
            outer: "接受外院安置，先守住自己的邊界",
            nearDaiyu: "請求住得離黛玉近些，方便彼此照應",
          },
        },
        sc07: {
          eyebrow: "SC07 · 似曾相識",
          title: "寶玉問：你從哪一冊裏來？",
          body: "換過家常衣裳的寶玉再次進廳。他看過黛玉，又看向你，像真的在夢裏見過這一頁。",
          choices: {
            outsideLedger: "告訴他：我不在任何已經寫成的冊中",
            guest: "只說自己是暫住之客，把話題讓回黛玉",
          },
        },
        sc08: {
          eyebrow: "SC08 · 玉聲驟起",
          title: "通靈玉脫手的一瞬",
          body: "寶玉情緒驟變，通靈玉從掌中飛出。黛玉就在落點旁，而你離玉更近——這一瞬會被滿屋人記住。",
          choices: {
            catch: "伸手接住通靈玉，承受可能的割傷",
            shield: "先護住黛玉，讓玉落到地上",
          },
        },
        sc09: {
          eyebrow: "SC09 · 同為客",
          title: "夜裏，黛玉來問那枚淡紅印",
          body: "燈影將盡時，黛玉獨自來找你。她已經看出薦書的紙是真的，印卻不屬於這個人間。",
          choices: {
            truth: "告訴她無字命冊與醒來時發生的一切",
            promise: "暫時保密，只承諾不會讓薦書傷到她",
          },
        },
        sc10: {
          eyebrow: "SC10 · 誰來寫命",
          title: "薦書的最後一頁仍是空白",
          body: "府中燈火漸熄。你終於明白：薦書不是要證明你是誰，而是在逼你選擇讓誰來書寫往後的命。",
          choices: {
            daiyu: "把薦書交給黛玉，與她共同保守真相",
            xifeng: "把薦書交給熙鳳，換取府中的位置",
            keep: "自己保留薦書，追查無字命冊",
            burn: "燒掉薦書，拒絕被任何命冊定義",
          },
        },
      },
      ending: {
        eyebrow: "第一回終",
        path: "本次命頁記錄了 {count} 次選擇。進度已保存在目前裝置。",
        restart: "重寫這一回",
        exit: "返回命冊",
      },
      endings: {
        e01: {
          title: "同是天涯客",
          body: "{name}把薦書交到黛玉手中。兩個本不該相識的異鄉人，從此共同守着一頁沒有寫完的命。",
        },
        e02: {
          title: "府中有位",
          body: "熙鳳收起薦書，也替{name}在府裏留下一席之地。位置是真的，代價要等往後的日子慢慢顯現。",
        },
        e03: {
          title: "空白命冊",
          body: "{name}保留薦書，終於看見淡紅紋印下浮出新的空白頁：命冊能記錄選擇，卻不能替人作出選擇。",
        },
        e04: {
          title: "一夜還鄉",
          body: "火焰吞沒薦書，秦淮的水聲再次湧來。{name}離開榮府，卻保住了不被任何舊命書寫的自己。",
        },
        e05: {
          title: "玉聲斷夢",
          body: "選擇與信任沒有來得及接住彼此。玉聲落下，{name}在眾人的注視中被推回那頁尚未寫穩的夢。",
        },
      },
    },
    storyV2: {
      exit: "暫離故事",
      loading: "影片載入中……",
      rotate: {
        title: "請橫向觀看",
        hint: "將手機旋轉至橫向，體驗完整的電影畫面。",
      },
      choose: "此刻，你會——",
      reactionPlaying: "選擇已經落定，後果正在發生……",
      reactionFailed: "後果片段未能載入。你的選擇尚未提交，可以安全重試。",
      reactionRetry: "重試後果片段",
      sound: {
        enable: "開啟聲音",
        disable: "關閉聲音",
        resume: "播放影片並開啟聲音",
      },
      cut: {
        progress: "影片 · {current}/{total}",
        chapters: {
          c1: {
            eyebrow: "第一擇 · 榮府門前",
            title: "你拿甚麼證明自己的來處？",
            body: "門房收下了薦書，卻仍在等一件能作數的憑據。你遞出的東西，會先你一步傳進內院。",
            choices: {
              brocade: "出示江寧織造的舊雲錦殘片",
              oldSeal: "出示故交私印，請門房比對印面",
              medicinePouch: "出示隨身藥囊與那張舊方箋",
            },
          },
          c2: {
            eyebrow: "第二擇 · 遊廊風燈",
            title: "風先撲向了她",
            body: "穿堂風驟起，風燈歪向欄杆；黛玉的衣袖被燈鈎掛住，你袖中的薦書也正滑出。你只來得及先護住一樣。",
            choices: {
              protectDaiyu: "不觸她的身體，先替黛玉解開被掛住的衣袖",
              steadyLantern: "先穩住那盞沉重的風燈，把火壓下來",
              protectLetter: "先護住薦書與那枚淡紅封印",
            },
          },
          c3: {
            eyebrow: "第三擇 · 玉聲將落",
            title: "滿堂人都會記住這一瞬",
            body: "寶玉問黛玉可有玉，話音未落便連玉帶絛一併摘下、擲向磚地。時間只夠你做一個清楚的動作。",
            choices: {
              catchJade: "俯身接住那塊墜落的通靈玉",
              shieldDaiyu: "先擋到黛玉與落玉之間",
              callHousehold: "揚聲喚眾人，讓府裏人接管這一亂",
              observePattern: "不出手，只盯住玉與薦書上那道淡紅紋",
            },
          },
          c4: {
            eyebrow: "第四擇 · 天明以前",
            title: "這頁未寫完的命，交到誰手裏？",
            body: "夜裏黛玉獨自來訪，薦書的淡紅痕在燈下浮起，卻始終不成一個字。它落在誰那裏，會決定你在榮府的第一夜意味著甚麼。",
            choices: {
              spring: "與黛玉相約海棠廊下，把這一春過完再說",
              name: "請府中為你立一張名帖，正正經經留下來",
              memory: "把無字命冊與醒來時的一切，如實說與她聽",
              unwritten: "甚麼都不定下，讓往後的命仍是空白的一頁",
            },
          },
        },
      },
      ending: {
        eyebrow: "第一回終",
        path: "本次命頁記錄了 {count} 次選擇。進度已保存在當前裝置。",
        restart: "重寫這一回",
        exit: "返回命冊",
      },
      endings: {
        e01: {
          title: "共春",
          body: "{name}與黛玉相約海棠廊下。兩個本不相識的異鄉人，先把眼前這一春認認真真地過完。",
        },
        e02: {
          title: "立名",
          body: "榮府為{name}立了一張名帖。位置是真的，往後要如何擔起這個名字，得由日子慢慢作答。",
        },
        e03: {
          title: "共憶",
          body: "{name}把無字命冊的秘密如實相告。有人願與你共守這段不該存在的記憶，命便不再只由一個人扛。",
        },
        e04: {
          title: "未寫",
          body: "{name}甚麼都沒有定下。薦書的最後一頁仍舊空白——命冊能記錄選擇，卻始終沒能替人寫完往後的路。",
        },
      },
    },
    error: {
      localStateTitle: "無法打開本地命冊",
      localStateBody:
        "存檔可能已經損壞，或屬於不相容的劇情版本。請先重試；也可以只清除目前裝置上的《金陵入夢》資料。",
      mediaTitle: "影片無法繼續播放",
      mediaBody:
        "必需的劇情鏡頭載入失敗。請重試同一份正式素材；你的角色存檔與劇情狀態不會因此改變。",
      retry: "重試",
      discardLocalState: "清除本地金陵資料",
    },
  },
} as const;
