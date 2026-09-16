import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
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
  const scope = useMemo(() => ({ guideId }), [guideId]);
  const owner = useRef<{
    scope: typeof scope;
    driver: ReturnType<typeof createGuideDriver> | null;
    timer: ReturnType<typeof setInterval> | null;
    started: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const current = {
      scope,
      driver: null as ReturnType<typeof createGuideDriver> | null,
      timer: null as ReturnType<typeof setInterval> | null,
      started: false,
    };
    owner.current = current;
    return () => {
      if (owner.current === current) owner.current = null;
      if (current.timer) clearInterval(current.timer);
      current.driver?.destroy();
    };
  }, [scope]);

  const start = useCallback(() => {
    const current = owner.current;
    if (current?.scope !== scope || current.driver?.isActive()) return;
    const steps = guideSteps[guideId];
    if (!steps?.length) return;
    const validSteps = steps.filter((step) => document.querySelector(step.element));
    if (!validSteps.length) return;
    if (current.timer) clearInterval(current.timer);
    const driver = createGuideDriver({ prev: t("prev"), next: t("next"), done: t("finish") });
    current.driver = driver;
    driver.setSteps(toDriverSteps(validSteps, t));
    driver.drive();
    current.started = true;
    current.timer = setInterval(() => {
      if (owner.current !== current || current.driver !== driver) return;
      if (!driver.isActive()) {
        if (current.timer) clearInterval(current.timer);
        current.timer = null;
        current.driver = null;
        markGuideCompleted(guideId);
      }
    }, 500);
  }, [guideId, scope, t]);

  useEffect(() => {
    if (!ready || owner.current?.started || isGuideCompleted(guideId)) return;
    const timer = setTimeout(start, delay);
    return () => clearTimeout(timer);
  }, [guideId, ready, delay, start]);

  const reset = useCallback(() => {
    if (owner.current?.scope === scope) owner.current.started = false;
  }, [scope]);

  return { start, reset, isCompleted: isGuideCompleted(guideId) };
}
