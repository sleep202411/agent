import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { createGuideDriver, toDriverSteps } from "./driver";
import { guideSteps, type GuideId } from "./guide-steps";
import { isGuideCompleted, markGuideCompleted } from "./guide-storage";

interface UseGuideOptions {
  /** Delay before starting the guide (ms). Default: 800 */
  delay?: number;
  /** Whether the guide is ready to start (e.g., data loaded). Default: true */
  ready?: boolean;
}

export function useGuide(guideId: GuideId, options: UseGuideOptions = {}) {
  const { delay = 800, ready = true } = options;
  const t = useTranslations("guide");
  const driverRef = useRef<ReturnType<typeof createGuideDriver> | null>(null);
  const startedRef = useRef(false);

  const start = useCallback(() => {
    const steps = guideSteps[guideId];
    if (!steps || steps.length === 0) return;

    // Check all target elements exist in DOM
    const validSteps = steps.filter((s) => document.querySelector(s.element));
    if (validSteps.length === 0) return;

    const d = createGuideDriver({
      prev: t("prev"),
      next: t("next"),
      done: t("finish"),
    });
    driverRef.current = d;

    d.setSteps(toDriverSteps(validSteps, t));
    d.drive();

    // Mark completed when driver finishes
    const checkDone = setInterval(() => {
      if (!d.isActive()) {
        clearInterval(checkDone);
        markGuideCompleted(guideId);
        driverRef.current = null;
      }
    }, 500);
  }, [guideId, t]);

  // Auto-start on first mount if not completed
  useEffect(() => {
    if (!ready || startedRef.current) return;
    if (isGuideCompleted(guideId)) return;

    startedRef.current = true;
    const timer = setTimeout(start, delay);
    return () => clearTimeout(timer);
  }, [guideId, ready, delay, start]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current?.isActive()) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    startedRef.current = false;
  }, []);

  return { start, reset, isCompleted: isGuideCompleted(guideId) };
}
