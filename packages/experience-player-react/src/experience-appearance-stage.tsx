"use client";

import { useId, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import {
  compileExperienceUITheme,
  type ExperienceAppearance,
} from "@repo/shared/experience-runtime";
import styles from "./experience-appearance.module.css";

/** Changes presentation only; the runtime retains all playback and interaction. */
export function ExperienceAppearanceStage({
  appearance,
  children,
}: {
  appearance: ExperienceAppearance;
  children: ReactNode;
}) {
  const id = useId();
  const scope = `theme-${id.replace(/[^a-z0-9-]/gi, "")}`;
  const theme = appearance.presentation?.theme;
  const themeCss = useMemo(
    () => (theme ? compileExperienceUITheme(theme, scope) : ""),
    [theme, scope]
  );
  const root = useRef<HTMLDivElement>(null);
  // Measure the actual themed strip; a fixed clearance would overlap large controls.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let controls: Element | null = null;
    const resize = new ResizeObserver(() => measure());
    const measure = () => {
      const next = element.querySelector("[data-experience-transport-controls]");
      if (next !== controls) {
        if (controls) resize.unobserve(controls);
        controls = next;
        if (controls) resize.observe(controls);
      }
      element.style.setProperty(
        "--appearance-control-clearance",
        `${controls instanceof HTMLElement ? controls.offsetHeight : 0}px`
      );
    };
    const mutations = new MutationObserver(measure);
    mutations.observe(element, { childList: true, subtree: true });
    measure();
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);
  return (
    <div
      ref={root}
      className={styles.stage}
      data-experience-theme={theme ? scope : undefined}
      data-theme-package={theme ? "true" : undefined}
    >
      {themeCss && <style>{themeCss}</style>}
      {children}
    </div>
  );
}
