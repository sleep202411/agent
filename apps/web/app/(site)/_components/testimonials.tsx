"use client";

/**
 * Testimonials — masonry-style 3-column testimonial wall.
 *
 * NOTE: the quotes below are illustrative placeholders for development.
 * Replace with real user testimonials before any public launch.
 * Avatar images are pulled from anonymous platform user uploads (the
 * profiles themselves are seed/fake data) so no real public figures are
 * implied. Gradient stays as the load-state fallback behind the image.
 */

import { motion } from "motion/react";
import { IconStar } from "@tabler/icons-react";
import { GlitchText } from "@/components/ui/glitch-text";
import { useTranslations } from "@/src/i18n/i18n";
import { userAvatarUrl } from "@/src/lib/asset-paths";

type TestimonialKey =
  | "sarahChen"
  | "alexJohnson"
  | "michaelRodriguez"
  | "emmaThompson"
  | "chrisPark"
  | "davidKim"
  | "jessicaMartinez";

interface Testimonial {
  key: TestimonialKey;
  /** Tailwind gradient classes for the avatar fallback circle. */
  gradient: string;
  /** Avatar OSS path (relative — passed through `ossUrl`). */
  avatar: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    key: "sarahChen",
    gradient: "from-orange-500 to-pink-500",
    avatar: "avatar/53286d9b3b2fc2969d2691ce30437301.jpeg",
  },
  {
    key: "alexJohnson",
    gradient: "from-cyan-500 to-blue-500",
    avatar: "avatar/4f943eb36f588172f55c72ab75f8ba66.jpg",
  },
  {
    key: "michaelRodriguez",
    gradient: "from-violet-500 to-fuchsia-500",
    avatar: "avatar/52f353e3b6c92be2facc0f69c531a660.jpeg",
  },
  {
    key: "emmaThompson",
    gradient: "from-rose-500 to-red-500",
    avatar: "avatar/441ea6c761b0b69c3a148d4ed6435956.jpg",
  },
  {
    key: "chrisPark",
    gradient: "from-amber-500 to-orange-500",
    avatar: "avatar/3b9201c5ad9e8389392ec361c368abc1.jpg",
  },
  {
    key: "davidKim",
    gradient: "from-emerald-500 to-teal-500",
    avatar: "avatar/3a39e2d5fdb0908f5718ea6461965a68.jpg",
  },
  {
    key: "jessicaMartinez",
    gradient: "from-indigo-500 to-violet-500",
    avatar: "avatar/3036706459ec7d32e0178a57367e9928.jpg",
  },
];

// Manual column distribution for an asymmetric masonry feel — keeps
// columns balanced regardless of quote length without pulling in a
// masonry library.
const COLUMNS: Testimonial[][] = [
  [TESTIMONIALS[0], TESTIMONIALS[1]],
  [TESTIMONIALS[2], TESTIMONIALS[3], TESTIMONIALS[4]],
  [TESTIMONIALS[5], TESTIMONIALS[6]],
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
                <Card key={item.key} testimonial={item} delay={(colIndex * 3 + rowIndex) * 0.06} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ testimonial, delay }: { testimonial: Testimonial; delay: number }) {
  const t = useTranslations("home");
  const name = t(`testimonials.items.${testimonial.key}.name`);
  const role = t(`testimonials.items.${testimonial.key}.role`);
  const quote = t(`testimonials.items.${testimonial.key}.quote`);
  return (
    <motion.figure
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: "easeOut", delay }}
      className="group relative rounded-2xl border border-border/50 bg-card/40 p-6 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-border"
    >
      <blockquote className="text-[15px] leading-relaxed text-foreground/85">{quote}</blockquote>
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
          <div className="truncate text-sm font-semibold text-foreground">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{role}</div>
        </div>
      </figcaption>
    </motion.figure>
  );
}
