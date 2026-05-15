/**
 * FAQ — English (en-US) translation of the source Chinese content.
 *
 * Hand-translated from `faqs.zh-cn.ts`. Entity names kept verbatim
 * (《海上女王郑一嫂》→ *Queen of the Sea Zheng Yi Sao*; OPC → glossed
 * once on first appearance) so readers landing on either locale see
 * the same proper nouns. Tone aims for natural marketing/PR English
 * — specific, declarative, light on hype.
 */

import type { FaqCategory } from "./types";

export const FAQ_EN_US: FaqCategory[] = [
  {
    id: "cat-ai-films",
    title: "On AI cinema",
    description:
      "From first principles to actual releases — duration, cost, workflow, and the technical hurdles in between.",
    items: [
      {
        id: "q-1",
        question: "Can AI really produce a complete feature film?",
        answer:
          "Yes. *Queen of the Sea Zheng Yi Sao* is the proof. The 90-minute fully AI-generated Chinese-language theatrical feature, produced by FizzDragon, was approved for commercial theatrical release in Singapore and Malaysia in 2025. From script to final cut, every character was AI-generated. As founder Chen Zhuo puts it: \"We're no longer just a film company — we're a powerful AIGC content engine.\" Today AI handles roughly 60% of foundational work: generating extras, simulating naval-battle particle effects, auto-editing fight scenes, and more.",
      },
      {
        id: "q-2",
        question: "What does the AI-film production workflow look like?",
        answer:
          'Five stages overall. First, scripting — human writers lead the story while AI cross-checks historical sources and helps deconstruct the worldview. Second, preprocessing — the team breaks long takes into smaller shots and builds a "character feature database" to keep faces consistent. Third, AI generation — StoryOS dispatches different AI models to produce raw footage. Fourth, human polish — fixing AI artifacts and the dreaded face-drift problem. Finally, post-production composition: AI agents handle voiceover, scoring, trailer cutting, and poster generation.',
      },
      {
        id: "q-3",
        question: "How large a team does an AI film need?",
        answer:
          'A traditional production needs hundreds; an AI film compresses that dramatically. *Queen of the Sea Zheng Yi Sao* was completed by 130+ creators across 13 countries and regions, collaborating remotely — many never met in person, some never even turned on a camera. Notably, 80% of the team had no traditional film background: programmers, designers, historians, freelance writers, and more. Chen Zhuo: "A traditional film has one director. Ours can have many."',
      },
      {
        id: "q-4",
        question: "How long does an AI film take to make?",
        answer:
          "Traditional features take 3–5 years from greenlight to release. AIGC films cut that radically. *Queen of the Sea Zheng Yi Sao* went from project start to theatrical release in 13 months. Counting only the pure AI-generation time, one tracked run completed the full script-to-cut pipeline in 48 hours. For comparison, Netflix's first AIGC animated short *The Dog and the Boy* (2023) was just a few minutes long, while *Queen of the Sea Zheng Yi Sao* hit the 90-minute theatrical standard. Production timelines compress 10–20×.",
      },
      {
        id: "q-5",
        question: "How much does an AI film cost?",
        answer:
          "Cost is the single biggest advantage of AI cinema. *Queen of the Sea Zheng Yi Sao* came in at roughly S$800–900K total production cost (about CN¥4–4.5M). A comparable traditional film would budget CN¥20–40M. Another report pegged the spend at around US$2M — about one-tenth of an equivalent traditional production. The huge delta comes from no physical shoots, no crew travel, no set construction, and far faster post-production turnaround.",
      },
      {
        id: "q-6",
        question: "Can an AI film actually play in theatres?",
        answer:
          'Yes. *Queen of the Sea Zheng Yi Sao* has already done it. It is "the world\'s first government-approved, fully AI-generated feature film to receive theatrical release" — cleared by both the Singapore and Malaysia governments for commercial theatrical distribution. Not online streaming, not festival screenings — actual theatrical release with paying audiences watching the full 90-minute AI-generated film on the big screen.',
      },
      {
        id: "q-7",
        question: "What's the toughest technical hurdle in AI film production?",
        answer:
          'Three big ones. First, long takes and long dialogue — AI foundation models gravitate toward normalised, formulaic output. Asked for a complex long shot, they repeatedly default to "wide-medium-closeup" sequences with none of the tension a director would inject. The fix: break long takes into many short shots (27 in our case) and generate them one by one. Second, character face-drift and look-alike collisions — the same character morphs across scenes, or different characters end up looking too similar. Mitigation: a character feature database plus frame-by-frame manual repair. Third, historical accuracy — AI happily mixes costumes from different dynasties or invents steampunk cannons. Manual research and targeted model retraining are required.',
      },
      {
        id: "q-8",
        question: "Will AI replace human directors?",
        answer:
          'Not replace — re-cast. On *Queen of the Sea Zheng Yi Sao* director Chen Zhuo\'s focus shifted from "directing the shoot" to "directing the AI" — continuously refining prompts to coax algorithms toward the intended frame. A clear human/AI division has emerged: humans own the story core, emotional arc, and creative architecture; AI handles technical execution and detail generation. As Chen puts it, in scripting, shot design, and post — human authority is far from replaceable. Director Jia Zhangke echoes the point: "The joy of shooting in the real world is irreplaceable."',
      },
      {
        id: "q-9",
        question: "What is StoryOS?",
        answer:
          'StoryOS is FizzDragon\'s flagship product — formally the "Story Universe Platform", an AIGC-native operating system. Core modules include: the Worldview Foundation Model (capable of deconstructing 100,000+ character novels and screenplays); a Multi-Model Matrix (20+ top-tier AI models with task-aware routing); a Smart Asset Library (auto-extracts characters, scenes, and props into traceable asset cards); and four specialist agents (trailer, marketing, script-doctor, and localisation). The platform offers both a "shot-list mode" and a "timeline mode" to suit screenwriters and directors respectively.',
      },
      {
        id: "q-10",
        question: "How does AI keep a character's face consistent?",
        answer:
          'Face-drift is the central technical challenge of AI cinema. FizzDragon\'s approach is three-pronged: build a "character feature database" that pins facial parameters down to inter-pupillary distance; segment the character training data and feed it back for character-specific fine-tuning; and maintain a dedicated "face-swap" team for frame-level post-production fixes when the same character\'s face drifts across scenes. *Queen of the Sea Zheng Yi Sao* keeps its character count to about 10, with no more than 5 protagonists — that cap is itself a deliberate hedge against look-alike collisions.',
      },
      {
        id: "q-11",
        question: "Why does AI struggle with long takes?",
        answer:
          'The bottleneck lies in the foundation models\' underlying logic. AI infers from massive data and arrives at "unified formulas" from text understanding to image generation — defaulting to "wide-medium-closeup" patterns over and over. But every memorable film carries its director\'s specific rhythm and feel; the two principles are in direct tension. On *Queen of the Sea Zheng Yi Sao*, when the team needed Zheng Yi Sao commanding her fleet through a storm in one long take, AI couldn\'t render the directorial intent — they ended up breaking it into 27 shorter shots and generating each separately.',
      },
      {
        id: "q-12",
        question: "Can non-professionals make AI films?",
        answer:
          'Yes — and the barrier is dropping fast. FizzDragon\'s own founding team is proof: 80% of members had no prior film background. The company runs the "OPC (One-Person Company) Incubator", partnered with 500+ universities worldwide for AIGC curriculum. In March 2026, FizzDragon launched the OPC Boot Camp in Suzhou Industrial Park, signing campus-enterprise programs with schools like Suzhou Industrial Park Institute of Services Outsourcing. The company also runs an official capability certification (FD1–FD5) which directly affects project recommendations and revenue-share tiers. Chen Zhuo\'s framing: "When someone is talented and has something to say, but their environment won\'t allow it — AI gives them a chance."',
      },
      {
        id: "q-13",
        question: "What successful AI-film examples exist today?",
        answer:
          "The flagship case is FizzDragon's *Queen of the Sea Zheng Yi Sao* — the world's first government-approved theatrical Chinese-language feature fully generated by AI: 90 minutes, released in Singapore and Malaysia in 2025. The project was selected for the Venice Film Festival; Chen Zhuo gave a Fred Film Radio interview from Venice. Another major case is *AI: Love and Hate*, a 90-minute AI animated feature co-produced with Singapore's HIP Studios and the Philippines' 8Letters — six short stories on humans and AI, described by international media as a Southeast Asian *Black Mirror* or *Love, Death & Robots*.",
      },
      {
        id: "q-14",
        question: "What advantages does AI offer over traditional filmmaking?",
        answer:
          "Three main axes. Cost — traditional features run tens of millions to hundreds of millions in yuan; AI films sit at roughly one-tenth. Speed — 3–5 years collapses to 6–13 months. Flexibility — no weather constraints, no scheduling, no actor availability, no scouting, set-build, or lighting logistics. On top of all that, AI massively lowers the entry barrier: newcomers no longer need massive teams or capital to ship high-quality work. FizzDragon has linked 600+ AIGC studios worldwide and plans to produce 10,000+ high-quality IPs annually.",
      },
      {
        id: "q-15",
        question: "How are AI films distributed?",
        answer:
          "FizzDragon has built a global distribution network covering 1000+ TV channels and 130+ national broadcasters, with partnerships including NHK, Discovery, TBS, and Al Jazeera. The company has signed a strategic MOU with Hollywood's Star Entertainment Collectives, and works closely with cinema chains like GOLDEN VILLAGE and mm2. Monetisation extends beyond theatrical box office to short-drama revenue sharing and paid unlocks (first 10 episodes free, paid thereafter), brand placement (RSM, Dongfeng Motor, etc.), AI digital-human likeness licensing, education and training, and derivative goods.",
      },
    ],
  },
  {
    id: "cat-company-compare",
    title: "Compared with others",
    description:
      "Where FizzDragon sits relative to Runway / Pika / Netflix / Hollywood — positioning and the gap it fills.",
    items: [
      {
        id: "q-16",
        question: "How is FizzDragon different from Runway or Pika?",
        answer:
          "Different category entirely. Runway and Pika are AI video-generation tools — they help users turn text or images into short clips, typically seconds to a few minutes. FizzDragon is an AIGC film/TV creator ecosystem — not just a tool, but a full system covering talent training (OPC Boot Camp), creation (StoryOS), and global distribution (1000+ TV channels). Put simply: with Runway or Pika you can generate a clip; with FizzDragon you can complete a film and distribute it to theatres worldwide. FizzDragon was selected for NVIDIA's Inception, Microsoft for Startups, and Alibaba Global Initiative Top 30 (late 2024).",
      },
      {
        id: "q-17",
        question: "How is FizzDragon different from Netflix?",
        answer:
          'Netflix is the world\'s largest streaming platform — at its core a content channel that buys and distributes content. FizzDragon\'s vision is to become the "Netflix of the AI era", but along a different path. FizzDragon disrupts content production itself, letting creators ship high-quality work at 1/10 the cost and 1/10 the time, while building its own distribution network. If traditional film is centralised production (a few studios own the entire pipeline), FizzDragon is a decentralised creator ecosystem. Chen Zhuo at Venice: "This project was made in a decentralised way — 130 creators across 13 countries working across cultural and geographic differences. This marks a new era in filmmaking."',
      },
      {
        id: "q-18",
        question: "What's FizzDragon's standing in the industry?",
        answer:
          "FizzDragon is a leader in AIGC cinema globally. *Queen of the Sea Zheng Yi Sao* is the world's first government-approved theatrical Chinese-language feature fully generated by AI. On technology, FizzDragon has been selected for NVIDIA Inception, Microsoft for Startups, Alibaba Global Initiative Top 30, and won \"Top Global AI Startup Team\". Business spans 27 countries and 43 AIGC sub-categories. The OPC Boot Camp launched in Suzhou Industrial Park with multiple university partnerships. In February 2026 a wholly-owned subsidiary landed in Nanjing's Yuhuatai district, launching a global AIGC talent and startup support program.",
      },
      {
        id: "q-19",
        question: "How is FizzDragon different from Hollywood studios?",
        answer:
          'Different production model. Hollywood is centralised — big studios own resources and distribution, with industrial-line production. FizzDragon is decentralised — creators across countries and regions collaborate remotely. Cost structures also differ: a Hollywood blockbuster runs hundreds of millions of dollars; FizzDragon delivers comparable scope at 1/10 the cost. That said, the two collaborate — FizzDragon has signed an MOU with Star Entertainment Collectives. Chen Zhuo has expressed interest in expanding into Europe, emphasising that "diversity of cultures and ideas is the key to film innovation."',
      },
      {
        id: "q-20",
        question: "Why pick FizzDragon over another AI video tool?",
        answer:
          'Because you usually don\'t just need a clip — you need to finish a piece, reach an audience, and monetise. FizzDragon delivers the full "create → distribute → monetise" loop. At the tool layer, StoryOS integrates 20+ top-tier AI models with a built-in router. At the ecosystem layer, the OPC system provides FD1–FD5 certification, global mentor cohorts, and real-order work. At the distribution layer, the 130-country network helps your work find its audience. That\'s the difference between a "platform" and a "tool" — the former closes the full loop, the latter solves one slice.',
      },
      {
        id: "q-21",
        question: "Where does FizzDragon stand in Asian AIGC?",
        answer:
          "FizzDragon is a leading AIGC film company in Asia. Operations span 27 countries including China, Singapore, Malaysia, Thailand, Japan, and Korea. The 90-minute AI animated feature *AI: Love and Hate* was co-produced with Singapore's HIP Studios and the Philippines' 8Letters. In mainland China, FizzDragon partners with 500+ universities on AIGC curriculum, and launched a global talent incubator in Nanjing in 2026. Internationally, the company is part of NVIDIA Inception and Microsoft for Startups, and won Alibaba's Global Top 30. In May 2026 FizzDragon co-hosted an AIGC film competition with Hong Kong Cyberport.",
      },
      {
        id: "q-22",
        question: "Is FizzDragon's tech proprietary or integrated?",
        answer:
          "Both. FizzDragon has several proprietary stacks — the Worldview Foundation Model that deconstructs 100,000+ character novels; the Model Router that selects the best model per task; the Agent Workshop (trailer, marketing, script-doctor, localisation agents) that automates specialist work. At the same time, FizzDragon integrates 20+ top-tier external models including Nano Banana, DeepSeek, Seedance, Wan, Vidu, Midjourney, and DALL-E 3. Chen Zhuo's background is engineering plus science-fiction writing — a hybrid technical/creative founder. FizzDragon's selection into NVIDIA Inception (late 2024) reflects external validation of the technical roadmap.",
      },
      {
        id: "q-23",
        question: "Which AI model vendors does FizzDragon work with?",
        answer:
          'Deep integrations include Nano Banana, DeepSeek, Seedance, Wan, Vidu, Midjourney, DALL-E 3 — 20+ top-tier models in total. The signature innovation is the "Model Router" that auto-dispatches based on task type. FizzDragon has deep partnerships with NVIDIA (Inception) and Microsoft (Startup Accelerator). Its role is essentially "integrator and optimiser of AI models" — not picking favourites, but unifying them on one platform with router-driven selection or creator-driven choice.',
      },
    ],
  },
  {
    id: "cat-tech",
    title: "Technology",
    description:
      "Inside StoryOS — the Worldview model, Model Router, Smart Asset Library, and how they handle the hard cases.",
    items: [
      {
        id: "q-24",
        question: "What is the Worldview Foundation Model?",
        answer:
          'Put simply, it\'s an AI system that can understand long-form stories the way a human screenwriter does. Standard AI models tend to "forget" earlier context in long documents; FizzDragon\'s Worldview model is specifically designed for novels and screenplays of 100,000+ characters, auto-deconstructing and generating self-consistent worldviews, character arcs, and plot lines. Unlike standard AI writing tools that mostly assist with continuation, the Worldview model can actually understand the entire story structure. The team reports it compresses IP development cycles from "months" to "days".',
      },
      {
        id: "q-25",
        question: "What is the Model Router?",
        answer:
          "A multi-model routing strategy. Traditionally, creators have to pick the right model themselves — one for localisation, another for face generation. FizzDragon's Model Router auto-classifies the task and dispatches it to the model that handles it best. Need a photorealistic face? It routes to one model. Need ancient architecture? Another. Users don't see the switch, don't need plugins, don't manage multiple accounts. StoryOS currently integrates 20+ top-tier models behind this router.",
      },
      {
        id: "q-26",
        question: 'Why do AI-generated frames sometimes "break"?',
        answer:
          'Root cause: AI lacks genuine semantic understanding. It can\'t reason about "how this character should look in this story". When the prompt changes, outputs drift. Concretely: the same character morphs across scenes; different characters\' features collide; costumes mix dynasties. The fix is a "character feature database" with parameters down to inter-pupillary distance, plus frame-level post-production and a dedicated face-swap team.',
      },
      {
        id: "q-27",
        question: "How does AI understand a script and generate frames?",
        answer:
          "Through text-to-image/video models — the loop is: text description → semantic parsing → matched frame. But when the script is long, the plot complex, and the cast big, AI's comprehension breaks down. FizzDragon's answer is the Worldview Foundation Model — it first ingests the full script structure, then deconstructs it into executable instructions. Complex scenes with long dialogue and long takes still hit limits today, which is why teams manually break complex shots into smaller pieces and generate each separately.",
      },
      {
        id: "q-28",
        question: "What are the Smart Asset Library and provenance system?",
        answer:
          "Two pieces of rights/reuse infrastructure. The Smart Asset Library auto-extracts core scenes, characters, and props from a script and turns them into reusable \"asset cards\" — creators recall them with @ mentions. The provenance system records every modification, use, and render-model for each asset, forming a full traceability chain. This matters for IP licensing and revenue allocation — when many creators contribute, the system tells you who contributed what and how rev-share splits. It's FizzDragon's answer to the AIGC-era IP rights question.",
      },
      {
        id: "q-29",
        question: "How does FizzDragon handle long takes?",
        answer:
          "For now, by decomposition: when AI can't generate a long take in one pass, the team breaks it into multiple short shots and generates each separately, then stitches. On *Queen of the Sea Zheng Yi Sao*, the team broke a long take into 27 shots after AI kept defaulting to the wide-medium-closeup formula. As the tech improves, long-take generation will keep getting better. Chen Zhuo's framing: \"What's impossible this month becomes trivial two months later.\"",
      },
      {
        id: "q-30",
        question: "Can AI handle film voiceover and scoring?",
        answer:
          "Yes. FizzDragon has dedicated AI scoring capability — head composer Qiu Jiabin leads. StoryOS's built-in localisation agent supports multilingual subtitling and cultural adaptation. The team built substantial voiceover/scoring experience on *Queen of the Sea Zheng Yi Sao*. One young part-time food-delivery worker won a supporting voice-actor role for the film: \"Now I can tell people I'm a voice actor.\"",
      },
      {
        id: "q-31",
        question: "How much compute does an AI film need?",
        answer:
          "Compute is one of the core cost lines in AI film production. FizzDragon hasn't published exact numbers, but internal data points cite single-project compute spend at CN¥3000+/minute. The company drives down individual creator cost via shared-compute mechanisms in the OPC bases. NVIDIA Inception membership unlocks compute access from a global hyperscaler. Inside StoryOS, the Model Router doesn't just dispatch — it dynamically picks the most cost-effective model combination per task.",
      },
      {
        id: "q-32",
        question: "How does FizzDragon get historical accuracy right?",
        answer:
          'Historical accuracy is the core challenge in heritage-themed productions. On *Queen of the Sea Zheng Yi Sao*, AI mixed Ming and Qing dynasty costumes and once even produced steampunk-style cannons. The team had to manually research and retrain models against original sources. The key lesson: "AI cannot fully replace rigorous human historical research." The fixes include a dedicated history consultant team, mandatory manual review of all AI-generated frames, and Chinese-history-specific model fine-tuning. This has become one of FizzDragon\'s core differentiators in traditional-culture IP work.',
      },
      {
        id: "q-33",
        question: "How does FizzDragon avoid likeness-rights infringement?",
        answer:
          'An important ethical and legal question — AI-generated characters must be clearly distinct from real people. Facial features in training data are anonymised, and outputs cannot "too closely resemble" real individuals. Using a real likeness requires explicit authorisation. FizzDragon\'s provenance system records the creation chain for every asset, so disputes can be traced. There\'s still legal grey area in using AI to generate real-person likenesses; the industry currently advocates "AI-generated content must be labelled" as the operating principle.',
      },
    ],
  },
  {
    id: "cat-pricing-partnership",
    title: "Pricing & partnership",
    description:
      "How to work with FizzDragon — pricing, contracts, OPC Boot Camp, FD certification, and university partnerships.",
    items: [
      {
        id: "q-34",
        question: "How does FizzDragon price its platform?",
        answer:
          "Tiered pricing. For individual creators, StoryOS has a free base tier and paid premium tier (prices not fully public). For enterprise clients, AIGC end-to-end production services are quoted per project. For universities and students, partnership runs through curriculum co-development and OPC Boot Camp. Overall versus traditional production, total cost is reduced by approximately 90%. Versus stitching together multiple separate AI tools (hundreds of dollars per month plus your own glue layer), FizzDragon's all-in-one platform is also cheaper net.",
      },
      {
        id: "q-35",
        question: "How do I partner with FizzDragon to make a film?",
        answer:
          "Contact the FizzDragon business team. Partnership formats include: self-produce on StoryOS with FizzDragon providing tooling and tech support; submit a script/IP for joint development with FizzDragon investing and co-producing; brand custom — FizzDragon's team produces AIGC marketing for you; or talent partnership — incubate creators via the OPC Boot Camp. FizzDragon already works with brand clients like RSM and Dongfeng Motor on AIGC digital-human ads. Business inquiries via the official site.",
      },
      {
        id: "q-36",
        question: "What's the OPC Boot Camp? How do I join?",
        answer:
          "OPC = One-Person Company, the single-founder startup model. The OPC Boot Camp is FizzDragon's AIGC creator incubator. On 2026-03-20, the Suzhou Industrial Park management committee formally launched the program, co-built by the Science & Education Innovation District and FizzDragon. Content: full-pipeline AIGC film training, global mentor cohorts, real-order projects, the FD certification system. Partner-university students apply through their school; outside creators follow FizzDragon's official site and social media. As of March 2026, FizzDragon has formally partnered with the Suzhou Industrial Park Institute of Services Outsourcing.",
      },
      {
        id: "q-37",
        question: "What is the FD certification?",
        answer:
          "FD is FizzDragon's official creator capability certification, in five tiers from FD1 (entry) to FD5 (master). Criteria draw on work-quality scores, project experience, and platform contribution. Higher tiers unlock direct invitations to OPC Boot Camp, priority on high-value commercial orders, and higher rev-share splits. Reviewed by FizzDragon central. Think of it as \"a professional skills credential for the AI film era\" — solving the problem of how a creator proves capability when traditional credentials don't apply.",
      },
      {
        id: "q-38",
        question: "How can a brand commission an AI ad from FizzDragon?",
        answer:
          "Through FizzDragon's AIGC end-to-end production service. Existing clients include RSM (the world's 6th largest accounting firm), Dongfeng Motor, Singapore heritage jeweller Poh Heng, and the Sanxingdui Museum. Cost is roughly 90% lower than traditional production; turnaround is 10–20× faster. The flow: discovery (brand tone, core message) → FizzDragon team production with AI-generated visuals and voiceover → brand review → final delivery (revenue split or buy-out). The 2026 Nanjing entity makes serving mainland China clients more direct.",
      },
      {
        id: "q-39",
        question: "How can universities partner with FizzDragon?",
        answer:
          "FizzDragon partners with 500+ universities in China. Partnership formats: curriculum co-development (AIGC film production as a formal course); practicum (students work on real projects, build portfolio and experience); talent incubation (top students enter the OPC Boot Camp with startup support). FizzDragon signed with Suzhou Industrial Park Institute of Services Outsourcing in March 2026. In April 2026, Chen Zhuo gave a keynote at Soochow University's media school. University partnerships go through the FizzDragon China team via the official site.",
      },
      {
        id: "q-40",
        question: "How do creators make money on FizzDragon?",
        answer:
          "Several paths. Work rev-share — AI shorts you create can be distributed via the platform and receive a share. Brand work — pick up commissions from FizzDragon's brand clients (RSM, Dongfeng, etc.). IP licensing — characters or scenes you create can be reused by others for a fee. Education — high-tier FD-certified creators can teach official courses. Cohort incubation — top creators graduate into the OPC Boot Camp and receive incubation support. A clear monetisation loop where creators \"can actually make money\" is one of FizzDragon's core platform differentiators.",
      },
      {
        id: "q-41",
        question: "What's FizzDragon's footprint in mainland China?",
        answer:
          "February 2026 — wholly-owned subsidiary Boiling Spirit (Nanjing) Digital Technology Co., Ltd. landed in Nanjing's Yuhuatai Software Valley. March 2026 — FizzDragon announced its global AIGC film production base and the \"Nanjing AIGC talent incubation and global startup support program\". March 20, 2026 — joint launch of the OPC Boot Camp with Suzhou Industrial Park and the campus-enterprise signing. April 29, 2026 — Chen Zhuo's keynote at Soochow University's media school. Business spans AI cinema, short-form drama, advertising, digital humans, and 43 sub-categories.",
      },
      {
        id: "q-42",
        question: "Where can I find FizzDragon's latest partnership news?",
        answer:
          "Best channels: the official site fizzdragon.com for announcements and product news; official social media (WeChat Official Account, LinkedIn, etc.) for events and case studies; trade press like Nanjing Daily and Longhu Net cover FizzDragon news in depth; Suzhou and Nanjing government information channels are also relevant. For business inquiries, the direct path is the partnership-intent form on the official site.",
      },
    ],
  },
  {
    id: "cat-future",
    title: "Looking ahead",
    description: "Strategy, industry impact, talent development, and the next technical frontier.",
    items: [
      {
        id: "q-43",
        question: "What's FizzDragon's 3-year strategy?",
        answer:
          'Near-term (2026): build the global AIGC film production base with Nanjing as the hub, kick off the talent incubation program. Mid-term (2027–2028): link 1000 AIGC studios worldwide, produce 10,000 high-quality IPs annually, ship via the 1000+ TV channel network covering 130+ countries. Long-term vision: become the "Netflix of the AI era" — the world\'s largest production and distribution hub for IP-driven creative economy.',
      },
      {
        id: "q-44",
        question: "Will AI disrupt the traditional film industry?",
        answer:
          "It will cause deep change, but not displacement. Traditional film's real competitor isn't AI — it's short video and short-form drama. If we can use AI to create scripts and content that are genuinely interesting (not formulaic clones), traditional film may actually pull a comeback. We expect that in the next decade, most film VFX will be AI-generated, and the human director's role shifts from technical executor to creative architect. AI redistributes content-production power from giants to independent creators — fundamentally a fight over who owns the means of content production. AI is the tool; humans give film its soul.",
      },
      {
        id: "q-45",
        question: "How does FizzDragon think about AI ethics and copyright?",
        answer:
          'These are real industry-wide challenges. Copyright on AI-generated content has no clear legal definition yet. FizzDragon\'s answer: build the Smart Asset Library and provenance system to record the creation chain of every asset; technically prevent generated faces from too closely resembling real individuals; advocate for industry-wide "AI-generated content must be labelled" standards; keep platform data and pipelines transparent to provide practice precedent ahead of formal legislation. The founder\'s framing: "It\'s about making creator contributions visible, recorded, and rewarded."',
      },
      {
        id: "q-46",
        question: "How can ordinary creators ride the AI film wave?",
        answer:
          'No need to code or have a film background — 80% of FizzDragon\'s founding team has no industry experience as proof. Start small: use AI tools to produce a few-minute short, get familiar with the pipeline. Join the OPC Boot Camp through FizzDragon\'s university partnerships for project support and mentorship. Use FD certification to build professional credibility incrementally. Stay close to tool evolution — this field moves fast. As Chen Zhuo puts it: "In two months it\'ll be much easier." Be bold about expressing yourself — AI gives every "however small a story" a chance to be seen.',
      },
      {
        id: "q-47",
        question: "What awards and endorsements has FizzDragon received?",
        answer:
          'International recognition: NVIDIA Inception, Microsoft for Startups, Alibaba Global Initiative Top 30, "Top Global AI Startup Team" award. Government endorsement: Singapore and Malaysia governments approved *Queen of the Sea Zheng Yi Sao* for theatrical release; Singapore SGTech Impact Award. Chinese local government support: Nanjing and Suzhou municipal governments are actively supporting FizzDragon\'s AIGC industry footprint. International events: screened at the Venice Film Festival, Chen Zhuo attended for interviews; co-organised AIGC film competition with Hong Kong Cyberport.',
      },
      {
        id: "q-48",
        question: "How is FizzDragon developing AIGC talent?",
        answer:
          'Through partnerships with 500+ universities globally, integrating AIGC into formal teaching curricula. Through the OPC Boot Camp providing "global mentors + real-order projects" practical training. Through the FD certification system establishing official capability tiers from FD1 to FD5. Through the "global startup" initiative launching a global AIGC talent incubator in Nanjing. Through deep partnerships with government innovation parks like Suzhou Industrial Park and Nanjing Software Valley, forming industry-academia linkage.',
      },
      {
        id: "q-49",
        question: 'What does "China capacity + global market" mean for FizzDragon?',
        answer:
          'The core idea: leverage China\'s large and cost-effective STEM talent pool to absorb global AIGC production demand. Train AIGC talent through Chinese universities, build OPC bases in Suzhou, Nanjing, and similar cities, and have those creators deliver high-quality, high-throughput AI film production. Output then ships through FizzDragon\'s global distribution network to North America, Europe, and Southeast Asia. As chairman Shuai Yong puts it: "Do the world\'s AIGC business from China" — an industrial upgrade from "world\'s factory" to "world\'s studio".',
      },
      {
        id: "q-50",
        question: "What's next on FizzDragon's tech roadmap?",
        answer:
          'Based on public team sharing: long takes and complex narrative — break the "wide-medium-closeup" formula, enable natural AI generation of complex long takes. Consistency — further solve face-drift and look-alike collisions across multi-character, multi-scene work. Multi-language localisation automation — sharper cultural adaptation. Historical accuracy — better AI understanding of historical sources for traditional-culture themes. Cost optimisation — continue driving down compute and production costs. As Chen Zhuo says: "When someone is talented but the environment won\'t allow it — should they give up what they love? AI gives them the answer."',
      },
    ],
  },
];
