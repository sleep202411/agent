"use client";

/**
 * Testimonials — masonry-style 3-column testimonial wall.
 *
 * Quotes are deliberately NOT translated through i18n. Each card stays
 * in the speaker's native language so the section reads as a global
 * mix — a visitor browsing in en-US still sees the JP creator
 * speaking Japanese, the FR creator in French, etc. That's the point
 * the marketing wants to make: real users from many regions.
 *
 * Section labels (eyebrow / title / subtitle) DO translate via i18n
 * because those are platform-voice copy, not user voice.
 *
 * Avatars are anonymous platform user uploads (the profiles are seed
 * data) so no real public figures are implied. Replace with real
 * testimonials + permission before any wider launch.
 */

import { motion } from "motion/react";
import { IconStar } from "@tabler/icons-react";
import { GlitchText } from "@/components/ui/glitch-text";
import { useTranslations } from "@/src/i18n/i18n";
import { userAvatarUrl } from "@/src/lib/asset-paths";

interface Testimonial {
  /** Speaker's name in their own script. */
  name: string;
  /** Role — includes country/city + flag emoji to make the regional
   *  origin scannable at a glance without an extra UI element. */
  role: string;
  /** Quote in the speaker's native language. */
  quote: string;
  /** Tailwind gradient classes for the avatar fallback circle. */
  gradient: string;
  /** Avatar OSS path (relative — passed through `ossUrl`). */
  avatar: string;
  /** BCP-47 lang attribute for the quote — improves screen-reader
   *  pronunciation and lets browser-level translate features know to
   *  leave the text alone. */
  lang: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: "Sarah Chen",
    role: "Indie animator · Singapore 🇸🇬",
    quote:
      "Just tried FizzDragon and I'm genuinely blown away. As someone who always wrestles with the storyboard pipeline, having an AI crew that actually understands shot composition is wild. It's the first AI animation tool I'd hand to my peers without caveats.",
    gradient: "from-orange-500 to-pink-500",
    avatar: "avatar/53286d9b3b2fc2969d2691ce30437301.jpeg",
    lang: "en",
  },
  {
    name: "王雨桐",
    role: "短视频创作者 · 北京 🇨🇳",
    quote:
      "用了 FizzDragon 一周，本来以为又是个 demo 工具，结果分镜表导出居然能直接进剪辑流程。从脚本到成片不用反复改 prompt，对我们做日更的人是真的省事，团队也终于敢把试稿任务交给 AI 了。",
    gradient: "from-cyan-500 to-blue-500",
    avatar: "avatar/4f943eb36f588172f55c72ab75f8ba66.jpg",
    lang: "zh-CN",
  },
  {
    name: "高橋 美咲",
    role: "アニメーター · 東京 🇯🇵",
    quote:
      "AIエージェントが「カット割り」を理解しているのが衝撃でした。プロットから絵コンテまで一気に作れて、修正の手戻りが本当に少ないです。日本の制作現場でもそのまま使える品質だと思います。",
    gradient: "from-violet-500 to-fuchsia-500",
    avatar: "avatar/52f353e3b6c92be2facc0f69c531a660.jpeg",
    lang: "ja",
  },
  {
    name: "Léa Dubois",
    role: "Réalisatrice indépendante · Paris 🇫🇷",
    quote:
      "FizzDragon a vraiment changé ma façon de prototyper. Je peux tester trois directions visuelles en une matinée — ce qui m'aurait pris une semaine avant. L'éditeur image par image est ce qui fait la différence pour les projets sérieux.",
    gradient: "from-rose-500 to-red-500",
    avatar: "avatar/441ea6c761b0b69c3a148d4ed6435956.jpg",
    lang: "fr",
  },
  {
    name: "陳家豪",
    role: "動畫導演 · 香港 🇭🇰",
    quote:
      "做了十幾年動畫，AI 工具看過很多，FizzDragon 是少數讓我覺得「能直接放進製作流程」的。鏡頭語言這部分尤其準，省了大量跟外包溝通的時間，分鏡稿也基本不用大改。",
    gradient: "from-amber-500 to-orange-500",
    avatar: "avatar/3b9201c5ad9e8389392ec361c368abc1.jpg",
    lang: "zh-HK",
  },
  {
    name: "박지훈",
    role: "영상 크리에이터 · 서울 🇰🇷",
    quote:
      "텍스트 한 문단으로 시작해서 한 시간 만에 영상이 나온다는 게 처음엔 안 믿겼습니다. 컷별 프롬프트 디테일까지 직접 수정할 수 있어서 제어감이 좋아요. 진짜 작업 도구로 쓸 만합니다.",
    gradient: "from-emerald-500 to-teal-500",
    avatar: "avatar/3a39e2d5fdb0908f5718ea6461965a68.jpg",
    lang: "ko",
  },
  {
    name: "Carlos Hernández",
    role: "Director de cortometrajes · CDMX 🇲🇽",
    quote:
      "Probé FizzDragon para un corto y terminé usándolo para todo el storyboard. La consistencia entre escenas es lo que más me sorprendió — no se siente como un generador, se siente como un equipo pequeño trabajando contigo.",
    gradient: "from-indigo-500 to-violet-500",
    avatar: "avatar/3036706459ec7d32e0178a57367e9928.jpg",
    lang: "es",
  },
];

// Manual column distribution for an asymmetric masonry feel — keeps
// columns balanced regardless of quote length without pulling in a
// masonry library.
const COLUMNS: Testimonial[][] = [
  [TESTIMONIALS[0]!, TESTIMONIALS[1]!],
  [TESTIMONIALS[2]!, TESTIMONIALS[3]!, TESTIMONIALS[4]!],
  [TESTIMONIALS[5]!, TESTIMONIALS[6]!],
];

export function Testimonials() {
  const t = useTranslations("home");
  return (
    <section className="relative border-t border-border/40 px-6 py-32">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_45%_at_50%_15%,hsl(var(--primary)/0.08),transparent_70%)]" />

      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-3 py-1 text-[11px] font-mono uppercase tracking-[0.25em] text-amber-300"
          >
            <IconStar className="size-3 fill-current" />
            {t("testimonials.eyebrow")}
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
            className="mx-auto mt-5 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl"
          >
            {t("testimonials.titleBefore")}{" "}
            <GlitchText className="font-bold text-foreground" speed={1.2}>
              FizzDragon
            </GlitchText>
            {t("testimonials.titleAfter")}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          >
            {t("testimonials.subtitle")}
          </motion.p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col, colIndex) => (
            <div key={colIndex} className="flex flex-col gap-4">
              {col.map((item, rowIndex) => (
                <Card key={item.name} testimonial={item} delay={(colIndex * 3 + rowIndex) * 0.06} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ testimonial, delay }: { testimonial: Testimonial; delay: number }) {
  return (
    <motion.figure
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: "easeOut", delay }}
      className="group relative rounded-2xl border border-border/50 bg-card/40 p-6 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-border"
    >
      <blockquote
        lang={testimonial.lang}
        className="text-[15px] leading-relaxed text-foreground/85"
      >
        {testimonial.quote}
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <div
          className={`size-11 shrink-0 overflow-hidden rounded-full bg-gradient-to-br ${testimonial.gradient} shadow-sm`}
        >
          <img
            src={userAvatarUrl(testimonial.avatar)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{testimonial.name}</div>
          <div className="truncate text-xs text-muted-foreground">{testimonial.role}</div>
        </div>
      </figcaption>
    </motion.figure>
  );
}
