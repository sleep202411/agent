"use client";

import { useEffect, useState, type RefObject } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "@/src/i18n/i18n";

export function StickyComposerPill({ heroRef }: { heroRef: RefObject<HTMLElement | null> }) {
  const t = useTranslations("workspace");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setVisible(!entry.isIntersecting);
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [heroRef]);

  const handleClick = () => {
    heroRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
        >
          <button
            type="button"
            onClick={handleClick}
            className="pointer-events-auto flex max-w-[min(100%,36rem)] items-center gap-2.5 truncate rounded-full border border-border/70 bg-card/90 px-5 py-3 shadow-lg backdrop-blur-md transition-colors hover:border-primary/40 hover:bg-card"
          >
            <IconSparkles className="size-4 shrink-0 text-primary" />
            <span className="truncate text-sm text-muted-foreground">{t("promptPlaceholder")}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
